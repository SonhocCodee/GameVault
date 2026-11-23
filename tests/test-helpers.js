import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const REAL_AMD_PATH = 'C:\\Users\\MacPro\\AppData\\Local\\AMD\\CN\\RGStats.db';
export const REAL_SCREENSHOTS_PATH = 'C:\\Users\\MacPro\\Pictures\\Screenshots';
export const REAL_MEDIA_PATH = 'E:\\Game';

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    exe_name TEXT,
    exe_path TEXT,
    playtime_minutes INTEGER NOT NULL DEFAULT 0,
    user_rating REAL DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'playing',
    cover_url TEXT DEFAULT NULL,
    banner_url TEXT DEFAULT NULL,
    media_folder TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    steam_id INTEGER DEFAULT -1,
    uplay_id INTEGER DEFAULT -1,
    origin_id INTEGER DEFAULT -1,
    amd_game_id INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_title ON games(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_games_exe_name ON games(exe_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_amd_id ON games(amd_game_id);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    pid INTEGER DEFAULT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    is_running INTEGER NOT NULL DEFAULT 0,
    last_poll TEXT DEFAULT NULL,
    fps_avg REAL DEFAULT NULL,
    fps_samples INTEGER DEFAULT NULL,
    fps_1pct_low REAL DEFAULT NULL,
    source TEXT NOT NULL DEFAULT 'tracker',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_game_id ON sessions(game_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_end_time ON sessions(end_time);
CREATE INDEX IF NOT EXISTS idx_sessions_interval ON sessions(start_time, end_time);

CREATE TABLE IF NOT EXISTS screenshot_sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    original_filename TEXT NOT NULL,
    target_path TEXT NOT NULL,
    file_timestamp TEXT NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS pending_f6_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    game_title TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    matched INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_f6_matched ON pending_f6_captures(matched);
CREATE INDEX IF NOT EXISTS idx_f6_timestamp ON pending_f6_captures(timestamp);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS deleted_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL UNIQUE COLLATE NOCASE,
    exe_name TEXT DEFAULT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`;

export function createTestDb(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}

export function createTempDirectory(prefix = 'gv_test_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanupTempDirectory(dirPath) {
  if (dirPath && fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function createMockAmdDatabase(targetPath) {
  const db = new DatabaseSync(targetPath);
  db.exec(`
    CREATE TABLE InstalledGames(
      'GameID' INTEGER PRIMARY KEY,
      'ExePath' VARCHAR NOT NULL COLLATE NOCASE,
      'Title' VARCHAR NOT NULL COLLATE NOCASE,
      'SteamID' INTEGER NOT NULL,
      'UplayID' INTEGER NOT NULL,
      'OriginID' INTEGER NOT NULL,
      'PlayTotal' INTEGER NOT NULL,
      UNIQUE ('ExePath', 'SteamID', 'UplayID', 'OriginID')
    );

    CREATE TABLE GameSessions(
      'GameID' INTEGER NOT NULL,
      'PID' INTEGER NOT NULL,
      'Start' DATETIME NOT NULL,
      'End' DATETIME NOT NULL,
      'IsRunning' BOOLEAN NOT NULL,
      'StartLo' INTEGER NOT NULL,
      'StartHi' INTEGER NOT NULL,
      UNIQUE ('PID', 'StartLo', 'StartHi'),
      FOREIGN KEY (GameID) REFERENCES InstalledGames (GameID)
    );

    CREATE TABLE Version('1.0' VARCHAR);
  `);

  const insertGame = db.prepare(`
    INSERT INTO InstalledGames (GameID, ExePath, Title, SteamID, UplayID, OriginID, PlayTotal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertGame.run(3, 'C:\\Games\\Crimson Desert\\bin64\\CrimsonDesert.exe', 'Crimson Desert', 3321460, -1, -1, 216);
  insertGame.run(65, 'C:\\Games\\PBZ\\PBZ.exe', 'Phantom Blade Zero', 4115450, -1, -1, 2232);
  insertGame.run(68, 'C:\\Games\\Onimusha\\OnimushaWotS.exe', 'Onimusha: The Way of the Sword', 2638890, -1, -1, 747);
  insertGame.run(50, 'C:\\Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe', '', 1091500, -1, -1, 300);
  insertGame.run(99, 'C:\\Users\\MacPro\\AppData\\Local\\Programs\\Ollama\\Ollama App.exe', 'Ollama App', -1, -1, -1, 2216);

  const insertSession = db.prepare(`
    INSERT INTO GameSessions (GameID, PID, Start, End, IsRunning, StartLo, StartHi)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertSession.run(65, 1234, '2026-10-29T19:50:00.000', '2026-10-29 20:30:00', 0, 100, 200);
  insertSession.run(65, 1235, '2026-10-30T14:10:00.123', '2026-10-30 15:00:00', 0, 101, 201);
  insertSession.run(3, 5678, '2026-08-17T22:40:00.500', '2026-08-17 23:15:00', 0, 102, 202);

  db.close();
  return targetPath;
}

export function extractTitleFromExe(exePath) {
  if (!exePath) return 'Unknown Game';
  let base = path.basename(exePath);
  base = base.replace(/\.exe$/i, '');
  base = base.replace(/-Win64-Shipping$/i, '');
  base = base.replace(/RetailEgs$/i, '');
  base = base.replace(/WotS$/i, ' The Way of the Sword');
  base = base.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  let cleaned = base.trim();

  if (/^re\s*\d+$/i.test(cleaned) || cleaned.toLowerCase() === 'game' || cleaned.toLowerCase() === 'shipping') {
    const parent = path.basename(path.dirname(exePath));
    if (parent && !/^(bin|binaries|win64|win32|x64|x86|release|debug)$/i.test(parent)) {
      cleaned = parent.trim();
    }
  }

  return cleaned || 'Unknown Game';
}

export function parseScreenshotTimestamp(filename, statMtime = null) {
  const f6Match = filename.match(/^Screenshot-F6-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\./i);
  if (f6Match) {
    const [_, y, m, d, hh, mm, ss] = f6Match;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }

  const snipMatch = filename.match(/^Screenshot (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\./i);
  if (snipMatch) {
    const [_, y, m, d, hh, mm, ss] = snipMatch;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }

  if (statMtime instanceof Date && !isNaN(statMtime.getTime())) {
    return statMtime;
  }

  return null;
}

export function matchScreenshotToSessions(fileTime, sessions, bufferSeconds = 120) {
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

export function sanitizeTitleForFolder(title) {
  if (!title) return 'Unknown_Game';
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function resolveFolderAlias(folderName) {
  const aliases = {
    'pbz': 'Phantom Blade Zero',
    'crimsondersert': 'Crimson Desert',
    'ds2': 'Dead Space 2',
    'warhammer 40k': 'Warhammer 40000 Space Marine 2'
  };
  const key = folderName.trim().toLowerCase();
  return aliases[key] || folderName;
}

export function calculateHttp206Range(rangeHeader, totalFileSize) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return {
      statusCode: 200,
      start: 0,
      end: totalFileSize - 1,
      contentLength: totalFileSize,
      contentRange: null
    };
  }

  const parts = rangeHeader.replace('bytes=', '').split('-');
  let start = parseInt(parts[0], 10);
  let end = parts[1] ? parseInt(parts[1], 10) : totalFileSize - 1;

  if (isNaN(start)) {
    start = totalFileSize - end;
    end = totalFileSize - 1;
  }

  if (isNaN(end) || end >= totalFileSize) {
    end = totalFileSize - 1;
  }

  if (start > end || start >= totalFileSize) {
    return {
      statusCode: 416,
      start: 0,
      end: 0,
      contentLength: 0,
      contentRange: `bytes */${totalFileSize}`
    };
  }

  const contentLength = end - start + 1;
  return {
    statusCode: 206,
    start,
    end,
    contentLength,
    contentRange: `bytes ${start}-${end}/${totalFileSize}`
  };
}

export function copyAndUnlink(sourcePath, destFolder, filename) {
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

  fs.copyFileSync(sourcePath, targetPath);
  fs.unlinkSync(sourcePath);
  return { targetPath, filename: targetFilename };
}

export function hasRealAmdDatabase() {
  return fs.existsSync(REAL_AMD_PATH);
}

export function hasRealScreenshots() {
  return fs.existsSync(REAL_SCREENSHOTS_PATH);
}

export function hasRealMediaDir() {
  return fs.existsSync(REAL_MEDIA_PATH);
}
