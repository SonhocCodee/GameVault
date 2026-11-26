import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import type { Game, Session, GameFilter, GameStatus, SessionSource, SavePathConfig, SaveBackup } from '../shared/types.js';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string = '';

/**
 * Resolves the default SQLite database path.
 * When running inside Electron, uses AppData/Roaming/GameVault/gamevault.db.
 * Falls back to local ./gamevault.db in headless/test environments.
 */
export function getDefaultDbPath(): string {
  try {
    // Attempt Electron app path if electron is loaded
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'gamevault.db');
    }
  } catch {
    // Electron app not available in this context
  }

  const appData = process.env.APPDATA || (
    process.platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library', 'Application Support')
      : path.join(process.env.HOME || '', '.config')
  );

  if (appData) {
    const defaultPath = path.join(appData, 'game-vault', 'gamevault.db');
    return defaultPath;
  }

  return path.resolve('gamevault.db');
}

/**
 * Initializes the SQLite database, runs PRAGMAs, and creates tables & indexes.
 */
export function initDb(customPath?: string): DatabaseSync {
  if (dbInstance && currentDbPath === (customPath || currentDbPath)) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors on re-init
    }
    dbInstance = null;
  }

  const dbPath = customPath || getDefaultDbPath();
  currentDbPath = dbPath;

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  dbInstance = db;

  // Configure SQLite performance and integrity
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    } catch {
      // In some environments WAL may not be supported
    }
  }
  // The tracker writes every few seconds while the UI writes covers/ratings —
  // without a busy timeout any writer collision throws SQLITE_BUSY immediately.
  db.exec('PRAGMA busy_timeout = 5000;');

  // Create Schema
  createTables(db);
  migrateSchema(db);

  return db;
}

/**
 * In-place migrations for databases created with older schemas.
 * CREATE TABLE IF NOT EXISTS never upgrades existing tables, so
 * column additions must be applied via guarded ALTER TABLE here.
 */
function migrateSchema(db: DatabaseSync): void {
  // Existing counters are an accepted historical baseline. Add provenance
  // without rewriting totals, completion dates, or old session/audit records.
  const gameColumns = db.prepare('PRAGMA table_xinfo(games)').all() as any[];
  if (!gameColumns.some((c: any) => c.name === 'manual_playtime_minutes')) {
    db.exec('ALTER TABLE games ADD COLUMN manual_playtime_minutes REAL NOT NULL DEFAULT 0');
  }
  if (!gameColumns.some((c: any) => c.name === 'recorded_playtime_minutes')) {
    db.exec(`ALTER TABLE games ADD COLUMN recorded_playtime_minutes REAL
      GENERATED ALWAYS AS (MAX(0, playtime_minutes - manual_playtime_minutes)) VIRTUAL`);
  }

  // sessions.last_poll: last confirmed-alive poll of a running session,
  // used to recover playtime after an abnormal exit (crash / kill)
  try {
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as any[];
    if (!columns.some((c: any) => c.name === 'last_poll')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN last_poll TEXT DEFAULT NULL`);
    }
    // sessions.fps_*: PresentMon measurements captured during the session,
    // feeding the per-game performance leaderboard
    if (!columns.some((c: any) => c.name === 'fps_avg')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN fps_avg REAL DEFAULT NULL`);
    }
    if (!columns.some((c: any) => c.name === 'fps_samples')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN fps_samples INTEGER DEFAULT NULL`);
    }
    if (!columns.some((c: any) => c.name === 'fps_1pct_low')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN fps_1pct_low REAL DEFAULT NULL`);
    }
  } catch {
    // Best-effort: a failure here means the column check itself failed;
    // tracker writes are wrapped so the app keeps running regardless
  }
}

/**
 * Returns the active DatabaseSync instance, initializing it if necessary.
 */
export function getDb(): DatabaseSync {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

/**
 * Directory containing the active SQLite database (userData in the app).
 * Used as a stable scratch space for FPS capture handoff files.
 */
export function getDbDir(): string {
  if (currentDbPath && currentDbPath !== ':memory:') {
    return path.resolve(path.dirname(currentDbPath));
  }
  return path.resolve(path.dirname(getDefaultDbPath()));
}

/**
 * Closes the active database connection.
 */
export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
    currentDbPath = '';
  }
}

/**
 * Creates required tables and indexes.
 */
