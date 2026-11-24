import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, recalculatePlaytime } from './db.ts';
import type { AMDImportSummary } from '../shared/types.js';

export const DEFAULT_AMD_DB_PATH: string = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'AMD', 'CN', 'RGStats.db')
  : 'C:\\Users\\MacPro\\AppData\\Local\\AMD\\CN\\RGStats.db';

export interface AMDImportOptions {
  excludeUtilities?: boolean;
  targetDb?: DatabaseSync;
}

/**
 * Fast, pure-binary PE VersionInfo parser for Windows executables (.exe).
 * Reads the PE header, navigates to the .rsrc section and extracts
 * FileDescription and ProductName directly from StringFileInfo in ~1ms.
 * Requires 0 external processes or PowerShell calls.
 */
export function parsePeVersionInfo(filePath: string): { fileDescription: string | null; productName: string | null } | null {
  if (!filePath) return null;
  let fd: number | undefined;
  try {
    if (!fs.existsSync(filePath)) return null;
    fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(1024);
    fs.readSync(fd, headerBuf, 0, 1024, 0);

    // Verify DOS 'MZ' signature
    if (headerBuf.readUInt16LE(0) !== 0x5a4d) {
      return null;
    }

    const peOffset = headerBuf.readUInt32LE(0x3c);
    const peBuf = Buffer.alloc(1024);
    fs.readSync(fd, peBuf, 0, 1024, peOffset);

    // Verify 'PE\0\0'
    if (peBuf.readUInt32LE(0) !== 0x00004550) {
      return null;
    }

    const numSections = peBuf.readUInt16LE(6);
    const optHeaderSize = peBuf.readUInt16LE(20);
    const optHeaderOffset = 24;

    const magic = peBuf.readUInt16LE(optHeaderOffset);
    const is64 = magic === 0x20b;
    const is32 = magic === 0x10b;
    if (!is64 && !is32) return null;

    const dataDirOffset = optHeaderOffset + (is64 ? 112 : 96);
    const rsrcRva = peBuf.readUInt32LE(dataDirOffset + 16);
    const rsrcSize = peBuf.readUInt32LE(dataDirOffset + 20);
    if (!rsrcRva || !rsrcSize) return null;

    const secTableOffset = peOffset + optHeaderOffset + optHeaderSize;
    const secBuf = Buffer.alloc(numSections * 40);
    fs.readSync(fd, secBuf, 0, secBuf.length, secTableOffset);

    let rsrcSec: { vAddr: number; rawPtr: number; rawSize: number } | null = null;
    for (let i = 0; i < numSections; i++) {
      const sOffset = i * 40;
      const vAddr = secBuf.readUInt32LE(sOffset + 12);
      const vSize = secBuf.readUInt32LE(sOffset + 8);
      const rawSize = secBuf.readUInt32LE(sOffset + 16);
      const rawPtr = secBuf.readUInt32LE(sOffset + 20);

      if (rsrcRva >= vAddr && rsrcRva < vAddr + Math.max(vSize, rawSize)) {
        rsrcSec = { vAddr, rawPtr, rawSize };
        break;
      }
    }

    if (!rsrcSec) return null;

    const readSize = Math.min(rsrcSize, 2 * 1024 * 1024);
    const rsrcData = Buffer.alloc(readSize);
    const rsrcFileOffset = rsrcSec.rawPtr + (rsrcRva - rsrcSec.vAddr);
    fs.readSync(fd, rsrcData, 0, readSize, rsrcFileOffset);

    const fileDesc = extractUtf16StringFromBuffer(rsrcData, 'FileDescription');
    const prodName = extractUtf16StringFromBuffer(rsrcData, 'ProductName');

    return { fileDescription: fileDesc, productName: prodName };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function extractUtf16StringFromBuffer(buf: Buffer, key: string): string | null {
  const keyBuf = Buffer.from(key + '\0', 'utf16le');
  let idx = buf.indexOf(keyBuf);
  if (idx === -1) return null;

  idx += keyBuf.length;
  while (idx < buf.length && buf.readUInt16LE(idx) === 0) {
    idx += 2;
  }
  if (idx >= buf.length) return null;

  const start = idx;
  while (idx + 1 < buf.length && buf.readUInt16LE(idx) !== 0) {
    idx += 2;
  }
  if (idx > start) {
    return buf.subarray(start, idx).toString('utf16le').trim();
  }
  return null;
}

function cleanPeTitle(str: string): string {
  if (!str) return '';
  return str
    .replace(/[\u2122\u00ae]/g, '')
    .replace(/\((?:tm|r)\)/gi, '')
    .replace(/\s+(?:Client|Game Client)$/i, '')
    .trim();
}

function isGenericTitle(str: string): boolean {
  const s = (str || '').toLowerCase().trim();
  return /^(game|shipping|client|launcher|unrealengine|unity|crashhandler|bootstrap|setup|installer|start)$/i.test(s);
}

/**
 * Extracts a readable and clean game title from an executable path.
 * 1. Reads embedded PE VersionInfo (FileDescription / ProductName) directly from the .exe binary.
 * 2. If missing or generic, strips directory components, prefixes/suffixes, and expands PascalCase.
 * 3. Falls back to parent folder if title is an abbreviation or generic name.
 */
export function extractTitleFromExe(exePath?: string | null): string {
  if (!exePath) return 'Unknown Game';

  // 1. Try reading embedded PE VersionInfo directly from the executable binary
  try {
    const peInfo = parsePeVersionInfo(exePath);
    if (peInfo) {
      const candidate = peInfo.fileDescription || peInfo.productName || '';
      const cleaned = cleanPeTitle(candidate);
      if (cleaned && !isGenericTitle(cleaned) && cleaned.length >= 2) {
        return cleaned;
      }
    }
  } catch {}

  // 2. Synthesize from exe filename
  let base = path.basename(exePath);
  base = base.replace(/\.exe$/i, '');
  base = base.replace(/-Win64-Shipping$/i, '');
  base = base.replace(/RetailEgs$/i, '');
  base = base.replace(/WotS$/i, ' The Way of the Sword');
  base = base.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  let cleaned = base.trim();

  // 3. If title is an abbreviation like "re 9", "re2", or generic "game", use descriptive parent folder
  if (/^re\s*\d+$/i.test(cleaned) || cleaned.toLowerCase() === 'game' || cleaned.toLowerCase() === 'shipping') {
    const parent = path.basename(path.dirname(exePath));
    if (parent && !/^(bin|binaries|win64|win32|x64|x86|release|debug)$/i.test(parent)) {
      cleaned = parent.trim();
    }
  }

  return cleaned || 'Unknown Game';
}

/**
 * Imports games and historical gameplay sessions from AMD Adrenalin's RGStats.db.
 * Operates in read-only mode on the source database.
 * Strictly idempotent: existing games update their metadata and playtime without creating duplicates.
 */
export function importAMDDatabase(
  customPath?: string,
  options?: AMDImportOptions
): AMDImportSummary {
  const amdPath = customPath || DEFAULT_AMD_DB_PATH;
  if (!fs.existsSync(amdPath)) {
    throw new Error(`AMD Database file not found at: ${amdPath}`);
  }

  const vaultDb = options?.targetDb || getDb();
  const amdDb = new DatabaseSync(amdPath, { readOnly: true });

  let rawGames: any[] = [];
  let rawSessions: any[] = [];

  try {
    rawGames = amdDb.prepare('SELECT * FROM InstalledGames').all() as any[];
  } catch {
    rawGames = [];
  }

  try {
    rawSessions = amdDb.prepare('SELECT * FROM GameSessions').all() as any[];
  } catch {
    rawSessions = [];
  }

  amdDb.close();

  // Read gmdb.blb (AMD UI profile cache) for accurate total played minutes
  const blbMap = new Map<string, number>();
  try {
    const blbPath = path.join(path.dirname(amdPath), 'gmdb.blb');
    if (fs.existsSync(blbPath)) {
      const blbContent = fs.readFileSync(blbPath, 'utf-8');
      const blbJson = JSON.parse(blbContent);
      if (Array.isArray(blbJson?.games)) {
        for (const bg of blbJson.games) {
          const t = (bg?.title || '').toLowerCase().trim();
          const mins = parseInt(bg?.total_played_mins, 10) || 0;
          if (t && mins > 0) {
            blbMap.set(t, Math.max(blbMap.get(t) || 0, mins));
          }
        }
      }
    }
  } catch {}

  const insertGameStmt = vaultDb.prepare(`
    INSERT INTO games (
      title, exe_name, exe_path, playtime_minutes, steam_id, uplay_id, origin_id, amd_game_id, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'playing')
    ON CONFLICT(title) DO UPDATE SET
      exe_name = COALESCE(excluded.exe_name, games.exe_name),
      exe_path = COALESCE(excluded.exe_path, games.exe_path),
      playtime_minutes = MAX(games.playtime_minutes, excluded.playtime_minutes),
      steam_id = CASE WHEN excluded.steam_id > 0 THEN excluded.steam_id ELSE games.steam_id END,
      uplay_id = CASE WHEN excluded.uplay_id > 0 THEN excluded.uplay_id ELSE games.uplay_id END,
      origin_id = CASE WHEN excluded.origin_id > 0 THEN excluded.origin_id ELSE games.origin_id END,
      amd_game_id = excluded.amd_game_id,
      updated_at = datetime('now', 'localtime')
  `);

  let importedGames = 0;
  let skippedGames = 0;
  const gameIdMap = new Map<number, number>(); // amdGameId -> vaultGameId

  // Load deleted_games blacklist so user-deleted games are NEVER resurrected
  const deletedTitles = new Set<string>();
  try {
    const deletedRows = vaultDb.prepare('SELECT title FROM deleted_games').all() as any[];
    for (const d of deletedRows) {
      if (d.title) deletedTitles.add(d.title.toLowerCase().trim());
    }
  } catch {}

  for (const g of rawGames) {
    const rawTitle = g.Title ? String(g.Title).trim() : '';
    const exePath = g.ExePath ? String(g.ExePath) : '';

    const lowerTitle = rawTitle.toLowerCase();
    const lowerExe = exePath.toLowerCase();

    const isUtility =
      lowerTitle.includes('codex_retention_probe') ||
      lowerTitle.includes('lưu giữ') ||
      lowerTitle.includes('microsoft excel') ||
      lowerTitle.includes('microsoft word') ||
      lowerTitle.includes('microsoft powerpoint') ||
      lowerTitle.includes('one note') ||
      lowerTitle.includes('onenote') ||
      lowerTitle.includes('vlc') ||
      lowerTitle.includes('wmplayer') ||
      lowerTitle.includes('media player') ||
      lowerTitle.includes('spotify') ||
      lowerTitle.includes('ollama') ||
      lowerTitle.includes('crosshair') ||
      lowerTitle.includes('streaming_client') ||
      lowerTitle.includes('remote play client') ||
      lowerTitle.includes('riot client') ||
      lowerTitle.includes('discord system helper') ||
      lowerTitle.includes('amdrssrc') ||
      lowerTitle.includes('crash handler') ||
      /^(word|excel|powerpoint)$/i.test(lowerTitle) ||
      lowerExe.includes('excel') ||
      lowerExe.includes('winword') ||
      lowerExe.includes('powerpnt') ||
      lowerExe.includes('onenote') ||
      lowerExe.includes('vlc') ||
      lowerExe.includes('wmplayer') ||
      lowerExe.includes('spotify') ||
      lowerExe.includes('ollama') ||
      lowerExe.includes('crosshair') ||
      lowerExe.includes('streaming_client') ||
      lowerExe.includes('riotclient') ||
      lowerExe.includes('discordsystemhelper') ||
      lowerExe.includes('amdrssrc') ||
      lowerExe.includes('crashhandler');

    if (options?.excludeUtilities && isUtility) {
      skippedGames++;
      continue;
    }

    const candidateRaw = (rawTitle || extractTitleFromExe(exePath)).toLowerCase().trim();
    if (deletedTitles.has(candidateRaw) || (rawTitle && deletedTitles.has(rawTitle.toLowerCase().trim()))) {
      skippedGames++;
      continue;
    }

    // Check if game already exists by exe_path or title to prevent duplicate game cards
    let existingGame: any = null;
    if (exePath) {
      existingGame = vaultDb.prepare('SELECT id, title FROM games WHERE exe_path = ?').get(exePath);
    }
    if (!existingGame && rawTitle) {
      existingGame = vaultDb.prepare('SELECT id, title FROM games WHERE title = ? COLLATE NOCASE').get(rawTitle);
    }

    const title = existingGame ? existingGame.title : (rawTitle || extractTitleFromExe(exePath));
    const exeName = exePath ? path.basename(exePath) : '';
    const rawPlayTotal = Number(g.PlayTotal) || 0;
    const blbMinutes = blbMap.get(title.toLowerCase().trim()) || (rawTitle ? blbMap.get(rawTitle.toLowerCase().trim()) : 0) || 0;
    const playtime = Math.max(rawPlayTotal, blbMinutes);
    // Folder probe (fs.existsSync on the game's drive) only for brand-new
    // games: re-probing every sync would wake sleeping HDDs every 5 seconds
    let steamId = typeof g.SteamID === 'number' ? g.SteamID : -1;
    if (!existingGame && steamId <= 0 && exePath) {
      try {
        const { detectSteamAppIdCached } = require('./covers.ts');
        const detected = detectSteamAppIdCached(exePath);
        if (detected) steamId = detected;
      } catch {}
    }
    const uplayId = typeof g.UplayID === 'number' ? g.UplayID : -1;
    const originId = typeof g.OriginID === 'number' ? g.OriginID : -1;
    const amdGameId = typeof g.GameID === 'number' ? g.GameID : null;

    insertGameStmt.run(
      title,
      exeName,
      exePath,
      playtime,
      steamId,
      uplayId,
      originId,
      amdGameId
    );

    const vaultGame = vaultDb.prepare('SELECT id FROM games WHERE title = ? COLLATE NOCASE').get(title) as any;
    if (vaultGame && amdGameId !== null) {
      gameIdMap.set(amdGameId, vaultGame.id);
    }
    importedGames++;
  }

  // Sessions import
  let importedSessions = 0;
  const touchedGameIds = new Set<number>();
  const checkSessionStmt = vaultDb.prepare(`
    SELECT id, end_time, is_running FROM sessions
    WHERE game_id = ? AND start_time = ? AND source = 'amd_import'
  `);

  const insertSessionStmt = vaultDb.prepare(`
    INSERT INTO sessions (
      game_id, pid, start_time, end_time, duration_minutes, is_running, source
    )
    VALUES (?, ?, ?, ?, ?, ?, 'amd_import')
  `);

  const syncSessionStmt = vaultDb.prepare(`
    UPDATE sessions
    SET end_time = ?, duration_minutes = ?, is_running = ?
    WHERE id = ?
  `);

  const computeDurationMinutes = (start: string, end: string | null): number => {
    if (!end) return 0;
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 0;
    return Math.round((endMs - startMs) / 60000);
  };

  for (const s of rawSessions) {
    const vaultGameId = gameIdMap.get(s.GameID);
    if (!vaultGameId) continue;

    const startTime = s.Start ? String(s.Start).replace(' ', 'T') : '';
    const endTime = s.End ? String(s.End).replace(' ', 'T') : null;

    if (!startTime) continue;

    const duration = computeDurationMinutes(startTime, endTime);
    const isRunning = s.IsRunning ? 1 : 0;

    // Idempotency check: avoid duplicating sessions if already imported
    const existing = checkSessionStmt.get(vaultGameId, startTime) as any;
    if (existing) {
      importedSessions++;
      // A live AMD session reports a continuously advancing End timestamp —
      // sync it so playtime keeps accruing while the game is still running
      if (endTime) {
        const newEndMs = new Date(endTime).getTime();
        const storedEndMs = existing.end_time
          ? new Date(String(existing.end_time).replace(' ', 'T')).getTime()
          : NaN;
        const endAdvanced =
          isFinite(newEndMs) && (!isFinite(storedEndMs) || newEndMs > storedEndMs);
        if (endAdvanced || isRunning !== Number(existing.is_running)) {
          syncSessionStmt.run(endTime, duration, isRunning, existing.id);
          touchedGameIds.add(vaultGameId);
        }
      }
      continue;
    }

    insertSessionStmt.run(
      vaultGameId,
      s.PID ?? null,
      startTime,
      endTime,
      duration,
      isRunning
    );
    touchedGameIds.add(vaultGameId);
    importedSessions++;
  }

  // Credit imported/synced sessions into the affected games' totals.
  // The old logic only took MAX(stored, AMD PlayTotal) — when a manual edit
  // sat above AMD's counter the total froze forever while sessions kept growing.
  if (touchedGameIds.size > 0) {
    try {
      recalculatePlaytime(vaultDb, [...touchedGameIds]);
    } catch {}
  }

  return {
    importedGames,
    importedSessions,
    skippedGames,
  };
}
