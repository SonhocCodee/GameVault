import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  initDb,
  closeDb,
  getDb,
  getGames,
  getGameById,
  getGameByTitle,
  getGameByExeName,
  getGameByAmdId,
  findMatchingGame,
  mergeGameMetadata,
  createGame,
  updateGame,
  deleteGame,
  updatePlaytime,
  setPlaytime,
  getSessions,
  getSessionById,
  getActiveSession,
  createSession,
  updateSession,
  deleteSession,
  recordScreenshotSync,
  getScreenshotSyncHistory,
} from '../src/main/db.ts';
import { recoverStaleSessions } from '../src/main/tracker.ts';

describe('GameVault Database Engine (node:sqlite)', () => {
  beforeEach(() => {
    // Initialize a fresh in-memory database for each test
    initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  describe('Games CRUD & Filtering', () => {
    test('createGame should insert a game and return complete record', () => {
      const game = createGame({
        title: 'Cyberpunk 2077',
        exe_name: 'Cyberpunk2077.exe',
        exe_path: 'C:\\Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe',
        playtime_minutes: 120,
        user_rating: 9.5,
        status: 'playing',
        notes: 'Great graphics and raytracing.',
      });

      assert.ok(game.id > 0, 'id should be generated');
      assert.equal(game.title, 'Cyberpunk 2077');
      assert.equal(game.exe_name, 'Cyberpunk2077.exe');
      assert.equal(game.playtime_minutes, 120);
      assert.equal(game.user_rating, 9.5);
      assert.equal(game.status, 'playing');
      assert.ok(game.created_at, 'created_at should exist');
      assert.ok(game.updated_at, 'updated_at should exist');
    });

    test('createGame should reject empty title', () => {
      assert.throws(() => {
        createGame({ title: '   ' });
      }, /Game title is required/);
    });

    test('createGame should default new games to playing (Chờ chơi only via wishlist search)', () => {
      const created = createGame({ title: 'Default Status Game' });
      assert.equal(created.status, 'playing');

      const explicitlyWishlisted = createGame({
        title: 'Explicit Wishlist Game',
        status: 'backlog',
      });
      assert.equal(explicitlyWishlisted.status, 'backlog');
    });

    test('getGameById, getGameByTitle, getGameByExeName should find existing game', () => {
      const created = createGame({
        title: 'Phantom Blade Zero',
        exe_name: 'PBZ.exe',
        playtime_minutes: 2232,
        amd_game_id: 65,
      });

      const byId = getGameById(created.id);
      assert.ok(byId);
      assert.equal(byId.title, 'Phantom Blade Zero');

      const byTitle = getGameByTitle('phantom blade zero');
      assert.ok(byTitle);
      assert.equal(byTitle.id, created.id);

      const byExe = getGameByExeName('pbz.exe');
      assert.ok(byExe);
      assert.equal(byExe.id, created.id);

      const byAmd = getGameByAmdId(65);
      assert.ok(byAmd);
      assert.equal(byAmd.id, created.id);

      const nonExistent = getGameById(99999);
      assert.equal(nonExistent, null);
    });

    test('updateGame should update allowed fields and timestamp', () => {
      const game = createGame({
        title: 'The Witcher 3',
        status: 'backlog',
        playtime_minutes: 0,
      });

      const updated = updateGame(game.id, {
        status: 'completed',
        playtime_minutes: 4800,
        user_rating: 10,
        notes: 'Masterpiece RPG',
      });

      assert.equal(updated.status, 'completed');
      assert.equal(updated.playtime_minutes, 4800);
      assert.equal(updated.user_rating, 10);
      assert.equal(updated.notes, 'Masterpiece RPG');
    });

    test('deleteGame should delete game and return true', () => {
      const game = createGame({ title: 'Temporary Game' });
      const success = deleteGame(game.id);
      assert.equal(success, true);
      assert.equal(getGameById(game.id), null);

      const deleteAgain = deleteGame(game.id);
      assert.equal(deleteAgain, false);
    });

    test('updatePlaytime and setPlaytime should modify playtime correctly', () => {
      const game = createGame({ title: 'Playtime Test', playtime_minutes: 60 });

      updatePlaytime(game.id, 30);
      assert.equal(getGameById(game.id)?.playtime_minutes, 90);

      setPlaytime(game.id, 150);
      assert.equal(getGameById(game.id)?.playtime_minutes, 150);
    });

    test('getGames filtering and sorting', () => {
      createGame({ title: 'Game A', status: 'playing', playtime_minutes: 100, user_rating: 8.0 });
      createGame({ title: 'Game B', status: 'completed', playtime_minutes: 500, user_rating: 9.5 });
      createGame({ title: 'Game C', status: 'backlog', playtime_minutes: 0, user_rating: 7.0 });

      // All games sorted by playtime desc by default
      const all = getGames();
      assert.equal(all.length, 3);
      assert.equal(all[0].title, 'Game B');
      assert.equal(all[1].title, 'Game A');
      assert.equal(all[2].title, 'Game C');

      // Filter by status
      const completed = getGames({ status: 'completed' });
      assert.equal(completed.length, 1);
      assert.equal(completed[0].title, 'Game B');

      // Search by title
      const searched = getGames({ search: 'Game C' });
      assert.equal(searched.length, 1);
      assert.equal(searched[0].title, 'Game C');

      // Sort by title_asc
      const byTitle = getGames({ sort: 'title_asc' });
      assert.equal(byTitle[0].title, 'Game A');
      assert.equal(byTitle[1].title, 'Game B');
      assert.equal(byTitle[2].title, 'Game C');

      // Sort by rating_desc
      const byRating = getGames({ sort: 'rating_desc' });
      assert.equal(byRating[0].title, 'Game B');
      assert.equal(byRating[1].title, 'Game A');
      assert.equal(byRating[2].title, 'Game C');
    });
  });

  describe('Sessions CRUD & Cascading', () => {
    test('createSession and getSessions with joined game title', () => {
      const game = createGame({ title: 'Session Test Game' });

      const session1 = createSession({
        game_id: game.id,
        pid: 1234,
        start_time: '2026-11-20T10:00:00',
        end_time: '2026-11-20T11:30:00',
        duration_minutes: 90,
        is_running: 0,
        source: 'tracker',
      });

      assert.ok(session1.id > 0);
      assert.equal(session1.game_title, 'Session Test Game');
      assert.equal(session1.duration_minutes, 90);

      const session2 = createSession({
        game_id: game.id,
        pid: 5678,
        start_time: '2026-11-20T14:00:00',
        is_running: 1,
        source: 'tracker',
      });

      const sessionsForGame = getSessions(game.id);
      assert.equal(sessionsForGame.length, 2);
      assert.equal(sessionsForGame[0].id, session2.id, 'Newer session should be first');

      const activeSession = getActiveSession(5678);
      assert.ok(activeSession);
      assert.equal(activeSession.id, session2.id);
    });

    test('updateSession and deleteSession', () => {
      const game = createGame({ title: 'Session Edit Test' });
      const session = createSession({
        game_id: game.id,
        start_time: '2026-11-20T08:00:00',
        is_running: 1,
      });

      const updated = updateSession(session.id, {
        end_time: '2026-11-20T09:15:00',
        duration_minutes: 75,
        is_running: 0,
      });

      assert.equal(updated.is_running, 0);
      assert.equal(updated.duration_minutes, 75);
      assert.equal(updated.end_time, '2026-11-20T09:15:00');

      const deleted = deleteSession(session.id);
      assert.equal(deleted, true);
      assert.equal(getSessionById(session.id), null);
    });

    test('deleting a game cascades to its sessions', () => {
      const game = createGame({ title: 'Cascade Game' });
      const session = createSession({
        game_id: game.id,
        start_time: '2026-11-20T12:00:00',
      });

      deleteGame(game.id);
      assert.equal(getSessionById(session.id), null);
    });
  });

  describe('Screenshot Sync History', () => {
    test('recordScreenshotSync should insert and retrieve sync logs', () => {
      const game = createGame({ title: 'Sync Game' });
      const session = createSession({
        game_id: game.id,
        start_time: '2026-11-20T12:00:00',
      });

      recordScreenshotSync({
        game_id: game.id,
        session_id: session.id,
        original_filename: 'Screenshot-F6-20261120-120530.png',
        target_path: 'E:\\Game\\Sync Game\\Screenshot-F6-20261120-120530.png',
        file_timestamp: '2026-11-20T12:05:30',
      });

      const history = getScreenshotSyncHistory(game.id);
      assert.equal(history.length, 1);
      assert.equal(history[0].original_filename, 'Screenshot-F6-20261120-120530.png');
      assert.equal(history[0].game_id, game.id);
      assert.equal(history[0].session_id, session.id);
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    test('T2-1: queries on empty database return empty arrays without throwing', () => {
      const games = getGames();
      assert.deepEqual(games, []);
      const session = getSessionById(9999);
      assert.equal(session, null);
    });

    test('T2-2: handles Unicode, Vietnamese diacritics, and special characters in title', () => {
      const vietnameseTitle = 'Liên Minh Huyền Thoại: Tốc Chiến (Wild Rift) - Edition & "Special"';
      const created = createGame({ title: vietnameseTitle });
      assert.equal(created.title, vietnameseTitle);
      const found = getGameByTitle(vietnameseTitle);
      assert.ok(found);
      assert.equal(found.title, vietnameseTitle);
    });

    test('T2-3: preserves NULL for unrated games and supports boundary ratings (1.0 and 10.0)', () => {
      const unrated = createGame({ title: 'Unrated Game', user_rating: undefined });
      assert.equal(unrated.user_rating, null);

      const minRated = createGame({ title: 'Min Rating Game', user_rating: 1.0 });
      assert.equal(minRated.user_rating, 1.0);

      const maxRated = createGame({ title: 'Max Rating Game', user_rating: 10.0 });
      assert.equal(maxRated.user_rating, 10.0);
    });

    test('T2-4: supports large playtime numbers without integer overflow', () => {
      const largePlaytime = 525600; // 1 full year of minutes
      const game = createGame({ title: 'MMO Game', playtime_minutes: largePlaytime });
      assert.equal(game.playtime_minutes, largePlaytime);
    });
  });

  describe('Tier 3: Persistence Across Reconnect', () => {
    test('T3-1: maintains data persistence across SQLite connection closures', () => {
      const tempDiskPath = path.join(os.tmpdir(), `gv_persist_${Date.now()}.db`);
      
      try {
        const diskDb = initDb(tempDiskPath);
        createGame({
          title: 'Horizon Forbidden West',
          exe_name: 'HorizonForbiddenWest.exe',
          playtime_minutes: 1850,
          status: 'completed',
          user_rating: 9.2,
        });
        closeDb();

        // Reconnect to same file
        initDb(tempDiskPath);
        const reloaded = getGameByTitle('Horizon Forbidden West');
        assert.ok(reloaded, 'Data must persist across database re-connections');
        assert.equal(reloaded.playtime_minutes, 1850);
        assert.equal(reloaded.status, 'completed');
        assert.equal(reloaded.user_rating, 9.2);
        closeDb();
      } finally {
        if (fs.existsSync(tempDiskPath)) {
          fs.rmSync(tempDiskPath, { force: true });
        }
      }
    });
  });

  describe('Schema Migration', () => {
    test('adds last_poll to legacy sessions tables and recovers orphans safely', () => {
      closeDb(); // drop the in-memory instance from beforeEach
      const tempDiskPath = path.join(os.tmpdir(), `gv_mig_test_${Date.now()}.db`);
      try {
        // Simulate a database created before the last_poll column existed
        const legacy = new DatabaseSync(tempDiskPath);
        legacy.exec(`
          CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            exe_name TEXT,
            exe_path TEXT,
            playtime_minutes INTEGER NOT NULL DEFAULT 0,
            user_rating REAL DEFAULT NULL,
            status TEXT NOT NULL DEFAULT 'backlog',
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
          CREATE TABLE sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            pid INTEGER DEFAULT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_minutes INTEGER NOT NULL DEFAULT 0,
            is_running INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'tracker',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
          );
        `);
        legacy.prepare(`INSERT INTO games (title) VALUES (?)`).run('Migrated Game');
        legacy.prepare(
          `INSERT INTO sessions (game_id, start_time, is_running, source) VALUES (1, ?, 1, 'tracker')`
        ).run(new Date().toISOString());
        legacy.close();

        // Re-open through initDb: migration must add the missing column
        initDb(tempDiskPath);

        const columnNames = getDb().prepare(`PRAGMA table_info(sessions)`).all().map(c => c.name);
        assert.ok(columnNames.includes('last_poll'), 'last_poll column must be added by migration');

        // Legacy orphan (no last_poll) must be discarded without fabricated playtime
        const summary = recoverStaleSessions(getDb());
        assert.equal(summary.discarded, 1);
        assert.equal(summary.recovered, 0);
        assert.equal(summary.creditedMinutes, 0);

        const game = getDb().prepare(`SELECT playtime_minutes FROM games WHERE id = 1`).get();
        assert.equal(game.playtime_minutes, 0);
      } finally {
        closeDb();
        if (fs.existsSync(tempDiskPath)) {
          fs.rmSync(tempDiskPath, { force: true });
        }
      }
    });

    test('getGames last_played_at excludes manual audit sessions', () => {
      const game = createGame({ title: 'Manual Edit Test' });
      createSession({
        game_id: game.id,
        start_time: '2026-07-16T20:00:00',
        end_time: '2026-07-16T21:00:00',
        duration_minutes: 60,
        source: 'amd_import',
      });
      createSession({
        game_id: game.id,
        start_time: '2026-11-24T18:55:49',
        end_time: '2026-11-24T18:55:49',
        duration_minutes: -1500,
        source: 'manual',
      });

      const list = getGames();
      const found = list.find((g) => g.id === game.id);
      assert.equal(found.last_played_at, '2026-07-16T20:00:00');
    });

    test('findMatchingGame & mergeGameMetadata prevent duplicate games across exe/steam_id/normalized title', () => {
      const existing = createGame({
        title: 'ELDEN RING™',
        steam_id: 1245620,
        status: 'playing',
      });

      assert.equal(findMatchingGame({ exe_name: null, steam_id: 1245620, title: 'Elden Ring' })?.id, existing.id);
      assert.equal(findMatchingGame({ title: 'Elden Ring' })?.id, existing.id);

      const merged = mergeGameMetadata(existing, {
        title: 'Elden Ring',
        exe_name: 'eldenring.exe',
        exe_path: 'D:\\Games\\ELDEN RING\\Game\\eldenring.exe',
        cover_url: 'https://example.com/cover.jpg',
      });

      assert.equal(merged.id, existing.id);
      assert.equal(merged.title, 'ELDEN RING™');
      assert.equal(merged.exe_name, 'eldenring.exe');
      assert.equal(merged.cover_url, 'https://example.com/cover.jpg');
      assert.equal(getGames().filter((g) => g.steam_id === 1245620).length, 1);

      assert.equal(findMatchingGame({ exe_name: 'ELDENRING.EXE' })?.id, existing.id);
    });
  });
});
