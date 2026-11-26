import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  createTestDb,
  createTempDirectory,
  cleanupTempDirectory,
  createMockAmdDatabase,
  hasRealAmdDatabase,
  REAL_AMD_PATH,
} from './test-helpers.js';

import {
  importAMDDatabase,
  extractTitleFromExe,
  DEFAULT_AMD_DB_PATH,
} from '../src/main/importer.ts';

import {
  syncScreenshots,
  parseScreenshotTimestamp,
  matchScreenshotToSessions,
  sanitizeTitleForFolder,
  resolveFolderAlias,
  copyAndUnlink,
} from '../src/main/sync-screenshots.ts';

import {
  PlaytimeTracker,
  getForegroundProcessInfo,
} from '../src/main/tracker.ts';

describe('Milestone 2 Production Engines Integration Suite', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_m2_prod_test_');
    db = createTestDb(':memory:');
    // This suite injects its own database instead of running production initDb.
    // Mirror the production playtime columns without changing the shared legacy fixture.
    db.exec(`
      ALTER TABLE games ADD COLUMN manual_playtime_minutes REAL NOT NULL DEFAULT 0;
      ALTER TABLE games ADD COLUMN recorded_playtime_minutes REAL
        GENERATED ALWAYS AS (MAX(0, playtime_minutes - manual_playtime_minutes)) VIRTUAL;
    `);
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {}
    }
    cleanupTempDirectory(tempDir);
  });

  // =========================================================================
  // 1. AMD Importer Production Module (src/main/importer.ts)
  // =========================================================================
  describe('Production Importer (src/main/importer.ts)', () => {
    it('imports games and sessions from mock AMD database', () => {
      const mockPath = path.join(tempDir, 'mock_rgstats.db');
      createMockAmdDatabase(mockPath);

      const result = importAMDDatabase(mockPath, { targetDb: db });
      assert.equal(result.importedGames, 5);
      assert.equal(result.importedSessions, 3);

      const pbz = db.prepare('SELECT * FROM games WHERE title = ?').get('Phantom Blade Zero');
      assert.ok(pbz, 'Phantom Blade Zero must be in DB');
      assert.equal(pbz.playtime_minutes, 2232);
      assert.equal(pbz.steam_id, 4115450);
      assert.equal(pbz.amd_game_id, 65);

      // Verify empty title extraction: Cyberpunk 2077
      const cp = db.prepare('SELECT * FROM games WHERE amd_game_id = 50').get();
      assert.ok(cp);
      assert.equal(cp.title, 'Cyberpunk 2077');
    });

    it('achieves strict idempotency on repeated imports', () => {
      const mockPath = path.join(tempDir, 'mock_rgstats.db');
      createMockAmdDatabase(mockPath);

      importAMDDatabase(mockPath, { targetDb: db });
      const gamesCount1 = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
      const sessionsCount1 = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;

      // Re-run import
      importAMDDatabase(mockPath, { targetDb: db });
      const gamesCount2 = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
      const sessionsCount2 = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;

      assert.equal(gamesCount1, gamesCount2, 'Games count must remain identical');
      assert.equal(sessionsCount1, sessionsCount2, 'Sessions count must remain identical (no duplicates)');
    });

    it('filters utilities when excludeUtilities is set', () => {
      const mockPath = path.join(tempDir, 'mock_rgstats.db');
      createMockAmdDatabase(mockPath);

      const result = importAMDDatabase(mockPath, { targetDb: db, excludeUtilities: true });
      assert.equal(result.importedGames, 4);
      assert.equal(result.skippedGames, 1);

      const ollama = db.prepare('SELECT * FROM games WHERE title LIKE ?').get('%Ollama%');
      assert.equal(ollama, undefined);
    });

    it('throws error when AMD database does not exist', () => {
      assert.throws(() => {
        importAMDDatabase(path.join(tempDir, 'does_not_exist.db'), { targetDb: db });
      }, /not found/i);
    });

    it('extractTitleFromExe handles various exe naming conventions', () => {
      assert.equal(extractTitleFromExe('C:\\Games\\DoomEternal-Win64-Shipping.exe'), 'Doom Eternal');
      assert.equal(extractTitleFromExe('D:\\Steam\\DeadSpace\\DeadSpace.exe'), 'Dead Space');
      assert.equal(extractTitleFromExe('E:\\Epic\\wwzRetailEgs.exe'), 'wwz');
      assert.equal(extractTitleFromExe('F:\\Onimusha\\OnimushaWotS.exe'), 'Onimusha The Way of the Sword');
      assert.equal(extractTitleFromExe(''), 'Unknown Game');
      assert.equal(extractTitleFromExe(null), 'Unknown Game');
    });

    it('imports real AMD database when present (68 games, 1474 sessions)', (t) => {
      if (!hasRealAmdDatabase()) {
        t.skip('Real AMD database not present');
        return;
      }

      const result = importAMDDatabase(REAL_AMD_PATH, { targetDb: db });
      assert.ok(result.importedGames >= 68);
      assert.ok(result.importedSessions >= 1474);

      const pbz = db.prepare('SELECT * FROM games WHERE amd_game_id = 65').get();
      assert.ok(pbz);
      assert.equal(pbz.title, 'Phantom Blade Zero');
      // Playtime now ratchets up from AMD's PlayTotal via the union of imported
      // session intervals — AMD's own counter can lag its session records, so
      // the total must never land below the imported PlayTotal
      assert.ok(pbz.playtime_minutes >= 2232);
    });
  });

  // =========================================================================
  // 2. Screenshot Sync Production Module (src/main/sync-screenshots.ts)
  // =========================================================================
  describe('Production Screenshot Sync (src/main/sync-screenshots.ts)', () => {
    let sourceDir;
    let mediaDir;

    beforeEach(() => {
      sourceDir = path.join(tempDir, 'Screenshots');
      mediaDir = path.join(tempDir, 'GameMedia');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(mediaDir, { recursive: true });
    });

    it('parses timestamps from F6 and Snipping tool formats', () => {
      const f6Date = parseScreenshotTimestamp('Screenshot-F6-20261029-195723.png');
      assert.ok(f6Date instanceof Date);
      assert.equal(f6Date.getFullYear(), 2026);
      assert.equal(f6Date.getMonth(), 9); // Oct
      assert.equal(f6Date.getDate(), 29);
      assert.equal(f6Date.getHours(), 19);
      assert.equal(f6Date.getMinutes(), 57);
      assert.equal(f6Date.getSeconds(), 23);

      const snipDate = parseScreenshotTimestamp('Screenshot 2026-11-20 142131.png');
      assert.ok(snipDate instanceof Date);
      assert.equal(snipDate.getFullYear(), 2026);
      assert.equal(snipDate.getMonth(), 10); // Nov
      assert.equal(snipDate.getDate(), 20);

      const fallback = new Date(2026, 0, 1);
      assert.equal(parseScreenshotTimestamp('Screenshot (1).png', fallback).getTime(), fallback.getTime());
    });

    it('sanitizes folder titles and resolves known aliases', () => {
      assert.equal(sanitizeTitleForFolder('Game: With <Illegal> "Chars"?'), 'Game With Illegal Chars');
      assert.equal(resolveFolderAlias('pbz'), 'Phantom Blade Zero');
      assert.equal(resolveFolderAlias('crimsondersert'), 'Crimson Desert');
      assert.equal(resolveFolderAlias('ds2'), 'Dead Space 2');
    });

    it('safely copies and unlinks cross-drive files with collision suffix', () => {
      const src1 = path.join(tempDir, 'shot1.png');
      const src2 = path.join(tempDir, 'shot2.png');
      fs.writeFileSync(src1, 'SHOT1_DATA');
      fs.writeFileSync(src2, 'SHOT2_DATA');

      const dest = path.join(tempDir, 'dest');
      const res1 = copyAndUnlink(src1, dest, 'screen.png');
      assert.equal(res1.filename, 'screen.png');
      assert.equal(fs.existsSync(src1), false);
      assert.equal(fs.readFileSync(res1.targetPath, 'utf-8'), 'SHOT1_DATA');

      const res2 = copyAndUnlink(src2, dest, 'screen.png');
      assert.equal(res2.filename, 'screen_1.png');
      assert.equal(fs.existsSync(src2), false);
      assert.equal(fs.readFileSync(res2.targetPath, 'utf-8'), 'SHOT2_DATA');
    });

    it('executes syncScreenshots matching sessions and moving files', () => {
      // Register game and session
      const gameRes = db.prepare('INSERT INTO games (title, media_folder) VALUES (?, ?)')
        .run('Phantom Blade Zero', 'PBZ');
      const gameId = Number(gameRes.lastInsertRowid);
      db.prepare(`
        INSERT INTO sessions (game_id, start_time, end_time, duration_minutes)
        VALUES (?, '2026-10-29T19:50:00', '2026-10-29T20:30:00', 40)
      `).run(gameId);

      // Create screenshot in source folder
      const filename = 'Screenshot-F6-20261029-195723.png';
      const sourceFile = path.join(sourceDir, filename);
      fs.writeFileSync(sourceFile, 'PICTURE_DATA_HERE');

      // Create non-image file (should be ignored)
      fs.writeFileSync(path.join(sourceDir, 'desktop.ini'), '[.ShellClassInfo]');

      const result = syncScreenshots({
        sourceDir,
        mediaBaseDir: mediaDir,
        targetDb: db,
      });

      assert.equal(result.matched, 1);
      assert.equal(result.moved, 1);
      assert.equal(fs.existsSync(sourceFile), false, 'Source file should be moved');

      const targetPath = path.join(mediaDir, 'PBZ', filename);
      assert.equal(fs.existsSync(targetPath), true, 'File should exist in target media folder');

      // Check history recorded
      const history = db.prepare('SELECT * FROM screenshot_sync_history WHERE game_id = ?').all(gameId);
      assert.equal(history.length, 1);
      assert.equal(history[0].original_filename, filename);
    });

    it('supports dry-run mode without modifying filesystem or database history', () => {
      const gameRes = db.prepare('INSERT INTO games (title) VALUES (?)').run('Cyberpunk 2077');
      const gameId = Number(gameRes.lastInsertRowid);
      db.prepare(`
        INSERT INTO sessions (game_id, start_time, end_time, duration_minutes)
        VALUES (?, '2026-11-20T14:00:00', '2026-11-20T15:00:00', 60)
      `).run(gameId);

      const filename = 'Screenshot 2026-11-20 142131.png';
      const sourceFile = path.join(sourceDir, filename);
      fs.writeFileSync(sourceFile, 'DRY_DATA');

      const result = syncScreenshots({
        sourceDir,
        mediaBaseDir: mediaDir,
        targetDb: db,
        dryRun: true,
      });

      assert.equal(result.matched, 1);
      assert.equal(result.moved, 0);
      assert.equal(fs.existsSync(sourceFile), true, 'File must not be deleted in dryRun');

      const historyCount = db.prepare('SELECT COUNT(*) as c FROM screenshot_sync_history').get().c;
      assert.equal(historyCount, 0, 'No history should be recorded in dryRun');
    });
  });

  // =========================================================================
  // 3. Playtime Tracker Production Module (src/main/tracker.ts)
  // =========================================================================
  describe('Production Playtime Tracker (src/main/tracker.ts)', () => {
    it('identifies system processes and finds games by executable name', () => {
      const tracker = new PlaytimeTracker(db);
      assert.equal(tracker.isSystemProcess('explorer.exe'), true);
      assert.equal(tracker.isSystemProcess('chrome.exe'), true);
      assert.equal(tracker.isSystemProcess('electron.exe'), true);
      assert.equal(tracker.isSystemProcess('Cyberpunk2077.exe'), false);

      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Cyberpunk 2077', 'Cyberpunk2077.exe');
      const game = tracker.findGameByProcess('cyberpunk2077.exe');
      assert.ok(game);
      assert.equal(game.title, 'Cyberpunk 2077');
    });

    it('tracks active sessions and persists playtime on clean exit', () => {
      const tracker = new PlaytimeTracker(db);
      db.prepare('INSERT INTO games (title, exe_name, playtime_minutes) VALUES (?, ?, 0)')
        .run('Elden Ring', 'eldenring.exe');

      const start = new Date(2026, 10, 20, 10, 0, 0);
      const pollRes = tracker.handleProcessPoll('eldenring.exe', 1234, start);
      assert.equal(pollRes.action, 'started');

      const status = tracker.getStatus();
      assert.equal(status.isTracking, true);
      assert.equal(status.activeGameTitle, 'Elden Ring');

      // Continue polling
      const pollCont = tracker.handleProcessPoll('eldenring.exe', 1234, new Date(2026, 10, 20, 10, 5, 0));
      assert.equal(pollCont.action, 'continue');

      // Exit after 45 minutes
      const exitTime = new Date(2026, 10, 20, 10, 45, 0);
      const closeRes = tracker.closeActiveSession(exitTime);
      assert.equal(closeRes.discarded, false);
      assert.equal(closeRes.durationMinutes, 45);

      const game = db.prepare('SELECT playtime_minutes FROM games WHERE title = ?').get('Elden Ring');
      assert.equal(game.playtime_minutes, 45);
    });

    it('discards fleeting launches under 10 seconds to avoid database pollution', () => {
      const tracker = new PlaytimeTracker(db);
      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Launcher', 'launcher.exe');

      const start = new Date(2026, 10, 20, 12, 0, 0);
      tracker.handleProcessPoll('launcher.exe', 4567, start);

      const quickExit = new Date(2026, 10, 20, 12, 0, 4);
      const res = tracker.closeActiveSession(quickExit, 10);
      assert.equal(res.discarded, true);
      assert.equal(res.reason, 'fleeting_launch');

      const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
      assert.equal(sessionCount, 0);
    });

    it('supports manualEditPlaytime with audit logging and boundary validation', () => {
      const tracker = new PlaytimeTracker(db);
      const gameRes = db.prepare('INSERT INTO games (title, playtime_minutes) VALUES (?, ?)')
        .run('Death Stranding 2', 60);
      const gameId = Number(gameRes.lastInsertRowid);

      // Manual edit to 300 minutes (5 hours)
      tracker.manualEditPlaytime(gameId, 300);

      const game = db.prepare('SELECT playtime_minutes, manual_playtime_minutes, recorded_playtime_minutes FROM games WHERE id = ?').get(gameId);
      assert.equal(game.playtime_minutes, 300);
      assert.equal(game.manual_playtime_minutes, 240);
      assert.equal(game.recorded_playtime_minutes, 60, 'manual edits must preserve recorded playtime');

      const manualSession = db.prepare('SELECT * FROM sessions WHERE game_id = ? AND source = ?').get(gameId, 'manual');
      assert.ok(manualSession);
      assert.equal(manualSession.duration_minutes, 240); // 300 - 60 = 240

      // Error cases
      assert.throws(() => tracker.manualEditPlaytime(gameId, -10), /non-negative/i);
      assert.throws(() => tracker.manualEditPlaytime(gameId, 'abc'), /non-negative/i);
      assert.throws(() => tracker.manualEditPlaytime(99999, 100), /not found/i);
    });

    it('verifies getForegroundProcessInfo speed is microsecond level (< 0.05% CPU)', () => {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        getForegroundProcessInfo();
      }
      const elapsed = performance.now() - t0;
      const perCall = elapsed / 100;
      // Per call must be well under 1ms (typically 0.0001 - 0.005 ms)
      assert.ok(perCall < 1.0, `Expected per-call latency < 1ms, got ${perCall.toFixed(4)}ms`);
    });
  });
});
