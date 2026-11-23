import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, getDbDir, recalculatePlaytime } from './db.ts';
import { getTracker } from './tracker.ts';

/**
 * Playtime Watchdog importer: mirrors AMDWatcher, but reads the session log
 * written by resources/playtime-watch.ps1 — an independent background script
 * that counts foreground playtime even while GameVault is closed. Sessions
 * land with source='ptwatch' and merge into totals via interval union, so
 * overlaps with the in-app tracker / AMD import are never double-counted.
 */

export interface WatchLogSession {
  exe?: string;
  path?: string;
  pid?: number | string;
  start?: string;
  end?: string;
  last?: string;
}

export interface WatchLog {
  v?: number;
  sessions?: WatchLogSession[] | WatchLogSession;
  running?: WatchLogSession | null;
}

export function getPlaytimeWatchLogPath(): string {
  return path.join(getDbDir(), 'playtime-watch.json');
}

function computeDurationMinutes(start: string, end: string | null): number {
  if (!end) return 0;
  const startMs = new Date(start.trim().replace(' ', 'T')).getTime();
  const endMs = new Date(end.trim().replace(' ', 'T')).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 0;
  return Math.round((endMs - startMs) / 60000);
}

export interface PtWatchSyncSummary {
  importedSessions: number;
  updated: boolean;
}

export class PlaytimeWatchImporter {
  // High-resolution change detection: the watchdog rewrites the log every
  // poll (5s), and mtimeMs can quantize under load — mtimeNs (100ns on NTFS)
  // never misses a cycle
  private lastLogStamp: bigint | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  /** Unknown exes auto-register like the in-app tracker does when enabled. */
  public autoRegisterGames: boolean = true;

  public checkAndSync(customVaultDb?: DatabaseSync, customLogPath?: string): PtWatchSyncSummary {
    const summary: PtWatchSyncSummary = { importedSessions: 0, updated: false };
    const logPath = customLogPath || getPlaytimeWatchLogPath();
    if (!fs.existsSync(logPath)) return summary;

    let stat: fs.BigIntStats;
    try {
      stat = fs.statSync(logPath, { bigint: true }) as fs.BigIntStats;
    } catch {
      return summary;
    }
    const stamp = stat.mtimeNs;
    if (this.lastLogStamp !== null && stamp <= this.lastLogStamp) return summary;
    this.lastLogStamp = stamp;

    let raw: WatchLog | null = null;
    try {
      raw = JSON.parse(fs.readFileSync(logPath, 'utf-8')) as WatchLog;
    } catch {
      // Torn/partial write — skip this cycle, the watchdog rewrites atomically
      return summary;
    }
    if (!raw) return summary;

    const db = customVaultDb || getDb();
    const closed = Array.isArray(raw.sessions)
      ? (raw.sessions as WatchLogSession[])
      : raw.sessions
        ? [raw.sessions as WatchLogSession]
        : [];
    const running = raw.running && raw.running.exe ? (raw.running as WatchLogSession) : null;
    const all: WatchLogSession[] = [...closed, ...(running ? [running] : [])];

    const gameIds = new Map<string, number>();
    const touched = new Set<number>();
    const checkSessionStmt = db.prepare(`
      SELECT id, end_time, is_running FROM sessions
      WHERE game_id = ? AND start_time = ? AND source = 'ptwatch'
    `);
    const insertSessionStmt = db.prepare(`
      INSERT INTO sessions (game_id, pid, start_time, end_time, duration_minutes, is_running, source)
      VALUES (?, ?, ?, ?, ?, ?, 'ptwatch')
    `);
    const syncSessionStmt = db.prepare(`
      UPDATE sessions
      SET end_time = ?, duration_minutes = ?, is_running = ?
      WHERE id = ?
    `);

    for (const s of all) {
      const exeName = String(s.exe || '').trim();
      const startStamp = String(s.start || '').trim();
      // A running session counts up to its last confirmed poll; closed ones end at `end`
      const endStamp = String(s.end || s.last || '').trim();
      if (!exeName || !startStamp || !endStamp) continue;

      const key = exeName.toLowerCase();
      let gameId = gameIds.get(key);
      if (gameId === undefined) {
        const row = db.prepare('SELECT id FROM games WHERE exe_name = ? COLLATE NOCASE').get(exeName) as any;
        if (row) {
          gameId = Number(row.id);
        } else if (this.autoRegisterGames) {
          try {
            const game = getTracker().autoRegisterNewGame(exeName, s.path || null);
            if (game) gameId = Number(game.id);
          } catch {}
        }
        gameIds.set(key, gameId ?? -1);
      }
      if (!gameId || gameId < 0) continue;

      const isRunning = s.end ? 0 : 1;
      const duration = computeDurationMinutes(startStamp, endStamp);
      const pid = typeof s.pid === 'number' ? s.pid : parseInt(String(s.pid ?? ''), 10) || null;

      const existing = checkSessionStmt.get(gameId, startStamp) as any;
      if (existing) {
        // Live watchdog session: sync the advancing end so playtime accrues
        const newEndMs = new Date(endStamp.replace(' ', 'T')).getTime();
        const storedEndMs = existing.end_time
          ? new Date(String(existing.end_time).replace(' ', 'T')).getTime()
          : NaN;
        const endAdvanced =
          isFinite(newEndMs) && (!isFinite(storedEndMs) || newEndMs > storedEndMs);
        if (endAdvanced || isRunning !== Number(existing.is_running)) {
          syncSessionStmt.run(endStamp, duration, isRunning, existing.id);
          touched.add(gameId);
        }
        continue;
      }

      insertSessionStmt.run(gameId, pid, startStamp, endStamp, duration, isRunning);
      touched.add(gameId);
      summary.importedSessions++;
    }

    if (touched.size > 0) {
      try {
        recalculatePlaytime(db, [...touched]);
      } catch {}
    }

    summary.updated = true;
    return summary;
  }

  public start(intervalMs: number = 5000): void {
    if (this.checkInterval) return;
    // Initial import of everything the watchdog recorded while the app was off
    try {
      this.checkAndSync();
    } catch {}
    this.checkInterval = setInterval(() => {
      try {
        this.checkAndSync();
      } catch {}
    }, intervalMs);
  }

  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

let playtimeWatchInstance: PlaytimeWatchImporter | null = null;

export function getPlaytimeWatchImporter(): PlaytimeWatchImporter {
  if (!playtimeWatchInstance) {
    playtimeWatchInstance = new PlaytimeWatchImporter();
  }
  return playtimeWatchInstance;
}
