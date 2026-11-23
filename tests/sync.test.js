import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  createTestDb,
  createTempDirectory,
  cleanupTempDirectory,
  parseScreenshotTimestamp,
  matchScreenshotToSessions,
  copyAndUnlink,
  hasRealScreenshots,
  REAL_SCREENSHOTS_PATH
} from './test-helpers.js';

describe('Smart Screenshot Sync Suite (R4)', () => {
  let db;
  let tempDir;
  let sourceDir;
  let targetBaseDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_sync_test_');
    sourceDir = path.join(tempDir, 'Screenshots');
    targetBaseDir = path.join(tempDir, 'GameMedia');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetBaseDir, { recursive: true });
    db = createTestDb(':memory:');
  });

  afterEach(() => {
    if (db) {
      try { db.close(); } catch {}
    }
    cleanupTempDirectory(tempDir);
  });

  // Smart Sync Engine Reference Implementation
  function runScreenshotSync(vaultDb, scanDir, mediaBaseDir, options = {}) {
    const dryRun = !!options.dryRun;
    const bufferSec = options.bufferSeconds ?? 120;

    const files = fs.readdirSync(scanDir);
    const sessions = vaultDb.prepare(`
      SELECT s.id as session_id, s.game_id, s.start_time, s.end_time, g.title, g.media_folder
      FROM sessions s
      JOIN games g ON s.game_id = g.id
    `).all();

    const results = {
      scanned: files.length,
      matched: 0,
      moved: 0,
      details: []
    };

    const insertHistory = vaultDb.prepare(`
      INSERT INTO screenshot_sync_history (game_id, session_id, original_filename, target_path, file_timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const filename of files) {
      const fullPath = path.join(scanDir, filename);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) continue;

      const fileTimestamp = parseScreenshotTimestamp(filename, stat.mtime);
      if (!fileTimestamp) continue;

      const matchedSession = matchScreenshotToSessions(fileTimestamp, sessions, bufferSec);
      if (matchedSession) {
        results.matched++;
        const folderName = matchedSession.media_folder || matchedSession.title.replace(/[<>:"/\\|?*]/g, '').trim();
        const destFolder = path.join(mediaBaseDir, folderName);

        if (!dryRun) {
          const moveResult = copyAndUnlink(fullPath, destFolder, filename);
          insertHistory.run(
            matchedSession.game_id,
            matchedSession.session_id,
            filename,
            moveResult.targetPath,
            fileTimestamp.toISOString()
          );
          results.moved++;
          results.details.push({
            file: filename,
            gameTitle: matchedSession.title,
            targetPath: moveResult.targetPath
          });
        } else {
          results.details.push({
            file: filename,
            gameTitle: matchedSession.title,
            targetPath: path.join(destFolder, filename)
          });
        }
      }
    }

    return results;
  }

  // TIER 1: FEATURE COVERAGE (R4)
  describe('Tier 1: Feature Coverage (R4 Screenshot Sync)', () => {
    it('R4-1: parses F6 screenshot timestamps accurately', () => {
      const filename = 'Screenshot-F6-20261029-195723.png';
      const parsed = parseScreenshotTimestamp(filename);
      assert.ok(parsed instanceof Date, 'Should return Date');
      assert.equal(parsed.getFullYear(), 2026);
      assert.equal(parsed.getMonth(), 9); // October is 9 (0-indexed)
      assert.equal(parsed.getDate(), 29);
      assert.equal(parsed.getHours(), 19);
      assert.equal(parsed.getMinutes(), 57);
      assert.equal(parsed.getSeconds(), 23);
    });

    it('R4-2: parses Windows Snipping Tool timestamps accurately', () => {
      const filename = 'Screenshot 2026-11-20 142131.png';
      const parsed = parseScreenshotTimestamp(filename);
      assert.ok(parsed instanceof Date);
      assert.equal(parsed.getFullYear(), 2026);
      assert.equal(parsed.getMonth(), 10); // November is 10
      assert.equal(parsed.getDate(), 20);
      assert.equal(parsed.getHours(), 14);
      assert.equal(parsed.getMinutes(), 21);
      assert.equal(parsed.getSeconds(), 31);
    });

    it('R4-3: falls back to filesystem mtime when filename lacks timestamp', () => {
      const dummyDate = new Date(2026, 7, 15, 12, 0, 0);
      const parsed = parseScreenshotTimestamp('Screenshot (1).png', dummyDate);
      assert.equal(parsed.getTime(), dummyDate.getTime());
    });

    it('R4-4: matches screenshots within the 120-second session grace buffer', () => {
      const sessions = [
        {
          id: 1,
          game_id: 10,
          title: 'Phantom Blade Zero',
          start_time: '2026-10-29T19:50:00.000',
          end_time: '2026-10-29T20:30:00.000'
        }
      ];

      // Exact inside
      const during = new Date(2026, 9, 29, 20, 0, 0);
      assert.ok(matchScreenshotToSessions(during, sessions, 120));

      // 60s before start (inside 120s buffer)
      const preSession = new Date(2026, 9, 29, 19, 49, 0);
      assert.ok(matchScreenshotToSessions(preSession, sessions, 120));

      // 90s after end (inside 120s buffer)
      const postSession = new Date(2026, 9, 29, 20, 31, 30);
      assert.ok(matchScreenshotToSessions(postSession, sessions, 120));

      // 150s before start (outside 120s buffer)
      const wayBefore = new Date(2026, 9, 29, 19, 47, 0);
      assert.equal(matchScreenshotToSessions(wayBefore, sessions, 120), null);
    });

    it('R4-5: executes safe cross-drive copy+unlink and records history', () => {
      // Setup Game and Session in DB
      const gameRes = db.prepare('INSERT INTO games (title, media_folder) VALUES (?, ?)').run('Crimson Desert', 'CrimsonDersert');
      const gameId = Number(gameRes.lastInsertRowid);
      db.prepare(`
        INSERT INTO sessions (game_id, start_time, end_time, duration_minutes)
        VALUES (?, '2026-08-17T22:40:00', '2026-08-17T23:15:00', 35)
      `).run(gameId);

      // Create test screenshot in sourceDir
      const filename = 'Screenshot-F6-20260817-224651.png';
      const sourceFile = path.join(sourceDir, filename);
      fs.writeFileSync(sourceFile, 'PNG_IMAGE_BYTES_MOCK');

      // Run sync
      const result = runScreenshotSync(db, sourceDir, targetBaseDir);
      assert.equal(result.matched, 1);
      assert.equal(result.moved, 1);

      // Verify file moved
      assert.equal(fs.existsSync(sourceFile), false, 'Source file must be unlinked');
      const expectedTarget = path.join(targetBaseDir, 'CrimsonDersert', filename);
      assert.equal(fs.existsSync(expectedTarget), true, 'Target file must exist in game media folder');
      assert.equal(fs.readFileSync(expectedTarget, 'utf-8'), 'PNG_IMAGE_BYTES_MOCK');

      // Verify DB history
      const history = db.prepare('SELECT * FROM screenshot_sync_history WHERE game_id = ?').all(gameId);
      assert.equal(history.length, 1);
      assert.equal(history[0].original_filename, filename);
      assert.equal(history[0].target_path, expectedTarget);
    });
  });

  // TIER 2: BOUNDARY & CORNER CASES
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2-1: resolves destination filename collisions with _1, _2 suffixes', () => {
      const destDir = path.join(tempDir, 'collision_test');
      fs.mkdirSync(destDir, { recursive: true });

      const file1 = path.join(tempDir, 'temp1.png');
      const file2 = path.join(tempDir, 'temp2.png');
      fs.writeFileSync(file1, 'DATA1');
      fs.writeFileSync(file2, 'DATA2');

      const res1 = copyAndUnlink(file1, destDir, 'shot.png');
      assert.equal(res1.filename, 'shot.png');

      const res2 = copyAndUnlink(file2, destDir, 'shot.png');
      assert.equal(res2.filename, 'shot_1.png');

      assert.equal(fs.readFileSync(path.join(destDir, 'shot.png'), 'utf-8'), 'DATA1');
      assert.equal(fs.readFileSync(path.join(destDir, 'shot_1.png'), 'utf-8'), 'DATA2');
    });

    it('T2-2: ignores non-screenshot files such as desktop.ini or text documents', () => {
      fs.writeFileSync(path.join(sourceDir, 'desktop.ini'), '[.ShellClassInfo]');
      fs.writeFileSync(path.join(sourceDir, 'notes.txt'), 'Game notes');

      const result = runScreenshotSync(db, sourceDir, targetBaseDir);
      assert.equal(result.matched, 0);
      assert.equal(result.moved, 0);
    });

    it('T2-3: supports dry-run mode without modifying any files', () => {
      const gameRes = db.prepare('INSERT INTO games (title) VALUES (?)').run('PBZ');
      db.prepare(`
        INSERT INTO sessions (game_id, start_time, end_time)
        VALUES (?, '2026-10-29T19:50:00', '2026-10-29T20:30:00')
      `).run(Number(gameRes.lastInsertRowid));

      const filename = 'Screenshot-F6-20261029-195723.png';
      const sourceFile = path.join(sourceDir, filename);
      fs.writeFileSync(sourceFile, 'DRY_RUN_DATA');

      const result = runScreenshotSync(db, sourceDir, targetBaseDir, { dryRun: true });
      assert.equal(result.matched, 1);
      assert.equal(result.moved, 0, 'No files should be moved in dry-run mode');
      assert.equal(fs.existsSync(sourceFile), true, 'Source file must remain intact in dry-run');
    });
  });

  // TIER 4: REAL-WORLD SCREENSHOTS DIRECTORY SCENARIOS
  describe('Tier 4: Real-World Screenshots Inspection', () => {
    it('T4-1: verifies real screenshots directory at C:\\Users\\MacPro\\Pictures\\Screenshots', (t) => {
      if (!hasRealScreenshots()) {
        t.skip('Real screenshots directory not found');
        return;
      }

      const files = fs.readdirSync(REAL_SCREENSHOTS_PATH);
      assert.ok(files.length > 0, `Expected screenshots folder to exist with files, found ${files.length}`);

      const f6Files = files.filter(f => /^Screenshot(-F6-|\s\d{4})/.test(f));
      if (f6Files.length === 0) {
        t.skip('All F6 screenshots already synchronized to E:\\Game');
        return;
      }

      // Test parsing on real sample files
      const sample = f6Files[0];
      const parsed = parseScreenshotTimestamp(sample);
      assert.ok(parsed instanceof Date, 'Real screenshot filename must parse to valid Date');
      assert.ok(!isNaN(parsed.getTime()), 'Timestamp must not be NaN');
    });
  });
});
