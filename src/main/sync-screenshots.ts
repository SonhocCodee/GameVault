import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, recordScreenshotSync, getUnmatchedF6Captures, markF6CaptureMatched } from './db.ts';
import type { ScreenshotSyncOptions, ScreenshotSyncSummary } from '../shared/types.js';

export const DEFAULT_SCREENSHOTS_DIR: string = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, 'Pictures', 'Screenshots')
  : 'C:\\Users\\MacPro\\Pictures\\Screenshots';

export const DEFAULT_MEDIA_DIR: string = 'E:\\Game';

export const SUPPORTED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.heic',
]);

export interface ExtendedSyncOptions extends ScreenshotSyncOptions {
  sourceDir?: string;
  mediaBaseDir?: string;
  targetDb?: DatabaseSync;
  bufferSeconds?: number;
  targetGameId?: number;
  unmatchedFiles?: string[];
}

export interface SessionMatchCandidate {
  session_id?: number;
  id?: number;
  game_id: number;
  start_time: string;
  end_time?: string | null;
  title: string;
  media_folder?: string | null;
}

/**
 * Parses screenshot capture timestamp from filename patterns or falls back to filesystem mtime.
 * Pattern 1: F6 format Screenshot-F6-yyyyMMdd-HHmmss.png
 * Pattern 2: Snipping Tool format Screenshot yyyy-MM-dd HHmmss.png
 * Fallback: stat.mtime
 */
