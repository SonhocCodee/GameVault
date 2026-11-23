import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createTestDb, createTempDirectory, cleanupTempDirectory } from './test-helpers.js';
import { loadAppSettings, saveAppSettings } from '../src/main/settings.ts';
import { resolveMediaRoot, setMediaBaseDir, DEFAULT_MEDIA_ROOT } from '../src/main/media.ts';
import { PlaytimeWatchImporter, getPlaytimeWatchLogPath } from '../src/main/ptwatch.ts';
import { recalculatePlaytime } from '../src/main/db.ts';

describe('Media root resolver (đổi ổ lưu ảnh)', () => {
  afterEach(() => {
    // Module state is global — always reset back to defaults after each case
    setMediaBaseDir(null);
  });

  it('falls back to the production default when nothing is configured', () => {
    assert.equal(resolveMediaRoot(), DEFAULT_MEDIA_ROOT);
  });

  it('follows the configured media drive for every resolver default', () => {
    setMediaBaseDir('D:\\TestMedia');
    assert.equal(resolveMediaRoot(), 'D:\\TestMedia');
    // Explicit args still win (tests / explicit callers)
    assert.equal(resolveMediaRoot('X:\\Explicit'), 'X:\\Explicit');
  });

  it('resets to the default when cleared or blank', () => {
    setMediaBaseDir('D:\\TestMedia');
    setMediaBaseDir('');
    assert.equal(resolveMediaRoot(), DEFAULT_MEDIA_ROOT);
  });

  it('round-trips through loadAppSettings/saveAppSettings', () => {
    const db = createTestDb(':memory:');
    try {
      const s1 = loadAppSettings(db);
      assert.equal(s1.setupCompleted, false, 'first launch shows the setup wizard');
      assert.equal(s1.playtimeWatchEnabled, true, 'watchdog defaults ON');

      saveAppSettings({ mediaBaseDir: 'D:\\GameMedia', setupCompleted: true, playtimeWatchEnabled: false }, db);
      const s2 = loadAppSettings(db);
      assert.equal(s2.setupCompleted, true);
      assert.equal(s2.playtimeWatchEnabled, false);
      assert.equal(s2.mediaBaseDir, 'D:\\GameMedia');
    } finally {
      db.close();
    }
  });
});

