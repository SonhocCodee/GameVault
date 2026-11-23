import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { recalculatePlaytime } from '../src/main/db.ts';
import { importAMDDatabase } from '../src/main/importer.ts';
import { createTestDb, createTempDirectory, cleanupTempDirectory } from './test-helpers.js';

/**
 * Union-based playtime recalculation + live AMD session delta-sync.
 * Regression context: imported AMD sessions were never credited into
 * games.playtime_minutes — the total only grew via MAX(stored, AMD PlayTotal),
 * so any manual edit above AMD's counter froze the total forever.
 */
describe('Playtime union recalculation', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_playtime_recalc_');
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

  const insertGame = (title, playtimeMinutes = 0) => {
    const res = db.prepare('INSERT INTO games (title, playtime_minutes) VALUES (?, ?)')
      .run(title, playtimeMinutes);
    return Number(res.lastInsertRowid);
  };

  const insertSession = (gameId, { start, end = null, lastPoll = null, duration = 0, isRunning = 0, source }) => {
    db.prepare(`
      INSERT INTO sessions (game_id, start_time, end_time, last_poll, duration_minutes, is_running, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(gameId, start, end, lastPoll, duration, isRunning, source);
  };

  it('unions overlapping tracker + amd_import windows (no double counting)', () => {
    const gameId = insertGame('Overlap Game', 0);

    // AMD records the same wall-clock window as the tracker (app opened mid-play)
    insertSession(gameId, { start: '2026-11-22T12:00:00', end: '2026-11-22T13:00:00', duration: 60, source: 'amd_import' });
    insertSession(gameId, { start: '2026-11-22T12:30:00', end: '2026-11-22T13:30:00', duration: 60, source: 'tracker' });

    recalculatePlaytime(db, [gameId]);

    const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
    assert.equal(game.playtime_minutes, 90); // 12:00→13:30 union, not 120
  });

  it('sums manual adjustments on top of the session union', () => {
    const gameId = insertGame('Manual Game', 0);

    insertSession(gameId, { start: '2026-11-21T19:00:00', end: '2026-11-21T20:00:00', duration: 60, source: 'amd_import' });
    // Manual edit audit row: +142 minutes (the diff of the absolute set)
    insertSession(gameId, { start: '2026-11-21 22:13:37', end: '2026-11-21 22:13:37', duration: 142, source: 'manual' });

    recalculatePlaytime(db, [gameId]);

    const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
    assert.equal(game.playtime_minutes, 202);
  });

  it('counts a still-running session up to its last confirmed poll', () => {
    const gameId = insertGame('Live Game', 0);

    // Started 3h06m before the last confirmed poll, end_time still open
    insertSession(gameId, {
      start: '2026-11-22T05:18:21.000Z',
      lastPoll: '2026-11-22T08:24:21.000Z',
      duration: 186,
      isRunning: 1,
      source: 'tracker',
    });

    recalculatePlaytime(db, [gameId]);

    const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
    assert.equal(game.playtime_minutes, 186);
  });

  it('never lowers an existing total (ratchet protects curated/manual values)', () => {
    const gameId = insertGame('Curated Game', 5000);

    insertSession(gameId, { start: '2026-11-21T19:00:00', end: '2026-11-21T20:00:00', duration: 60, source: 'amd_import' });

    recalculatePlaytime(db, [gameId]);

    const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
    assert.equal(game.playtime_minutes, 5000);
  });

  it('raises a frozen total to the union of imported sessions (the RE9 bug)', () => {
    const gameId = insertGame('Frozen Game', 186);

    // ~471 minutes of sessions recorded while the total sat at 186
    insertSession(gameId, { start: '2026-11-20T13:59:10.701Z', end: '2026-11-20T14:11:10.000Z', duration: 12, source: 'amd_import' });
    insertSession(gameId, { start: '2026-11-21T12:26:45.790Z', end: '2026-11-21T12:37:45.000Z', duration: 11, source: 'amd_import' });
    insertSession(gameId, { start: '2026-11-21 15:13:37', end: '2026-11-21 15:13:37', duration: 142, source: 'manual' });
    insertSession(gameId, { start: '2026-11-22T03:18:21.728Z', end: '2026-11-22T08:24:22.000Z', duration: 306, source: 'amd_import' });

    recalculatePlaytime(db, [gameId]);

    const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
    // 12 + 11 + 142 + 306, all disjoint
    assert.equal(game.playtime_minutes, 471);
  });

  it('recalculates only the requested game ids', () => {
    const idA = insertGame('Game A', 0);
    const idB = insertGame('Game B', 0);

    insertSession(idA, { start: '2026-11-22T10:00:00', end: '2026-11-22T11:00:00', duration: 60, source: 'amd_import' });
    insertSession(idB, { start: '2026-11-22T10:00:00', end: '2026-11-22T11:00:00', duration: 60, source: 'amd_import' });

    recalculatePlaytime(db, [idA]);

    assert.equal(db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(idA).playtime_minutes, 60);
    assert.equal(db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(idB).playtime_minutes, 0);
  });
});

describe('AMD running-session delta sync', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_amd_delta_');
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

  /** Minimal AMD RGStats.db mock with one running session whose End advances. */
  const createRunningSessionMock = (targetPath, runningEnd) => {
    try {
      fs.rmSync(targetPath, { force: true });
    } catch {}
    const amd = new DatabaseSync(targetPath);
    amd.exec(`
      CREATE TABLE InstalledGames(
        'GameID' INTEGER PRIMARY KEY,
        'ExePath' VARCHAR NOT NULL COLLATE NOCASE,
        'Title' VARCHAR NOT NULL COLLATE NOCASE,
        'SteamID' INTEGER NOT NULL,
        'UplayID' INTEGER NOT NULL,
        'OriginID' INTEGER NOT NULL,
        'PlayTotal' INTEGER NOT NULL
      );
      CREATE TABLE GameSessions(
        'GameID' INTEGER NOT NULL,
        'PID' INTEGER NOT NULL,
        'Start' DATETIME NOT NULL,
        'End' DATETIME NOT NULL,
        'IsRunning' BOOLEAN NOT NULL,
        'StartLo' INTEGER NOT NULL,
        'StartHi' INTEGER NOT NULL
      );
      CREATE TABLE Version('1.0' VARCHAR);
    `);
    amd.prepare(`
      INSERT INTO InstalledGames (GameID, ExePath, Title, SteamID, UplayID, OriginID, PlayTotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(133, 'F:\\Games\\Re9\\re9.exe', 'Resident Evil Requiem', -1, -1, -1, 60);
    amd.prepare(`
      INSERT INTO GameSessions (GameID, PID, Start, End, IsRunning, StartLo, StartHi)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(133, 4242, '2026-11-22 10:00:00', runningEnd, 1, 900, 900);
    amd.close();
    return targetPath;
  };

  it('extends an already-imported running session instead of skipping it', () => {
    const mockPath = path.join(tempDir, 'delta_rgstats.db');

    // 1st import: session running with End = 11:00 (60 min recorded)
    createRunningSessionMock(mockPath, '2026-11-22 11:00:00');
    importAMDDatabase(mockPath, { targetDb: db });

    const game = db.prepare('SELECT id FROM games LIMIT 1').get();
    const s1 = db.prepare('SELECT * FROM sessions WHERE game_id = ?').get(game.id);
    assert.equal(s1.is_running, 1);
    assert.equal(s1.duration_minutes, 60);

    // 2nd import: AMD advanced the running session's End to 11:30 (+30 min)
    createRunningSessionMock(mockPath, '2026-11-22 11:30:00');
    importAMDDatabase(mockPath, { targetDb: db });

    const sessions = db.prepare('SELECT COUNT(*) AS c FROM sessions').get();
    assert.equal(sessions.c, 1, 'no duplicate session rows');

    const s2 = db.prepare('SELECT * FROM sessions WHERE game_id = ?').get(game.id);
    assert.equal(s2.duration_minutes, 90, 'running session duration synced forward');

    const refreshed = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(game.id);
    assert.ok(refreshed.playtime_minutes >= 90, 'total accrues while the game still runs');
  });
});