export function parseScreenshotTimestamp(filename: string, statMtime: Date | null = null): Date | null {
  const f6Match = filename.match(/^Screenshot-F6-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\./i);
  if (f6Match) {
    const [, y, m, d, hh, mm, ss] = f6Match;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }

  const snipMatch = filename.match(/^Screenshot (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\./i);
  if (snipMatch) {
    const [, y, m, d, hh, mm, ss] = snipMatch;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }

  if (statMtime instanceof Date && !isNaN(statMtime.getTime())) {
    return statMtime;
  }

  return null;
}

/**
 * Sanitizes a game title for use as a Windows directory name,
 * removing illegal filesystem characters: < > : " / \ | ? *
 */
export function sanitizeTitleForFolder(title?: string | null): string {
  if (!title) return 'Unknown_Game';
  const sanitized = title
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return sanitized || 'Unknown_Game';
}

/**
 * Resolves known acronyms and folder naming aliases to canonical game titles.
 */
export function resolveFolderAlias(folderName: string): string {
  const aliases: Record<string, string> = {
    'pbz': 'Phantom Blade Zero',
    'crimsondersert': 'Crimson Desert',
    'ds2': 'Dead Space 2',
    'warhammer 40k': 'Warhammer 40000 Space Marine 2',
  };
  const key = folderName.trim().toLowerCase();
  return aliases[key] || folderName;
}

/**
 * Correlates a screenshot timestamp with an active game session timeline.
 * Employs a default 120-second grace buffer before start and after end.
 */
export function matchScreenshotToSessions(
  fileTime: Date | null,
  sessions: SessionMatchCandidate[],
  bufferSeconds: number = 120
): SessionMatchCandidate | null {
  if (!fileTime || !(fileTime instanceof Date) || isNaN(fileTime.getTime())) {
    return null;
  }

  const timeMs = fileTime.getTime();
  const bufferMs = bufferSeconds * 1000;

  for (const session of sessions) {
    const startMs = new Date(session.start_time).getTime() - bufferMs;
    const endMs = new Date(session.end_time || session.start_time).getTime() + bufferMs;
    if (timeMs >= startMs && timeMs <= endMs) {
      return session;
    }
  }

  return null;
}

/**
 * Moves a file safely across different filesystem drives (e.g. C: -> E:)
 * avoiding EXDEV by using copyFileSync + verification + unlinkSync.
 * Automatically resolves name collisions by appending _1, _2, etc.
 */
export function copyAndUnlink(
  sourcePath: string,
  destFolder: string,
  filename: string
): { targetPath: string; filename: string } {
  if (!fs.existsSync(destFolder)) {
    fs.mkdirSync(destFolder, { recursive: true });
  }

  let targetFilename = filename;
  let targetPath = path.join(destFolder, targetFilename);
  let counter = 1;

  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  while (fs.existsSync(targetPath)) {
    targetFilename = `${base}_${counter}${ext}`;
    targetPath = path.join(destFolder, targetFilename);
    counter++;
  }

  // Two-step cross-volume move with integrity verification
  fs.copyFileSync(sourcePath, targetPath);

  const srcStat = fs.statSync(sourcePath);
  const dstStat = fs.statSync(targetPath);

  if (dstStat.size !== srcStat.size) {
    fs.unlinkSync(targetPath);
    throw new Error(`Size mismatch during cross-device copy from ${sourcePath} to ${targetPath}`);
  }

  fs.unlinkSync(sourcePath);

  return { targetPath, filename: targetFilename };
}

/**
 * Main Screenshot Synchronization Engine.
 * Scans screenshots folder, matches capture timestamps against session logs,
 * and moves them to corresponding E:\Game\<GameTitle> media folders.
 */
export function syncScreenshots(options?: ExtendedSyncOptions): ScreenshotSyncSummary {
  const dryRun = !!options?.dryRun;
  const bufferSec = options?.bufferSeconds ?? 120;
  const sourceDir = options?.sourceDir || DEFAULT_SCREENSHOTS_DIR;
  const mediaBaseDir = options?.mediaBaseDir || DEFAULT_MEDIA_DIR;
  const vaultDb = options?.targetDb || getDb();

  const results: ScreenshotSyncSummary & { scanned: number } = {
    matched: 0,
    moved: 0,
    details: [],
    unmatched: [],
    scanned: 0,
  };

  if (!fs.existsSync(sourceDir)) {
    return results;
  }

  const files = fs.readdirSync(sourceDir);
  results.scanned = files.length;

  let targetGameCandidate: SessionMatchCandidate | null = null;
  if (options?.targetGameId) {
    try {
      const row = vaultDb.prepare(`
        SELECT id as game_id, title, media_folder
        FROM games
        WHERE id = ?
      `).get(options.targetGameId) as any;
      if (row) {
        targetGameCandidate = {
          game_id: row.game_id,
          title: row.title,
          media_folder: row.media_folder,
          start_time: '',
        };
      }
    } catch (err) {
      console.error('Failed to lookup targetGameId:', err);
    }
  }

  const rawSessions = vaultDb.prepare(`
    SELECT 
      s.id as session_id,
      s.game_id,
      s.start_time,
      s.end_time,
      g.title,
      g.media_folder
    FROM sessions s
    JOIN games g ON s.game_id = g.id
    ORDER BY s.start_time DESC
  `).all() as unknown as SessionMatchCandidate[];

  let pendingCaptures: any[] = [];
  try {
    pendingCaptures = getUnmatchedF6Captures(vaultDb);
  } catch {
    pendingCaptures = [];
  }

  const assignedDates = new Map<string, Date[]>();

  for (const filename of files) {
    const fullPath = path.join(sourceDir, filename);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) continue;

    // Filter by allowed image extensions
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      continue;
    }

    const fileTimestamp = parseScreenshotTimestamp(filename, stat.mtime);
    if (!fileTimestamp) continue;

    // 1. High Priority: Check exact F6 hotkey capture token queue
    let matchedSession: SessionMatchCandidate | null = null;
    let matchedCaptureId: number | null = null;

    if (pendingCaptures.length > 0) {
      const fileMs = fileTimestamp.getTime();
      let bestIdx = -1;
      let minDiff = Infinity;

      for (let i = 0; i < pendingCaptures.length; i++) {
        const cap = pendingCaptures[i];
        const capMs = new Date(cap.timestamp).getTime();
        const diff = Math.abs(fileMs - capMs);
        if (diff <= 20000 && diff < minDiff) {
          minDiff = diff;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        const cap = pendingCaptures[bestIdx];
        matchedCaptureId = cap.id;
        matchedSession = {
          game_id: cap.game_id,
          title: cap.game_title,
          media_folder: sanitizeTitleForFolder(cap.game_title),
          start_time: cap.timestamp,
        };
        pendingCaptures.splice(bestIdx, 1);
      }
    }

    // 2. Fallback: match by session timeline if no exact F6 token
    if (!matchedSession) {
      matchedSession = matchScreenshotToSessions(fileTimestamp, rawSessions, bufferSec);
    }

    // If no session matched, check if we have a targetGameId fallback
    if (!matchedSession && targetGameCandidate) {
      const shouldAssign = options?.unmatchedFiles
        ? options.unmatchedFiles.includes(filename)
        : filename.toLowerCase().includes('screenshot-f6');

      if (shouldAssign) {
        matchedSession = targetGameCandidate;
        const dateKey = fileTimestamp.toISOString().slice(0, 10);
        if (!assignedDates.has(dateKey)) {
          assignedDates.set(dateKey, []);
        }
        assignedDates.get(dateKey)!.push(fileTimestamp);
      }
    }

    if (!matchedSession) {
      // Record as unmatched screenshot for manual assignment in UI
      if (filename.toLowerCase().includes('screenshot-f6') || filename.toLowerCase().startsWith('screenshot')) {
        results.unmatched!.push({
          file: filename,
          path: fullPath,
          timestamp: fileTimestamp.toISOString(),
        });
      }
      continue;
    }

    results.matched++;

    const folderName = matchedSession.media_folder || sanitizeTitleForFolder(matchedSession.title);
    const destFolder = path.join(mediaBaseDir, folderName);

    if (!dryRun) {
      try {
        const moveResult = copyAndUnlink(fullPath, destFolder, filename);
        
        // Log to history table
        const sessionId = matchedSession.session_id ?? matchedSession.id ?? null;
        try {
          recordScreenshotSync({
            game_id: matchedSession.game_id,
            session_id: sessionId,
            original_filename: filename,
            target_path: moveResult.targetPath,
            file_timestamp: fileTimestamp.toISOString(),
          }, vaultDb);
        } catch {
          // If recordScreenshotSync via getDb fails, try on vaultDb directly
          vaultDb.prepare(`
            INSERT INTO screenshot_sync_history (game_id, session_id, original_filename, target_path, file_timestamp)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            matchedSession.game_id,
            sessionId,
            filename,
            moveResult.targetPath,
            fileTimestamp.toISOString()
          );
        }

        if (matchedCaptureId) {
          try {
            markF6CaptureMatched(matchedCaptureId, vaultDb);
          } catch {}
        }

        results.moved++;
        results.details.push({
          file: filename,
          gameTitle: matchedSession.title,
          targetPath: moveResult.targetPath,
        });
      } catch (err: any) {
        console.error(`Failed to move screenshot ${filename}:`, err);
      }
    } else {
      results.details.push({
        file: filename,
        gameTitle: matchedSession.title,
        targetPath: path.join(destFolder, filename),
      });
    }
  }

  // If we assigned photos via targetGameCandidate, ensure sessions exist for those days
  if (!dryRun && targetGameCandidate && assignedDates.size > 0) {
    for (const [dateKey, timestamps] of assignedDates.entries()) {
      timestamps.sort((a, b) => a.getTime() - b.getTime());
      const minTime = timestamps[0];
      const maxTime = timestamps[timestamps.length - 1];
      const durationMin = Math.max(10, Math.round((maxTime.getTime() - minTime.getTime()) / 60000) + 10);

      // Check if session already exists for this day
      const existing = vaultDb.prepare(`
        SELECT id FROM sessions
        WHERE game_id = ? AND start_time LIKE ?
      `).get(targetGameCandidate.game_id, `${dateKey}%`);

      if (!existing) {
        try {
          vaultDb.prepare(`
            INSERT INTO sessions (game_id, start_time, end_time, duration_minutes, is_running, source)
            VALUES (?, ?, ?, ?, 0, 'manual_sync_assign')
          `).run(
            targetGameCandidate.game_id,
            minTime.toISOString(),
            maxTime.toISOString(),
            durationMin
          );
        } catch (err) {
          console.error('Failed to create recovery session:', err);
        }
      }
    }

    // Refresh playtime total for the target game
    try {
      const sumRow = vaultDb.prepare(`
        SELECT SUM(duration_minutes) as total FROM sessions WHERE game_id = ?
      `).get(targetGameCandidate.game_id) as any;
      const totalMinutes = sumRow?.total || 0;
      vaultDb.prepare(`
        UPDATE games SET playtime_minutes = ? WHERE id = ?
      `).run(totalMinutes, targetGameCandidate.game_id);
    } catch (err) {
      console.error('Failed to update playtime for target game:', err);
    }
  }

  return results;
}