describe('Playtime watchdog importer (script chạy ngầm)', () => {
  let db;
  let tempDir;
  let logPath;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_ptwatch_');
    logPath = path.join(tempDir, 'playtime-watch.json');
    db = createTestDb(':memory:');
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {}
    }
    cleanupTempDirectory(tempDir);
  });

  const insertGame = (title, exeName) => {
    const res = db.prepare('INSERT INTO games (title, exe_name, playtime_minutes) VALUES (?, ?, 0)')
      .run(title, exeName);
    return Number(res.lastInsertRowid);
  };

  let fakeMtime = Date.now();
  const writeLog = (payload) => {
    fs.writeFileSync(logPath, JSON.stringify(payload), 'utf-8');
    fakeMtime += 1000;
    fs.utimesSync(logPath, new Date(fakeMtime), new Date(fakeMtime));
  };

  const makeImporter = () => {
    const imp = new PlaytimeWatchImporter();
    imp.autoRegisterGames = false; // keep cover enrichment out of unit tests
    return imp;
  };

  it('imports watchdog sessions for known games (source=ptwatch)', () => {
    const gameId = insertGame('Resident Evil Requiem', 're9.exe');
    writeLog({
      v: 1,
      sessions: [{ exe: 're9.exe', path: 'F:\\Games\\Re9\\re9.exe', pid: 42, start: '2026-11-22T12:18:21.000', end: '2026-11-22T15:24:22.000' }],
      running: null,
    });

    const summary = makeImporter().checkAndSync(db, logPath);
    assert.equal(summary.importedSessions, 1);

    const row = db.prepare("SELECT * FROM sessions WHERE source = 'ptwatch'").get();
    assert.ok(row);
    assert.equal(row.game_id, gameId);
    assert.equal(row.duration_minutes, 186);
    assert.equal(row.is_running, 0);

    recalculatePlaytime(db, [gameId]);
    assert.equal(db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId).playtime_minutes, 186);
  });

  it('is idempotent — re-importing the same log never duplicates sessions', () => {
    insertGame('Resident Evil Requiem', 're9.exe');
    writeLog({
      v: 1,
      sessions: [{ exe: 're9.exe', pid: 42, start: '2026-11-22T12:18:21.000', end: '2026-11-22T15:24:22.000' }],
    });

    const imp = makeImporter();
    imp.checkAndSync(db, logPath);
    imp.checkAndSync(db, logPath); // second cycle, same file

    const count = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE source = 'ptwatch'").get();
    assert.equal(count.c, 1);
  });

  it('delta-syncs the live running session as its last-stamp advances', () => {
    const gameId = insertGame('Resident Evil Requiem', 're9.exe');

    writeLog({ v: 1, sessions: [], running: { exe: 're9.exe', pid: 42, start: '2026-11-22T10:00:00.000', last: '2026-11-22T10:30:00.000' } });
    const imp = makeImporter();
    imp.checkAndSync(db, logPath);

    let row = db.prepare("SELECT * FROM sessions WHERE source = 'ptwatch'").get();
    assert.ok(row, 'running session is imported');
    assert.equal(row.is_running, 1);
    assert.equal(row.duration_minutes, 30);

    // 30 minutes later the watchdog has advanced the running session's stamp
    writeLog({ v: 1, sessions: [], running: { exe: 're9.exe', pid: 42, start: '2026-11-22T10:00:00.000', last: '2026-11-22T11:00:00.000' } });
    imp.checkAndSync(db, logPath);

    const count = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE source = 'ptwatch'").get();
    assert.equal(count.c, 1, 'still a single row');
    row = db.prepare("SELECT * FROM sessions WHERE source = 'ptwatch'").get();
    assert.equal(row.duration_minutes, 60, 'duration synced forward');

    recalculatePlaytime(db, [gameId]);
    assert.equal(db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId).playtime_minutes, 60);
  });

  it('unions with tracker sessions instead of double counting', () => {
    const gameId = insertGame('Elden Ring', 'eldenring.exe');
    // The in-app tracker recorded the same wall-clock window the watchdog saw
    db.prepare(`
      INSERT INTO sessions (game_id, start_time, end_time, duration_minutes, is_running, source)
      VALUES (?, '2026-11-22T12:00:00', '2026-11-22T12:40:00', 40, 0, 'tracker')
    `).run(gameId);
    writeLog({
      v: 1,
      sessions: [{ exe: 'eldenring.exe', pid: 7, start: '2026-11-22T12:20:00.000', end: '2026-11-22T13:00:00.000' }],
    });

    makeImporter().checkAndSync(db, logPath);
    recalculatePlaytime(db, [gameId]);

    // 12:00 → 13:00 union, not 40 + 40
    assert.equal(db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId).playtime_minutes, 60);
  });

  it('skips unknown exes when auto-register is disabled', () => {
    insertGame('Known Game', 'knowngame.exe');
    writeLog({
      v: 1,
      sessions: [
        { exe: 'knowngame.exe', pid: 1, start: '2026-11-22T10:00:00.000', end: '2026-11-22T10:10:00.000' },
        { exe: 'totallyunknown.exe', pid: 2, start: '2026-11-22T11:00:00.000', end: '2026-11-22T11:20:00.000' },
      ],
    });

    const summary = makeImporter().checkAndSync(db, logPath);
    assert.equal(summary.importedSessions, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM games').get().c, 1, 'no game auto-created');
  });

  it('survives a torn/partial log write (skip the cycle)', () => {
    insertGame('Some Game', 'somegame.exe');
    fs.writeFileSync(logPath, '{"v":1,"sessions":[{"exe":"some', 'utf-8');
    const summary = makeImporter().checkAndSync(db, logPath);
    assert.equal(summary.importedSessions, 0);
    assert.equal(summary.updated, false);
  });

  it('resolves the production log path inside the DB directory', () => {
    const logPathResolved = getPlaytimeWatchLogPath();
    assert.ok(path.isAbsolute(logPathResolved));
    assert.ok(logPathResolved.endsWith('playtime-watch.json'));
  });
});
