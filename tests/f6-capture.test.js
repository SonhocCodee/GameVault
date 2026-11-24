import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  createTestDb,
  createTempDirectory,
  cleanupTempDirectory,
} from './test-helpers.js';
import { PlaytimeTracker } from '../src/main/tracker.ts';
import { F6CaptureManager } from '../src/main/f6-capture.ts';
import {
  recordPendingF6Capture,
  getUnmatchedF6Captures,
  markF6CaptureMatched,
} from '../src/main/db.ts';
import { syncScreenshots } from '../src/main/sync-screenshots.ts';

describe('Auto-Detection & F6 Hotkey Screenshot Capture Suite', () => {
  let db;
  let tempDir;
  let screenshotsDir;
  let mediaDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_f6_test_');
    screenshotsDir = path.join(tempDir, 'Screenshots');
    mediaDir = path.join(tempDir, 'GameMedia');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });
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

  // =========================================================================
  // 1. Auto-Detection of New Games & Auto-Creation of Media Folders
  // =========================================================================
  describe('Auto-Detection of New Games', () => {
    it('automatically registers a new game, sanitizes title and creates folder', () => {
      const tracker = new PlaytimeTracker(db);
      const pollTime = new Date(2026, 10, 20, 15, 0, 0);

      // Simulate foreground window of an unregistered game
      const res = tracker.handleProcessPoll(
        'BlackMythWukong.exe',
        5555,
        pollTime,
        'D:\\Steam\\steamapps\\common\\BlackMythWukong\\BlackMythWukong.exe'
      );

      assert.equal(res.action, 'started');
      assert.ok(tracker.activeSession);
      assert.equal(tracker.activeSession.gameTitle, 'Black Myth Wukong');

      // Verify game row in SQLite
      const gameRow = db.prepare('SELECT * FROM games WHERE exe_name = ?').get('BlackMythWukong.exe');
      assert.ok(gameRow);
      assert.equal(gameRow.title, 'Black Myth Wukong');
      assert.equal(gameRow.media_folder, 'Black Myth Wukong');

      // Verify session created
      const sessionRow = db.prepare('SELECT * FROM sessions WHERE game_id = ?').get(gameRow.id);
      assert.ok(sessionRow);
      assert.equal(sessionRow.pid, 5555);
    });

    it('ignores system processes and non-game Windows applications', () => {
      const tracker = new PlaytimeTracker(db);

      const res1 = tracker.handleProcessPoll('chrome.exe', 1111, new Date(), 'C:\\Program Files\\Google\\Chrome\\chrome.exe');
      assert.equal(res1.action, 'idle');

      const res2 = tracker.handleProcessPoll('explorer.exe', 2222, new Date(), 'C:\\Windows\\explorer.exe');
      assert.equal(res2.action, 'idle');

      const res3 = tracker.handleProcessPoll('notepad.exe', 3333, new Date(), 'C:\\Windows\\System32\\notepad.exe');
      assert.equal(res3.action, 'idle');

      const count = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
      assert.equal(count, 0, 'No games should be registered for system processes');
    });

    it('is idempotent and updates existing game metadata without creating duplicate', () => {
      const tracker = new PlaytimeTracker(db);

      // Pre-insert game with title
      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)')
        .run('Hades II', 'old_hades.exe');

      const registered = tracker.autoRegisterNewGame('HadesII.exe', 'D:\\Games\\Hades II\\HadesII.exe');
      assert.ok(registered);
      assert.equal(registered.title, 'Hades II');

      const allHades = db.prepare('SELECT * FROM games WHERE title = ?').all('Hades II');
      assert.equal(allHades.length, 1, 'Must not duplicate existing game title');
      assert.equal(allHades[0].exe_name, 'HadesII.exe');
    });
  });

  // =========================================================================
  // 2. F6 Hotkey Capture Queue & Screenshot Sync
  // =========================================================================
  describe('F6 Hotkey Capture & Queue Operations', () => {
    it('records pending F6 captures with timestamp in database', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Elden Ring', 'eldenring.exe');
      const gameId = Number(gameRes.lastInsertRowid);

      const timestamp = new Date(2026, 10, 20, 19, 30, 0).toISOString();
      const capId = recordPendingF6Capture(gameId, 'Elden Ring', timestamp, db);
      assert.ok(capId > 0);

      const pending = getUnmatchedF6Captures(db);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].game_title, 'Elden Ring');

      markF6CaptureMatched(capId, db);
      const remaining = getUnmatchedF6Captures(db);
      assert.equal(remaining.length, 0);
    });

    it('syncs screenshot precisely when F6 was pressed during active game session', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name, media_folder) VALUES (?, ?, ?)')
        .run('Elden Ring', 'eldenring.exe', 'Elden Ring');
      const gameId = Number(gameRes.lastInsertRowid);

      const f6Manager = new F6CaptureManager(db, screenshotsDir, mediaDir);

      // 1. User presses F6 while playing Elden Ring at 19:30:15
      const pressTime = new Date(2026, 10, 20, 19, 30, 15);
      recordPendingF6Capture(gameId, 'Elden Ring', pressTime.toISOString(), db);

      // 2. Controller screenshot tool saves file in Screenshots folder at 19:30:16
      const shotFile = 'Screenshot-F6-20261120-193016.png';
      const shotPath = path.join(screenshotsDir, shotFile);
      fs.writeFileSync(shotPath, 'IMAGE_BINARY_DATA');

      // 3. Auto-sync sweeps
      const synced = f6Manager.scanAndSync(15000);
      assert.equal(synced.length, 1);
      assert.equal(synced[0].gameTitle, 'Elden Ring');
      assert.equal(synced[0].file, shotFile);

      // File moved to destination game folder
      assert.equal(fs.existsSync(shotPath), false, 'Original screenshot should be moved');
      const targetPath = path.join(mediaDir, 'Elden Ring', shotFile);
      assert.equal(fs.existsSync(targetPath), true, 'Screenshot must exist in target media folder');

      // Capture marked as matched in DB
      const pending = getUnmatchedF6Captures(db);
      assert.equal(pending.length, 0);

      // Recorded in history
      const history = db.prepare('SELECT * FROM screenshot_sync_history WHERE game_id = ?').all(gameId);
      assert.equal(history.length, 1);
      assert.equal(history[0].original_filename, shotFile);
    });

    it('does NOT sync screenshots taken outside game or without F6 token', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)')
        .run('Cyberpunk 2077', 'cyberpunk2077.exe');

      const f6Manager = new F6CaptureManager(db, screenshotsDir, mediaDir);

      // User was browsing web and took Snipping Tool screenshot
      const webShotFile = 'Screenshot 2026-11-20 143000.png';
      const webShotPath = path.join(screenshotsDir, webShotFile);
      fs.writeFileSync(webShotPath, 'CHROME_BROWSER_SCREENSHOT');

      // No F6 token was recorded for any game!
      const synced = f6Manager.scanAndSync();
      assert.equal(synced.length, 0, 'Must NOT sync screenshots when no F6 token exists');
      assert.equal(fs.existsSync(webShotPath), true, 'File must remain untouched in Screenshots directory');
    });

    it('integrates seamlessly with batch syncScreenshots prioritizing F6 tokens', () => {
      const gameRes = db.prepare('INSERT INTO games (title, media_folder) VALUES (?, ?)')
        .run('Witcher 3', 'Witcher 3');
      const gameId = Number(gameRes.lastInsertRowid);

      // Pending F6 capture
      const capTime = new Date(2026, 10, 20, 21, 0, 5);
      recordPendingF6Capture(gameId, 'Witcher 3', capTime.toISOString(), db);

      const shotFile = 'Screenshot-F6-20261120-210006.png';
      const shotPath = path.join(screenshotsDir, shotFile);
      fs.writeFileSync(shotPath, 'WITCHER_SCREEN');

      const res = syncScreenshots({
        sourceDir: screenshotsDir,
        mediaBaseDir: mediaDir,
        targetDb: db,
      });

      assert.equal(res.matched, 1);
      assert.equal(res.moved, 1);
      assert.equal(fs.existsSync(shotPath), false);
      assert.equal(fs.existsSync(path.join(mediaDir, 'Witcher 3', shotFile)), true);

      // Verified capture marked matched
      const pending = getUnmatchedF6Captures(db);
      assert.equal(pending.length, 0);
    });

    it('gracefully handles offline target drive without losing screenshots or pending tokens', () => {
      const gameRes = db.prepare('INSERT INTO games (title, media_folder) VALUES (?, ?)')
        .run('God of War', 'God of War');
      const gameId = Number(gameRes.lastInsertRowid);

      // Point media directory to a non-existent offline drive (Z:\OfflineGameMedia)
      const offlineMediaDir = 'Z:\\OfflineGameMedia';
      const f6Manager = new F6CaptureManager(db, screenshotsDir, offlineMediaDir);

      const pressTime = new Date(2026, 10, 20, 22, 0, 0);
      recordPendingF6Capture(gameId, 'God of War', pressTime.toISOString(), db);

      const shotFile = 'Screenshot-F6-20261120-220001.png';
      const shotPath = path.join(screenshotsDir, shotFile);
      fs.writeFileSync(shotPath, 'GOW_SCREEN');

      // Attempt sync while drive Z: is offline
      const synced = f6Manager.scanAndSync();
      assert.equal(synced.length, 0, 'No files should be synced to offline drive');

      // Crucial: Original screenshot must NOT be deleted
      assert.equal(fs.existsSync(shotPath), true, 'Screenshot must remain safe in Screenshots folder on C:');

      // Crucial: Pending capture token must NOT be discarded
      const pending = getUnmatchedF6Captures(db);
      assert.equal(pending.length, 1, 'Pending token must remain queued for when drive comes back online');
    });

    it('buffers screenshots in Screenshots folder during HDD Mode without moving until explicitly synced or session closes', () => {
      const gameRes = db.prepare('INSERT INTO games (title, media_folder) VALUES (?, ?)')
        .run('Sekiro', 'Sekiro');
      const gameId = Number(gameRes.lastInsertRowid);

      const f6Manager = new F6CaptureManager(db, screenshotsDir, mediaDir);
      f6Manager.setHddMode(true);

      // Player captures screenshot while playing
      const capTime = new Date(2026, 10, 20, 23, 15, 0);
      recordPendingF6Capture(gameId, 'Sekiro', capTime.toISOString(), db);

      const shotFile = 'Screenshot-F6-20261120-231500.png';
      const shotPath = path.join(screenshotsDir, shotFile);
      fs.writeFileSync(shotPath, 'SEKIRO_SHOT');

      // The file stays on SSD (C:) while playing
      assert.equal(fs.existsSync(shotPath), true);
      const pendingBefore = getUnmatchedF6Captures(db);
      assert.equal(pendingBefore.length, 1);

      // When game closes or sync is triggered, it moves to HDD
      const synced = f6Manager.scanAndSync();
      assert.equal(synced.length, 1);
      assert.equal(synced[0].gameTitle, 'Sekiro');
      assert.equal(fs.existsSync(shotPath), false);
      assert.equal(fs.existsSync(path.join(mediaDir, 'Sekiro', shotFile)), true);

      const pendingAfter = getUnmatchedF6Captures(db);
      assert.equal(pendingAfter.length, 0);
    });
  });
});
