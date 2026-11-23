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
  extractTitleFromExe,
  parseScreenshotTimestamp,
  matchScreenshotToSessions,
  copyAndUnlink,
  calculateHttp206Range,
  sanitizeTitleForFolder,
  resolveFolderAlias
} from './test-helpers.js';

describe('GameVault Complete E2E Integration Suite (Tier 1-4)', () => {
  let db;
  let tempDir;
  let screenshotsDir;
  let mediaRootDir;
  let mockAmdPath;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_e2e_test_');
    screenshotsDir = path.join(tempDir, 'Screenshots');
    mediaRootDir = path.join(tempDir, 'E_Game');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(mediaRootDir, { recursive: true });

    db = createTestDb(':memory:');
    mockAmdPath = path.join(tempDir, 'RGStats.db');
    createMockAmdDatabase(mockAmdPath);
  });

  afterEach(() => {
    if (db) {
      try { db.close(); } catch {}
    }
    cleanupTempDirectory(tempDir);
  });

  // Complete End-to-End Workflow Test
  it('E2E Workflow 1: Complete end-to-end lifecycle (Import -> Track -> Sync -> Media -> Edit -> Delete)', () => {
    // -------------------------------------------------------------------------
    // STEP 1: 1-Click AMD Adrenalin Import
    // -------------------------------------------------------------------------
    const amdDb = new DatabaseSync(mockAmdPath, { readOnly: true });
    const rawGames = amdDb.prepare('SELECT * FROM InstalledGames').all();
    const rawSessions = amdDb.prepare('SELECT * FROM GameSessions').all();
    amdDb.close();

    const insertGame = db.prepare(`
      INSERT INTO games (title, exe_name, exe_path, playtime_minutes, steam_id, amd_game_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const gameIdMap = new Map();
    for (const g of rawGames) {
      let title = g.Title?.trim() || extractTitleFromExe(g.ExePath);
      const exeName = g.ExePath ? path.basename(g.ExePath) : '';
      insertGame.run(title, exeName, g.ExePath, g.PlayTotal, g.SteamID, g.GameID);
      const row = db.prepare('SELECT id FROM games WHERE title = ?').get(title);
      gameIdMap.set(g.GameID, row.id);
    }

    const insertSession = db.prepare(`
      INSERT INTO sessions (game_id, pid, start_time, end_time, duration_minutes, source)
      VALUES (?, ?, ?, ?, ?, 'amd_import')
    `);

    for (const s of rawSessions) {
      const gId = gameIdMap.get(s.GameID);
      if (!gId) continue;
      const startIso = s.Start.replace(' ', 'T');
      const endIso = s.End.replace(' ', 'T');
      const dur = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
      insertSession.run(gId, s.PID, startIso, endIso, dur);
    }

    // Verify Step 1
    const totalImportedGames = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
    assert.equal(totalImportedGames, 5);

    const pbz = db.prepare('SELECT * FROM games WHERE title = ?').get('Phantom Blade Zero');
    assert.ok(pbz);
    assert.equal(pbz.playtime_minutes, 2232);

    // -------------------------------------------------------------------------
    // STEP 2: Background Playtime Tracking (Zero-Impact Simulation)
    // -------------------------------------------------------------------------
    const gameId = pbz.id;
    const sessionStart = new Date(2026, 10, 20, 20, 0, 0); // 8:00 PM
    const sessionRes = db.prepare(`
      INSERT INTO sessions (game_id, pid, start_time, is_running, source)
      VALUES (?, 8888, ?, 1, 'tracker')
    `).run(gameId, sessionStart.toISOString());
    const trackingSessionId = Number(sessionRes.lastInsertRowid);

    // 45 minutes later, game closes
    const sessionEnd = new Date(2026, 10, 20, 20, 45, 0); // 8:45 PM
    const sessionDuration = 45;

    db.prepare(`
      UPDATE sessions
      SET end_time = ?, duration_minutes = ?, is_running = 0
      WHERE id = ?
    `).run(sessionEnd.toISOString(), sessionDuration, trackingSessionId);

    db.prepare(`
      UPDATE games
      SET playtime_minutes = playtime_minutes + ?
      WHERE id = ?
    `).run(sessionDuration, gameId);

    const pbzAfterPlay = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
    assert.equal(pbzAfterPlay.playtime_minutes, 2277, '2232 + 45 = 2277 minutes');

    // -------------------------------------------------------------------------
    // STEP 3: Smart Screenshot Sync (F6 Synchronization)
    // -------------------------------------------------------------------------
    // Player pressed F6 at 8:23:15 PM during gameplay
    const shotFilename = 'Screenshot-F6-20261120-202315.png';
    const shotPath = path.join(screenshotsDir, shotFilename);
    fs.writeFileSync(shotPath, 'RAW_SCREENSHOT_DATA');

    // Sync engine discovers screenshot and matches against PBZ session
    const shotTimestamp = parseScreenshotTimestamp(shotFilename);
    const candidateSessions = db.prepare(`
      SELECT s.id as session_id, s.game_id, s.start_time, s.end_time, g.title, g.media_folder
      FROM sessions s
      JOIN games g ON s.game_id = g.id
    `).all();

    const matched = matchScreenshotToSessions(shotTimestamp, candidateSessions, 120);
    assert.ok(matched, 'Screenshot must match the active PBZ session');
    assert.equal(matched.game_id, gameId);

    // Move file to game's media folder
    const targetFolder = path.join(mediaRootDir, 'PBZ');
    const moveResult = copyAndUnlink(shotPath, targetFolder, shotFilename);
    assert.equal(fs.existsSync(shotPath), false, 'Source must be unlinked');
    assert.equal(fs.existsSync(moveResult.targetPath), true, 'File must exist in target folder');

    // Log history
    db.prepare(`
      INSERT INTO screenshot_sync_history (game_id, session_id, original_filename, target_path, file_timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(gameId, matched.session_id, shotFilename, moveResult.targetPath, shotTimestamp.toISOString());

    // -------------------------------------------------------------------------
    // STEP 4: Media Gallery & HTTP 206 Streaming
    // -------------------------------------------------------------------------
    // Add gameplay video to game's folder
    const videoFilename = 'PBZ_Boss_Fight.mp4';
    const videoPath = path.join(targetFolder, videoFilename);
    const videoSize = 50 * 1024 * 1024; // 50 MB simulated video
    const videoBuffer = Buffer.alloc(1024); // 1KB sample chunk
    fs.writeFileSync(videoPath, videoBuffer);

    // Browser requests partial range: bytes=0-1023
    const streamMeta = calculateHttp206Range('bytes=0-1023', videoSize);
    assert.equal(streamMeta.statusCode, 206);
    assert.equal(streamMeta.contentLength, 1024);
    assert.equal(streamMeta.contentRange, `bytes 0-1023/${videoSize}`);

    // Promote screenshot to game poster
    db.prepare(`
      UPDATE games
      SET cover_url = ?, media_folder = 'PBZ'
      WHERE id = ?
    `).run(moveResult.targetPath, gameId);

    // -------------------------------------------------------------------------
    // STEP 5: Cinematic Detail Hub Updates (Score, Status, Notes)
    // -------------------------------------------------------------------------
    db.prepare(`
      UPDATE games
      SET user_rating = 9.8,
          status = 'completed',
          completed_at = '2026-11-20T21:00:00',
          notes = 'Masterpiece action RPG with blazing-fast combat.'
      WHERE id = ?
    `).run(gameId);

    const finalPbz = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    assert.equal(finalPbz.user_rating, 9.8);
    assert.equal(finalPbz.status, 'completed');
    assert.equal(finalPbz.completed_at, '2026-11-20T21:00:00');
    assert.equal(finalPbz.cover_url, moveResult.targetPath);
    assert.equal(finalPbz.media_folder, 'PBZ');

    // -------------------------------------------------------------------------
    // STEP 6: Library Filtering & Search
    // -------------------------------------------------------------------------
    const completedGames = db.prepare('SELECT title FROM games WHERE status = ?').all('completed');
    assert.equal(completedGames.length, 1);
    assert.equal(completedGames[0].title, 'Phantom Blade Zero');

    const searchResults = db.prepare('SELECT title FROM games WHERE title LIKE ?').all('%blade%');
    assert.equal(searchResults.length, 1);

    // -------------------------------------------------------------------------
    // STEP 7: Deletion & Cascade Cleanliness
    // -------------------------------------------------------------------------
    db.prepare('DELETE FROM games WHERE id = ?').run(gameId);

    assert.equal(db.prepare('SELECT COUNT(*) as c FROM games WHERE id = ?').get(gameId).c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM sessions WHERE game_id = ?').get(gameId).c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM screenshot_sync_history WHERE game_id = ?').get(gameId).c, 0);
  });

  it('E2E Workflow 2: Manual Game Registration, Fastly Steam CDN cover, and manual playtime edit', () => {
    // 1. Manually add game
    const insertRes = db.prepare(`
      INSERT INTO games (title, exe_name, steam_id, status)
      VALUES (?, ?, ?, 'playing')
    `).run('Cyberpunk 2077', 'Cyberpunk2077.exe', 1091500);
    const gameId = Number(insertRes.lastInsertRowid);

    // 2. Fetch cover URLs via Fastly Steam CDN convention
    const steamId = 1091500;
    const posterUrl = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900_2x.jpg`;
    const bannerUrl = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_hero.jpg`;

    db.prepare(`
      UPDATE games
      SET cover_url = ?, banner_url = ?
      WHERE id = ?
    `).run(posterUrl, bannerUrl, gameId);

    // 3. User manually sets historic playtime to 180 hours (10,800 minutes)
    const newPlaytime = 180 * 60;
    db.prepare(`
      UPDATE games
      SET playtime_minutes = ?
      WHERE id = ?
    `).run(newPlaytime, gameId);

    db.prepare(`
      INSERT INTO sessions (game_id, start_time, duration_minutes, source)
      VALUES (?, datetime('now', 'localtime'), ?, 'manual')
    `).run(gameId, newPlaytime);

    // 4. Verify record
    const cp = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    assert.equal(cp.playtime_minutes, 10800);
    assert.equal(cp.cover_url, posterUrl);
    assert.equal(cp.banner_url, bannerUrl);
    assert.equal(cp.status, 'playing');

    const manualSession = db.prepare('SELECT * FROM sessions WHERE game_id = ? AND source = ?').get(gameId, 'manual');
    assert.equal(manualSession.duration_minutes, 10800);
  });
});