function createTables(db: DatabaseSync): void {
  db.exec(`
    -- Games Table
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      exe_name TEXT,
      exe_path TEXT,
      playtime_minutes INTEGER NOT NULL DEFAULT 0,
      manual_playtime_minutes REAL NOT NULL DEFAULT 0,
      recorded_playtime_minutes REAL GENERATED ALWAYS AS (MAX(0, playtime_minutes - manual_playtime_minutes)) VIRTUAL,
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

    -- Sessions Table
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

    -- Screenshot Sync History Table
    CREATE TABLE IF NOT EXISTS screenshot_sync_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      original_filename TEXT NOT NULL,
      target_path TEXT NOT NULL,
      file_timestamp TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_sync_game_id ON screenshot_sync_history(game_id);
    CREATE INDEX IF NOT EXISTS idx_sync_session_id ON screenshot_sync_history(session_id);

    -- Pending F6 Hotkey Captures Queue
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

    -- Save Vault: per-game save folder config
    CREATE TABLE IF NOT EXISTS save_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(game_id, source_path)
    );

    CREATE INDEX IF NOT EXISTS idx_save_paths_game_id ON save_paths(game_id);

    -- Save Vault: backup history (1 row = 1 timestamped folder inside the vault)
    CREATE TABLE IF NOT EXISTS save_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      backup_dir TEXT NOT NULL,
      slot_time TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      trigger TEXT NOT NULL DEFAULT 'manual',
      note TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_save_backups_game_id ON save_backups(game_id);
    CREATE INDEX IF NOT EXISTS idx_save_backups_slot ON save_backups(slot_time);

    -- Generic key-value settings (vault root, preferences, ...)
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- Tombstone for deleted / dismissed games so auto-importer won't resurrect them
    CREATE TABLE IF NOT EXISTS deleted_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE COLLATE NOCASE,
      exe_name TEXT DEFAULT NULL,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  try {
    db.exec('ALTER TABLE deleted_games ADD COLUMN steam_id INTEGER DEFAULT NULL');
  } catch {}
  try {
    db.exec('ALTER TABLE deleted_games ADD COLUMN game_key TEXT DEFAULT NULL');
  } catch {}
}

// ==========================================
// Games CRUD Operations
// ==========================================

export function getGames(filter?: GameFilter): Game[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.status && filter.status !== 'all') {
    conditions.push('games.status = ?');
    params.push(filter.status);
  }

  if (filter?.search && filter.search.trim().length > 0) {
    conditions.push('(games.title LIKE ? OR games.exe_name LIKE ?)');
    const searchTerm = `%${filter.search.trim()}%`;
    params.push(searchTerm, searchTerm);
  }

  let whereClause = '';
  if (conditions.length > 0) {
    whereClause = `WHERE ${conditions.join(' AND ')}`;
  }

  let orderClause = 'ORDER BY games.playtime_minutes DESC, games.title ASC';
  if (filter?.sort) {
    switch (filter.sort) {
      case 'playtime_desc':
        orderClause = 'ORDER BY games.playtime_minutes DESC, games.title ASC';
        break;
      case 'playtime_asc':
        orderClause = 'ORDER BY games.playtime_minutes ASC, games.title ASC';
        break;
      case 'rating_desc':
        orderClause = 'ORDER BY (CASE WHEN games.user_rating IS NULL OR games.user_rating <= 0 THEN 0 ELSE 1 END) DESC, games.user_rating DESC, games.playtime_minutes DESC';
        break;
      case 'title_asc':
        orderClause = 'ORDER BY games.title ASC';
        break;
      case 'recent_played':
        orderClause = `ORDER BY (
          SELECT MAX(start_time) FROM sessions WHERE sessions.game_id = games.id AND COALESCE(sessions.source, '') != 'manual'
        ) DESC NULLS LAST, games.updated_at DESC`;
        break;
      case 'created_desc':
        orderClause = 'ORDER BY games.created_at DESC';
        break;
    }
  }

  const query = `
    SELECT 
      games.*,
      (SELECT MAX(start_time) FROM sessions WHERE sessions.game_id = games.id AND COALESCE(sessions.source, '') != 'manual') AS last_played_at
    FROM games
    ${whereClause}
    ${orderClause}
  `;

  const stmt = db.prepare(query);
  return stmt.all(...params) as unknown as Game[];
}

export function getGameById(id: number): Game | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM games WHERE id = ?');
  const row = stmt.get(id);
  return (row as unknown as Game) || null;
}

export function getGameByTitle(title: string): Game | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM games WHERE title = ? COLLATE NOCASE');
  const row = stmt.get(title);
  return (row as unknown as Game) || null;
}

export function getGameByExeName(exeName: string): Game | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM games WHERE exe_name = ? COLLATE NOCASE');
  const row = stmt.get(exeName);
  return (row as unknown as Game) || null;
}

export function getGameByAmdId(amdGameId: number): Game | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM games WHERE amd_game_id = ?');
  const row = stmt.get(amdGameId);
  return (row as unknown as Game) || null;
}

export function createGame(game: Partial<Game>): Game {
  const db = getDb();
  const title = (game.title || '').trim();
  if (!title) {
    throw new Error('Game title is required');
  }

  const stmt = db.prepare(`
    INSERT INTO games (
      title, exe_name, exe_path, playtime_minutes, user_rating,
      status, cover_url, banner_url, media_folder, completed_at,
      notes, steam_id, uplay_id, origin_id, amd_game_id, manual_playtime_minutes
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  const rawRating = game.user_rating;
  const initialRating = rawRating !== null && rawRating !== undefined && Number(rawRating) > 0 ? Number(rawRating) : null;

  const result = stmt.run(
    title,
    game.exe_name ?? null,
    game.exe_path ?? null,
    game.playtime_minutes ?? 0,
    initialRating,
    game.status ?? 'playing',
    game.cover_url ?? null,
    game.banner_url ?? null,
    game.media_folder ?? null,
    game.completed_at ?? null,
    game.notes ?? null,
    game.steam_id ?? -1,
    game.uplay_id ?? -1,
    game.origin_id ?? -1,
    game.amd_game_id ?? null,
    Math.max(0, (game.playtime_minutes ?? 0) - Math.max(0, Math.min(
      game.playtime_minutes ?? 0,
      game.recorded_playtime_minutes ?? game.playtime_minutes ?? 0
    )))
  );

  const insertedId = Number(result.lastInsertRowid);
  const created = getGameById(insertedId);
  if (!created) {
    throw new Error(`Failed to retrieve newly created game with id ${insertedId}`);
  }
  if ((created.manual_playtime_minutes || 0) > 0) {
    db.prepare(`INSERT INTO sessions
      (game_id, start_time, end_time, duration_minutes, is_running, source)
      VALUES (?, datetime('now', 'localtime'), datetime('now', 'localtime'), ?, 0, 'manual')`)
      .run(insertedId, created.manual_playtime_minutes!);
  }
  return created;
}

export function updateGame(id: number, data: Partial<Game>): Game {
  const db = getDb();
  let existing = getGameById(id);
  if (!existing) {
    throw new Error(`Game with id ${id} not found`);
  }

  // An ordinary edit changes only the manual component. Internal cloud
  // reconciliation supplies both counters explicitly and retains provenance.
  data = { ...data };
  const isManualEdit = 'playtime_minutes' in data && !('recorded_playtime_minutes' in data);
  const manualTotal = data.playtime_minutes;
  if (isManualEdit) {
    delete data.playtime_minutes;
  }

  const fields: string[] = [];
  const params: any[] = [];
  let manualDelta = 0;

  if ('recorded_playtime_minutes' in data) {
    const total = data.playtime_minutes ?? existing.playtime_minutes;
    const recorded = Number(data.recorded_playtime_minutes);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(recorded) || recorded < 0) {
      throw new Error('Invalid playtime provenance');
    }
    fields.push('manual_playtime_minutes = ?');
    const manual = Math.max(0, total - Math.min(total, recorded));
    params.push(manual);
    manualDelta = manual - (existing.manual_playtime_minutes || 0);
  }

  const allowedFields: Array<keyof Game> = [
    'title', 'exe_name', 'exe_path', 'playtime_minutes', 'user_rating',
    'status', 'cover_url', 'banner_url', 'media_folder', 'completed_at',
    'notes', 'steam_id', 'uplay_id', 'origin_id', 'amd_game_id'
  ];

  for (const field of allowedFields) {
    if (field in data) {
      fields.push(`${field} = ?`);
      let val = (data as any)[field];
      if (field === 'user_rating' && (val === 0 || val === '0' || (typeof val === 'number' && val <= 0))) {
        val = null;
      }
      params.push(val);
    }
  }

  if (fields.length === 0) {
    if (isManualEdit) {
      setManualPlaytime(id, manualTotal as number, db);
      return getGameById(id)!;
    }
    return existing;
  }

  fields.push("updated_at = datetime('now', 'localtime')");
  params.push(id);

  const sql = `UPDATE games SET ${fields.join(', ')} WHERE id = ?`;
  db.exec('SAVEPOINT update_game');
  try {
    if (isManualEdit) setManualPlaytime(id, manualTotal as number, db);
    db.prepare(sql).run(...params);
    // Remote/manual-component changes must also reconcile the local audit
    // offset; otherwise a later union recalc could resurrect removed hours.
    if (manualDelta !== 0) {
      db.prepare(`INSERT INTO sessions
        (game_id, start_time, end_time, duration_minutes, is_running, source)
        VALUES (?, datetime('now', 'localtime'), datetime('now', 'localtime'), ?, 0, 'manual')`)
        .run(id, manualDelta);
    }
    db.exec('RELEASE SAVEPOINT update_game');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT update_game');
    db.exec('RELEASE SAVEPOINT update_game');
    throw error;
  }

  const updated = getGameById(id);
  if (!updated) {
    throw new Error(`Failed to retrieve updated game with id ${id}`);
  }
  return updated;
}

export function deleteGame(id: number): boolean {
  const db = getDb();
  try {
    const game = db.prepare('SELECT title, exe_name, steam_id FROM games WHERE id = ?').get(id) as any;
    if (game && game.title) {
      const steamId = typeof game.steam_id === 'number' && game.steam_id > 0 ? game.steam_id : null;
      const slug = String(game.title).toLowerCase().replace(/[^a-z0-9]/g, '');
      const gameKey = steamId ? `s_${steamId}` : `t_${slug}`;
      db.prepare(`
        INSERT INTO deleted_games (title, exe_name, steam_id, game_key)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(title) DO UPDATE SET
          exe_name = COALESCE(excluded.exe_name, deleted_games.exe_name),
          steam_id = COALESCE(excluded.steam_id, deleted_games.steam_id),
          game_key = COALESCE(excluded.game_key, deleted_games.game_key),
          deleted_at = datetime('now', 'localtime')
      `).run(game.title, game.exe_name || null, steamId, gameKey);
    }
  } catch {}
  const stmt = db.prepare('DELETE FROM games WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function getDeletedGames(): Array<{ title: string; exe_name: string | null; steam_id?: number | null; game_key?: string | null; deleted_at: string }> {
  const db = getDb();
  try {
    return (db.prepare('SELECT title, exe_name, steam_id, game_key, deleted_at FROM deleted_games').all() as any[]) || [];
  } catch {
    return [];
  }
}

export function updatePlaytime(gameId: number, additionalMinutes: number): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE games 
    SET 
      playtime_minutes = playtime_minutes + ?,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `);
  stmt.run(Math.max(0, additionalMinutes), gameId);
}

export function setPlaytime(gameId: number, totalMinutes: number): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE games 
    SET 
      playtime_minutes = ?,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `);
  stmt.run(Math.max(0, totalMinutes), gameId);
}

