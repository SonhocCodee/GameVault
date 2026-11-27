import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, getDb, getDefaultDbPath, getSetting, initDb, setSetting } from './db.ts';

export const LIBRARY_ACCOUNT_KEY = 'library_account_uid';
const GUEST = '__guest__';
const HISTORY_PATH_KEY = 'device_account_history_path';
interface AccountInterval { uid: string | null; start: number; end: number | null }

function recordAccountInterval(uid: string | null, directory: string, legacyOwner: string | null): string {
  const file = path.join(directory, 'device-account-history.json');
  const now = Date.now();
  const history: AccountInterval[] = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : legacyOwner ? [{ uid: legacyOwner, start: 0, end: null }] : [];
  if (legacyOwner && history[0]?.start > 0) {
    history.unshift({ uid: legacyOwner, start: 0, end: history[0].start });
  }
  const last = history[history.length - 1];
  if (!last || last.uid !== uid || last.end !== null) {
    if (last && last.end === null) last.end = now;
    history.push({ uid, start: now, end: null });
  }
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(history), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
  return file;
}

// Only device preferences cross account boundaries. Sync checkpoints, reviews,
// save identities, graphics and other personal settings stay in their own DB.
const DEVICE_SETTINGS = new Set([
  'screenshot_enabled', 'screenshot_hotkey', 'screenshot_hotkey_vk',
  'screenshots_dir', 'media_base_dir', 'save_vault_root', 'auto_detect_games',
  'poll_interval_seconds', 'amd_watcher_enabled', 'auto_enrich_covers',
  'close_to_tray', 'app_startup_enabled', 'setup_completed',
  'playtime_watch_enabled', 'hdd_mode',
]);

export function accountLibraryPath(uid: string, directory = path.dirname(getDefaultDbPath())): string {
  const key = crypto.createHash('sha256').update(uid).digest('hex');
  return path.join(directory, `gamevault.account.${key}.db`);
}

export function persistDevicePreferences(directory = path.dirname(getDefaultDbPath())): void {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
  const preferences = Object.fromEntries(rows.filter(row => DEVICE_SETTINGS.has(row.key)).map(row => [row.key, row.value]));
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'device-preferences.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(preferences), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

export function openAccountLibrary(uid: string | null, directory = path.dirname(getDefaultDbPath())): DatabaseSync {
  try {
    return initializeAccountLibrary(uid, directory);
  } catch (error) {
    // A failed switch must never fall back to the shared legacy database.
    closeDb();
    const empty = initDb(':memory:');
    setSetting(LIBRARY_ACCOUNT_KEY, GUEST, empty);
    throw error;
  }
}

function initializeAccountLibrary(uid: string | null, directory: string): DatabaseSync {
  closeDb();
  fs.mkdirSync(directory, { recursive: true });
  const legacyPath = path.join(directory, 'gamevault.db');
  let legacyOwner: string | null = null;
  let preferences: Record<string, string> = {};
  if (fs.existsSync(legacyPath)) {
    const legacy = new DatabaseSync(legacyPath, { readOnly: true });
    try {
      const rows = legacy.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
      legacyOwner = rows.find(row => row.key === LIBRARY_ACCOUNT_KEY)?.value || null;
      preferences = Object.fromEntries(rows.filter(row => DEVICE_SETTINGS.has(row.key)).map(row => [row.key, row.value]));
      // Never silently give an unowned legacy library to the next login.
      // A verified owner marker allows a one-time, non-destructive migration.
      if (uid && legacyOwner === uid && !fs.existsSync(accountLibraryPath(uid, directory))) {
        const destination = accountLibraryPath(uid, directory);
        const temporary = `${destination}.migrating`;
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        legacy.prepare('VACUUM INTO ?').run(temporary);
        fs.renameSync(temporary, destination);
      }
    } finally {
      legacy.close();
    }
  }
  const preferencesFile = path.join(directory, 'device-preferences.json');
  if (fs.existsSync(preferencesFile)) {
    const saved = JSON.parse(fs.readFileSync(preferencesFile, 'utf8'));
    preferences = { ...preferences, ...saved };
  }
  // Guest data is deliberately ephemeral; background importers are disabled.
  const db = initDb(uid ? accountLibraryPath(uid, directory) : ':memory:');
  for (const [key, value] of Object.entries(preferences)) {
    if (DEVICE_SETTINGS.has(key) && typeof value === 'string') setSetting(key, value, db);
  }
  setSetting(LIBRARY_ACCOUNT_KEY, uid || GUEST, db);
  setSetting(HISTORY_PATH_KEY, recordAccountInterval(uid, directory, legacyOwner), db);
  return db;
}

export function assertLibraryAccount(uid: string, expectedDb = getDb()): void {
  if (getDb() !== expectedDb) throw new Error('Library account changed during operation');
  const owner = getSetting(LIBRARY_ACCOUNT_KEY, expectedDb);
  if (!uid) throw new Error('Chưa đăng nhập');
  // Unmanaged databases are used by isolated import tools and existing tests.
  if (owner !== null && owner !== uid) throw new Error('Library belongs to another account');
}

export function canImportDeviceHistory(db = getDb()): boolean {
  return getSetting(LIBRARY_ACCOUNT_KEY, db) !== GUEST;
}

/** Attribute shared AMD/watchdog intervals only to the account active then. */
export function ownedSessionSlices(db: DatabaseSync, start: string, end: string | null): Array<{ start: string; end: string | null; isRunning: boolean }> {
  const uid = getSetting(LIBRARY_ACCOUNT_KEY, db);
  if (uid === null) return [{ start, end, isRunning: true }];
  if (uid === GUEST) return [];
  const file = getSetting(HISTORY_PATH_KEY, db);
  if (!file) return [];
  const from = new Date(start.replace(' ', 'T')).getTime();
  const until = end ? new Date(end.replace(' ', 'T')).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) return [];
  const history: AccountInterval[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  return history.filter(interval => interval.uid === uid).flatMap(interval => {
    const clippedFrom = Math.max(from, interval.start);
    const clippedUntil = Math.min(until, interval.end ?? Infinity);
    if (clippedUntil <= clippedFrom) return [];
    return [{
      start: clippedFrom === from ? start : new Date(clippedFrom).toISOString(),
      end: clippedUntil === until && end ? end : new Date(clippedUntil).toISOString(),
      isRunning: interval.end === null,
    }];
  });
}