/** Adjust a displayed total without crediting user-entered minutes to rankings. */
export function setManualPlaytime(
  gameId: number,
  totalMinutes: number,
  customDb?: DatabaseSync
): boolean {
  if (typeof totalMinutes !== 'number' || !Number.isFinite(totalMinutes) || totalMinutes < 0) {
    throw new Error('Invalid playtime minutes: must be a non-negative number');
  }
  const db = customDb || getDb();
  const game = db.prepare(`SELECT playtime_minutes, recorded_playtime_minutes
    FROM games WHERE id = ?`).get(gameId) as any;
  if (!game) throw new Error(`Game with ID ${gameId} not found`);
  const recorded = Number(game.recorded_playtime_minutes) || 0;
  if (totalMinutes < recorded) {
    throw new Error('Tổng giờ chơi không được thấp hơn giờ app đã ghi nhận. Chỉ có thể sửa phần giờ tự thêm.');
  }
  const delta = totalMinutes - Number(game.playtime_minutes);
  if (delta === 0) return true;

  db.exec('SAVEPOINT manual_playtime_edit');
  try {
    db.prepare(`UPDATE games SET playtime_minutes = ?, manual_playtime_minutes = ?,
      updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(totalMinutes, totalMinutes - recorded, gameId);
    db.prepare(`INSERT INTO sessions
      (game_id, start_time, end_time, duration_minutes, is_running, source)
      VALUES (?, datetime('now', 'localtime'), datetime('now', 'localtime'), ?, 0, 'manual')`)
      .run(gameId, delta);
    db.exec('RELEASE SAVEPOINT manual_playtime_edit');
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT manual_playtime_edit');
    db.exec('RELEASE SAVEPOINT manual_playtime_edit');
    throw error;
  }
  return true;
}

// ==========================================
// Sessions CRUD Operations
// ==========================================

export function getSessions(gameId?: number): Session[] {
  const db = getDb();
  if (gameId !== undefined) {
    const stmt = db.prepare(`
      SELECT 
        sessions.*,
        games.title as game_title
      FROM sessions
      JOIN games ON games.id = sessions.game_id
      WHERE sessions.game_id = ?
      ORDER BY sessions.start_time DESC
    `);
    return stmt.all(gameId) as unknown as Session[];
  }

  const stmt = db.prepare(`
    SELECT 
      sessions.*,
      games.title as game_title
    FROM sessions
    JOIN games ON games.id = sessions.game_id
    ORDER BY sessions.start_time DESC
  `);
  return stmt.all() as unknown as Session[];
}

export function getSessionById(id: number): Session | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 
      sessions.*,
      games.title as game_title
    FROM sessions
    JOIN games ON games.id = sessions.game_id
    WHERE sessions.id = ?
  `);
  const row = stmt.get(id);
  return (row as unknown as Session) || null;
}

export function getActiveSession(pid?: number): Session | null {
  const db = getDb();
  if (pid !== undefined) {
    const stmt = db.prepare(`
      SELECT * FROM sessions 
      WHERE is_running = 1 AND pid = ?
      ORDER BY start_time DESC
      LIMIT 1
    `);
    const row = stmt.get(pid);
    return (row as unknown as Session) || null;
  }

  const stmt = db.prepare(`
    SELECT * FROM sessions 
    WHERE is_running = 1
    ORDER BY start_time DESC
    LIMIT 1
  `);
  const row = stmt.get();
  return (row as unknown as Session) || null;
}

export function createSession(session: Partial<Session>): Session {
  const db = getDb();
  if (!session.game_id) {
    throw new Error('game_id is required to create a session');
  }

  const startTime = session.start_time || new Date().toISOString().replace(/\.\d{3}Z$/, '');

  const stmt = db.prepare(`
    INSERT INTO sessions (
      game_id, pid, start_time, end_time, duration_minutes, is_running, source
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const result = stmt.run(
    session.game_id,
    session.pid ?? null,
    startTime,
    session.end_time ?? null,
    session.duration_minutes ?? 0,
    session.is_running ?? 0,
    session.source ?? 'tracker'
  );

  const insertedId = Number(result.lastInsertRowid);
  const created = getSessionById(insertedId);
  if (!created) {
    throw new Error(`Failed to retrieve newly created session with id ${insertedId}`);
  }
  return created;
}

export function updateSession(id: number, data: Partial<Session>): Session {
  const db = getDb();
  const existing = getSessionById(id);
  if (!existing) {
    throw new Error(`Session with id ${id} not found`);
  }

  const fields: string[] = [];
  const params: any[] = [];

  const allowedFields: Array<keyof Session> = [
    'game_id', 'pid', 'start_time', 'end_time', 'duration_minutes', 'is_running', 'source'
  ];

  for (const field of allowedFields) {
    if (field in data) {
      fields.push(`${field} = ?`);
      const val = (data as any)[field];
      params.push(val);
    }
  }

  if (fields.length === 0) {
    return existing;
  }

  params.push(id);
  const sql = `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);

  const updated = getSessionById(id);
  if (!updated) {
    throw new Error(`Failed to retrieve updated session with id ${id}`);
  }
  return updated;
}

export function deleteSession(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ==========================================
// FPS Metrics (PresentMon) & Leaderboard
// ==========================================

export interface SessionFpsMetrics {
  fps_avg: number;
  fps_samples: number;
  fps_1pct_low?: number | null;
}

/**
 * Stores measured FPS metrics on a session row. Best-effort: a missing
 * session (deleted while capture was in flight) must not throw.
 */
export function updateSessionFps(sessionId: number, metrics: SessionFpsMetrics): void {
  const db = getDb();
  const fpsAvg = Number.isFinite(metrics.fps_avg) && metrics.fps_avg > 0 ? Math.round(metrics.fps_avg * 10) / 10 : null;
  const samples = Math.max(0, Math.round(metrics.fps_samples || 0));
  const low = metrics.fps_1pct_low != null && Number.isFinite(metrics.fps_1pct_low) && metrics.fps_1pct_low > 0
    ? Math.round(metrics.fps_1pct_low * 10) / 10
    : null;
  try {
    db.prepare(`
      UPDATE sessions
      SET fps_avg = ?, fps_samples = ?, fps_1pct_low = ?
      WHERE id = ?
    `).run(fpsAvg, samples > 0 ? samples : null, low, sessionId);
  } catch {
    // Session may have been deleted mid-capture — drop the metrics silently
  }
}

/**
 * Aggregates per-game FPS stats across all measured sessions (weighted by
 * frame sample count) — the data foundation for the performance leaderboard.
 */
export function getFpsLeaderboard(): any[] {
  const db = getDb();
  // Older DBs / test schemas may not have the fps columns yet
  try {
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as any[];
    if (!columns.some((c: any) => c.name === 'fps_avg')) {
      return [];
    }
  } catch {
    return [];
  }

  const stmt = db.prepare(`
    SELECT
      games.id AS game_id,
      games.title,
      games.cover_url,
      SUM(sessions.fps_avg * sessions.fps_samples) / NULLIF(SUM(sessions.fps_samples), 0) AS fps_avg,
      MAX(sessions.fps_avg) AS best_fps,
      MIN(sessions.fps_avg) AS worst_fps,
      SUM(sessions.fps_1pct_low * sessions.fps_samples) / NULLIF(SUM(CASE WHEN sessions.fps_1pct_low IS NOT NULL THEN sessions.fps_samples ELSE 0 END), 0) AS fps_1pct_low,
      SUM(sessions.fps_samples) AS samples,
      COUNT(sessions.id) AS sessions_with_fps,
      MAX(sessions.end_time) AS last_measured
    FROM sessions
    JOIN games ON games.id = sessions.game_id
    WHERE sessions.fps_avg IS NOT NULL AND sessions.fps_samples IS NOT NULL AND sessions.fps_samples > 0
    GROUP BY games.id
    ORDER BY fps_avg DESC
  `);
  return stmt.all() as unknown as any[];
}

// ==========================================
// Screenshot Sync History
// ==========================================

export function recordScreenshotSync(
  sync: {
    game_id: number;
    session_id?: number | null;
    original_filename: string;
    target_path: string;
    file_timestamp: string;
  },
  customDb?: DatabaseSync
): void {
  const db = customDb || getDb();
  const stmt = db.prepare(`
    INSERT INTO screenshot_sync_history (
      game_id, session_id, original_filename, target_path, file_timestamp
    ) VALUES (
      ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    sync.game_id,
    sync.session_id ?? null,
    sync.original_filename,
    sync.target_path,
    sync.file_timestamp
  );
}

export function getScreenshotSyncHistory(gameId?: number): any[] {
  const db = getDb();
  if (gameId !== undefined) {
    const stmt = db.prepare(`
      SELECT * FROM screenshot_sync_history
      WHERE game_id = ?
      ORDER BY synced_at DESC
    `);
    return stmt.all(gameId);
  }

  const stmt = db.prepare(`
    SELECT * FROM screenshot_sync_history
    ORDER BY synced_at DESC
  `);
  return stmt.all();
}

// ==========================================
// Pending F6 Captures Queue Operations
// ==========================================

export function recordPendingF6Capture(
  gameId: number,
  gameTitle: string,
  timestamp: string,
  customDb?: DatabaseSync
): number {
  const db = customDb || getDb();
  const res = db.prepare(`
    INSERT INTO pending_f6_captures (game_id, game_title, timestamp, matched)
    VALUES (?, ?, ?, 0)
  `).run(gameId, gameTitle, timestamp);
  return Number(res.lastInsertRowid);
}

export function getUnmatchedF6Captures(customDb?: DatabaseSync): Array<{
  id: number;
  game_id: number;
  game_title: string;
  timestamp: string;
}> {
  const db = customDb || getDb();
  return db.prepare(`
    SELECT id, game_id, game_title, timestamp
    FROM pending_f6_captures
    WHERE matched = 0
    ORDER BY timestamp ASC
  `).all() as any;
}

export function markF6CaptureMatched(id: number, customDb?: DatabaseSync): void {
  const db = customDb || getDb();
  db.prepare(`
    UPDATE pending_f6_captures
    SET matched = 1
    WHERE id = ?
  `).run(id);
}

// ==========================================
// Save Vault Operations
// ==========================================

export function getSavePaths(gameId: number): SavePathConfig[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM save_paths
    WHERE game_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  return stmt.all(gameId) as unknown as SavePathConfig[];
}

export function getSavePathById(id: number): SavePathConfig | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM save_paths WHERE id = ?').get(id);
  return (row as unknown as SavePathConfig) || null;
}

export function addSavePath(gameId: number, sourcePath: string, label: string = ''): SavePathConfig {
  const db = getDb();
  const normalized = String(sourcePath || '').trim();
  if (!normalized) {
    throw new Error('source_path is required');
  }
  // Store canonical Windows form (forward slashes happen on manual typing)
  const canonical = path.resolve(normalized);
  try {
    const res = db.prepare(`
      INSERT INTO save_paths (game_id, source_path, label, enabled)
      VALUES (?, ?, ?, 1)
    `).run(gameId, canonical, (label || '').trim());
    const id = Number(res.lastInsertRowid);
    return getSavePathById(id) as SavePathConfig;
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE')) {
      throw new Error('Save path already configured for this game');
    }
    throw err;
  }
}

export function removeSavePath(id: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM save_paths WHERE id = ?').run(id);
  return res.changes > 0;
}

export function setSavePathEnabled(id: number, enabled: boolean): SavePathConfig {
  const db = getDb();
  const res = db
    .prepare('UPDATE save_paths SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id);
  if (res.changes === 0) {
    throw new Error(`Save path with id ${id} not found`);
  }
  return getSavePathById(id) as SavePathConfig;
}

export function recordSaveBackup(backup: {
  game_id: number;
  backup_dir: string;
  slot_time: string;
  size_bytes: number;
  file_count: number;
  trigger: string;
  note?: string | null;
}): SaveBackup {
  const db = getDb();
  const res = db.prepare(`
    INSERT INTO save_backups (
      game_id, backup_dir, slot_time, size_bytes, file_count, trigger, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    backup.game_id,
    backup.backup_dir,
    backup.slot_time,
    Math.max(0, Math.round(backup.size_bytes)),
    Math.max(0, Math.round(backup.file_count)),
    backup.trigger || 'manual',
    backup.note ?? null
  );
  const id = Number(res.lastInsertRowid);
  const row = db.prepare('SELECT * FROM save_backups WHERE id = ?').get(id);
  return (row as unknown as SaveBackup);
}

export function getSaveBackups(gameId: number): SaveBackup[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM save_backups
    WHERE game_id = ?
    ORDER BY slot_time DESC, id DESC
  `);
  return stmt.all(gameId) as unknown as SaveBackup[];
}

export function getSaveBackupById(id: number): SaveBackup | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM save_backups WHERE id = ?').get(id);
  return (row as unknown as SaveBackup) || null;
}

export function getSaveBackupByDir(backupDir: string): SaveBackup | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM save_backups WHERE backup_dir = ? COLLATE NOCASE')
    .get(backupDir);
  return (row as unknown as SaveBackup) || null;
}

export function deleteSaveBackupRow(id: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM save_backups WHERE id = ?').run(id);
  return res.changes > 0;
}

export function updateSaveBackupRow(
  id: number,
  patch: { note?: string | null; trigger?: string }
): SaveBackup | null {
  const db = getDb();
  const existing = getSaveBackupById(id);
  if (!existing) return null;
  const note = patch.note !== undefined ? patch.note : existing.note ?? null;
  const trigger = patch.trigger !== undefined ? patch.trigger : existing.trigger;
  db.prepare('UPDATE save_backups SET note = ?, trigger = ? WHERE id = ?').run(note, trigger, id);
  return getSaveBackupById(id);
}

export function countSaveBackups(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM save_backups').get() as any;
  return Number(row?.n || 0);
}

// ==========================================
// Playtime Recalculation (union of session intervals)
// ==========================================

export interface PlaytimeRecalcSummary {
  updated: number;
  creditedMinutes: number;
}

/**
 * Parses both timestamp formats stored in sessions: tracker rows use ISO UTC
 * ("2026-11-22T08:24:29.929Z"), amd_import/manual rows use local
 * "YYYY-MM-DD HH:MM:SS". The space → 'T' swap follows the same convention as
 * recoverStaleSessions, so both forms land on comparable epoch milliseconds.
 */
function parseSessionTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = new Date(value.trim().replace(' ', 'T')).getTime();
  return isFinite(ms) ? ms : null;
}

/**
 * Rebuilds a game's true playtime from its session rows:
 * union of tracker + amd_import intervals (overlaps — e.g. the tracker and
 * AMD recording the same live session — count once) plus the accumulated
 * manual adjustments. Updates games.playtime_minutes ratchet-style:
 * only upward, so historical totals imported from AMD's lifetime counters
 * and user-edited values are never lost.
 */
export function recalculatePlaytime(
  customDb?: DatabaseSync,
  gameIds?: number[]
): PlaytimeRecalcSummary {
  const db = customDb || getDb();
  const nowMs = Date.now();

  let targets: Array<{ id: number }>;
  if (gameIds && gameIds.length > 0) {
    const placeholders = gameIds.map(() => '?').join(',');
    targets = db
      .prepare(`SELECT id FROM games WHERE id IN (${placeholders})`)
      .all(...gameIds) as Array<{ id: number }>;
  } else {
    targets = db.prepare('SELECT id FROM games').all() as Array<{ id: number }>;
  }

  const sessionStmt = db.prepare(`
    SELECT source, start_time, end_time, last_poll, duration_minutes
    FROM sessions WHERE game_id = ?
  `);
  const updateStmt = db.prepare(`
    UPDATE games
    SET playtime_minutes = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ? AND playtime_minutes < ?
  `);

  const summary: PlaytimeRecalcSummary = { updated: 0, creditedMinutes: 0 };

  for (const game of targets) {
    const rows = sessionStmt.all(game.id) as any[];
    if (!rows.length) continue;

    const intervals: Array<[number, number]> = [];
    let manualMinutes = 0;

    for (const r of rows) {
      if (r.source === 'manual') {
        // Manual edits are stored as audit rows carrying the +/- delta
        manualMinutes += Number(r.duration_minutes) || 0;
        continue;
      }
      const startMs = parseSessionTimestamp(r.start_time);
      if (startMs === null) continue;
      let endMs = parseSessionTimestamp(r.end_time);
      if (endMs === null) {
        // Still running: count up to the last confirmed poll so live play accrues
        endMs = parseSessionTimestamp(r.last_poll);
      }
      if (endMs === null || endMs <= startMs) continue;
      intervals.push([startMs, Math.min(endMs, nowMs)]);
    }

    intervals.sort((a, b) => a[0] - b[0]);
    let unionMs = 0;
    let cursorEnd = -1;
    for (const [start, end] of intervals) {
      if (start > cursorEnd) {
        unionMs += end - start;
        cursorEnd = end;
      } else if (end > cursorEnd) {
        unionMs += end - cursorEnd;
        cursorEnd = end;
      }
    }

    const unionMinutes = Math.round(unionMs / 60000);
    const recalculated = unionMinutes + manualMinutes;
    const beforeRow = db
      .prepare('SELECT playtime_minutes FROM games WHERE id = ?')
      .get(game.id) as any;
    const res = updateStmt.run(recalculated, game.id, recalculated);
    if (res.changes > 0) {
      summary.updated++;
      summary.creditedMinutes += Math.max(
        0,
        recalculated - (Number(beforeRow?.playtime_minutes) || 0)
      );
    }
  }

  return summary;
}

// ==========================================
// Fragmented Session Merge (churn cleanup)
// ==========================================

export interface MergeFragmentsSummary {
  mergedGroups: number;
  removedRows: number;
  gameIds: number[];
}

interface MergeRow {
  id: number;
  game_id: number;
  pid: number | null;
  startMs: number;
  endMs: number;
  lastPollMs: number | null;
  fps_avg: number | null;
  fps_samples: number | null;
  fps_1pct_low: number | null;
  hasPerformanceContext: boolean;
}

/**
 * Collapses back-to-back 1-minute tracker sessions (the churn left behind by
 * the foreground-detection bug: unfocused grace closed a session every ~30s and
 * the background scan immediately reopened it) into one continuous session per
 * play period. Consecutive same-game tracker rows whose gap is smaller than
 * `resumeWindowMs` become a single row spanning first start → last end, with
 * FPS metrics recombined sample-weighted. amd_import / manual rows are never
 * touched. Runs at startup; idempotent.
 */
export function mergeFragmentedSessions(
  customDb?: DatabaseSync,
  resumeWindowMs: number = 120_000
): MergeFragmentsSummary {
  const db = customDb || getDb();
  const summary: MergeFragmentsSummary = { mergedGroups: 0, removedRows: 0, gameIds: [] };

  // Older DBs may lack the fps columns
  let columns: Array<{ name: string }> = [];
  try {
    columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  } catch {
    return summary;
  }
  const hasFps = columns.some((c) => c.name === 'fps_avg');
  const fpsSelect = hasFps ? ', fps_avg, fps_samples, fps_1pct_low' : '';
  const hasContextTable = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='performance_session_context'").get();
  const contextSelect = hasContextTable
    ? ', EXISTS(SELECT 1 FROM performance_session_context c WHERE c.session_id=sessions.id AND c.game_id=sessions.game_id) AS has_context'
    : ', 0 AS has_context';

  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT id, game_id, pid, start_time, end_time, is_running, last_poll${fpsSelect}${contextSelect}
         FROM sessions WHERE source = 'tracker' ORDER BY game_id, start_time, id`
      )
      .all() as any[];
  } catch {
    return summary;
  }

  const GRACE_MS = 30_000;
  const parsed: MergeRow[] = [];
  for (const r of rows) {
    const startMs = parseSessionTimestamp(r.start_time);
    if (startMs === null) continue;
    let endMs = parseSessionTimestamp(r.end_time);
    if (endMs === null || r.is_running) {
      // Stuck running rows (app killed mid-churn): close at last poll + grace
      const pollMs = parseSessionTimestamp(r.last_poll);
      endMs = Math.max(pollMs ?? startMs, startMs) + GRACE_MS;
    }
    parsed.push({
      id: Number(r.id),
      game_id: Number(r.game_id),
      pid: r.pid != null ? Number(r.pid) : null,
      startMs,
      endMs: Math.max(endMs, startMs),
      lastPollMs: parseSessionTimestamp(r.last_poll),
      fps_avg: hasFps && r.fps_avg != null ? Number(r.fps_avg) : null,
      fps_samples: hasFps && r.fps_samples != null ? Number(r.fps_samples) : null,
      fps_1pct_low: hasFps && r.fps_1pct_low != null ? Number(r.fps_1pct_low) : null,
      hasPerformanceContext: !!r.has_context,
    });
  }

  const toIso = (ms: number) => new Date(ms).toISOString();
  const updateStmt = db.prepare(
    `UPDATE sessions
     SET start_time = ?, end_time = ?, duration_minutes = ?, is_running = 0, last_poll = ?,
         pid = ?, fps_avg = ?, fps_samples = ?, fps_1pct_low = ?
     WHERE id = ?`
  );
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const touchedGames = new Set<number>();

  // Walk per-game chains: merge when the next start overlaps the running end
  // or falls within the resume window
  let chain: MergeRow[] = [];
  const flushChain = () => {
    if (chain.length === 0) return;
    if (chain.length > 1) {
      const first = chain[0];
      const last = chain[chain.length - 1];
      const startMs = Math.min(...chain.map((r) => r.startMs));
      const endMs = Math.max(...chain.map((r) => r.endMs));
      const pollMs = Math.max(...chain.map((r) => r.lastPollMs ?? 0), startMs);

      // FPS metrics: sample-weighted average across merged rows
      let sumWeightedAvg = 0;
      let sumWeightedLow = 0;
      let samples = 0;
      for (const r of chain) {
        const s = r.fps_samples ?? 0;
        if (s > 0 && r.fps_avg != null) {
          sumWeightedAvg += r.fps_avg * s;
          if (r.fps_1pct_low != null) sumWeightedLow += r.fps_1pct_low * s;
          samples += s;
        }
      }
      const fpsAvg = samples > 0 ? Math.round((sumWeightedAvg / samples) * 10) / 10 : null;
      const fpsLow = samples > 0 && sumWeightedLow > 0
        ? Math.round((sumWeightedLow / samples) * 10) / 10
        : null;

      updateStmt.run(
        toIso(startMs),
        toIso(endMs),
        Math.max(1, Math.round((endMs - startMs) / 60000)),
        toIso(pollMs),
        last.pid != null ? last.pid : null,
        fpsAvg,
        samples > 0 ? samples : null,
        fpsLow,
        first.id
      );
      for (let i = 1; i < chain.length; i++) {
        deleteStmt.run(chain[i].id);
      }
      summary.mergedGroups++;
      summary.removedRows += chain.length - 1;
      touchedGames.add(first.game_id);
    }
    chain = [];
  };

  for (const row of parsed) {
    // Modern benchmark sessions are immutable measurement units. Legacy churn
    // repair must not merge or bridge across their hardware/graphics context.
    if (row.hasPerformanceContext) {
      flushChain();
      continue;
    }
    if (
      chain.length > 0 &&
      (row.game_id !== chain[0].game_id ||
        row.startMs > chain[chain.length - 1].endMs + resumeWindowMs)
    ) {
      flushChain();
    }
    chain.push(row);
  }
  flushChain();

  if (touchedGames.size > 0) {
    try {
      recalculatePlaytime(db, [...touchedGames]);
    } catch {}
  }
  summary.gameIds = [...touchedGames];
  return summary;
}

// ==========================================
// App Settings (key-value)
// ==========================================

export function getSetting(key: string, customDb?: DatabaseSync): string | null {
  const db = customDb || getDb();
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string, customDb?: DatabaseSync): void {
  const db = customDb || getDb();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now', 'localtime')
  `).run(key, value);
}

export function deleteSetting(key: string, customDb?: DatabaseSync): boolean {
  const db = customDb || getDb();
  const res = db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  return res.changes > 0;
}
