import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  initDb, closeDb, createGame, getGameById, getDb,
  recalculatePlaytime, setManualPlaytime, updateGame,
} from '../src/main/db.ts';
import { PlaytimeTracker } from '../src/main/tracker.ts';

describe('Local playtime provenance and historical baseline', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-provenance-local-'));
    initDb(path.join(tempDir, 'library.db'));
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const addSession = (gameId, start, end, source = 'tracker') => {
    getDb().prepare(`INSERT INTO sessions
      (game_id, start_time, end_time, duration_minutes, is_running, source)
      VALUES (?, ?, ?, ?, 0, ?)`)
      .run(gameId, start, end, (Date.parse(end) - Date.parse(start)) / 60000, source);
  };

  it('migrates a legacy database without changing any curated time, dates, or sessions', () => {
    const game = createGame({
      title: 'Historical completion', playtime_minutes: 9876.5,
      status: 'completed', completed_at: '2024-03-17T21:42:00',
    });
    getDb().prepare(`INSERT INTO sessions
      (game_id, start_time, end_time, duration_minutes, source)
      VALUES (?, '2024-03-17T20:00:00', '2024-03-17T20:00:00', 80, 'manual')`).run(game.id);
    const filename = path.join(tempDir, 'library.db');
    closeDb();
    const legacy = new DatabaseSync(filename);
    legacy.exec('ALTER TABLE games DROP COLUMN recorded_playtime_minutes');
    legacy.exec('ALTER TABLE games DROP COLUMN manual_playtime_minutes');
    const before = legacy.prepare('SELECT * FROM games WHERE id = ?').get(game.id);
    const sessions = legacy.prepare('SELECT * FROM sessions').all();
    legacy.close();

    initDb(filename);
    const migrated = getGameById(game.id);
    for (const [key, value] of Object.entries(before)) assert.equal(migrated[key], value, key);
    assert.equal(migrated.recorded_playtime_minutes, 9876.5);
    assert.equal(migrated.manual_playtime_minutes, 0);
    assert.deepEqual(getDb().prepare('SELECT * FROM sessions').all(), sessions);

    setManualPlaytime(game.id, 10000);
    closeDb();
    initDb(filename);
    assert.equal(getGameById(game.id).playtime_minutes, 10000);
    assert.equal(getGameById(game.id).recorded_playtime_minutes, 9876.5,
      'reopening must not turn a later manual edit into a trusted baseline');
  });

  it('keeps 20 recorded hours separate when the displayed total is manually set to 100 hours', () => {
    const game = createGame({ title: 'Recorded game', playtime_minutes: 1200 });
    const tracker = new PlaytimeTracker(getDb());
    tracker.updatePlaytimeManual(game.id, 6000);
    const edited = getGameById(game.id);
    assert.equal(edited.playtime_minutes, 6000);
    assert.equal(edited.recorded_playtime_minutes, 1200);
    assert.equal(edited.manual_playtime_minutes, 4800);
    assert.equal(getDb().prepare("SELECT SUM(duration_minutes) AS n FROM sessions WHERE source='manual'").get().n, 4800);
  });

  it('generic total edits follow the same provenance rule and cannot lower recorded time', () => {
    const game = createGame({ title: 'Generic edit', playtime_minutes: 1200 });
    updateGame(game.id, { playtime_minutes: 6000 });
    assert.equal(getGameById(game.id).recorded_playtime_minutes, 1200);
    assert.throws(() => updateGame(game.id, { playtime_minutes: 1199 }), /giờ app/);
    assert.equal(getGameById(game.id).playtime_minutes, 6000);
    const before = getDb().prepare('SELECT total_changes() AS n').get().n;
    setManualPlaytime(game.id, 6000);
    assert.equal(getDb().prepare('SELECT total_changes() AS n').get().n, before,
      'saving an unchanged total must not create another audit row');
  });

  it('continues counting real sessions once and keeps the manual component fixed', () => {
    const game = createGame({ title: 'Overlap after manual', playtime_minutes: 1200 });
    addSession(game.id, '2026-11-20T00:00:00Z', '2026-11-20T20:00:00Z');
    setManualPlaytime(game.id, 6000);
    addSession(game.id, '2026-11-20T20:00:00Z', '2026-11-20T21:00:00Z');
    addSession(game.id, '2026-11-20T20:00:00Z', '2026-11-20T21:00:00Z', 'amd_import');
    recalculatePlaytime();
    assert.equal(getGameById(game.id).playtime_minutes, 6060);
    assert.equal(getGameById(game.id).recorded_playtime_minutes, 1260);
    assert.equal(getGameById(game.id).manual_playtime_minutes, 4800);
    recalculatePlaytime();
    assert.equal(getGameById(game.id).playtime_minutes, 6060);
  });

  it('rolls back a manual adjustment and its audit when another field fails validation', () => {
    createGame({ title: 'Existing title' });
    const game = createGame({ title: 'Original title', playtime_minutes: 1200 });
    assert.throws(() => updateGame(game.id, { title: 'Existing title', playtime_minutes: 6000 }), /UNIQUE/);
    assert.equal(getGameById(game.id).title, 'Original title');
    assert.equal(getGameById(game.id).playtime_minutes, 1200);
    assert.equal(getGameById(game.id).manual_playtime_minutes, 0);
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM sessions WHERE game_id = ?').get(game.id).n, 0);
  });

  it('applies remote manual reductions without resurrecting them on session recalculation', () => {
    const game = createGame({ title: 'Remote adjustment', playtime_minutes: 1200 });
    addSession(game.id, '2026-11-20T00:00:00Z', '2026-11-20T20:00:00Z');
    setManualPlaytime(game.id, 6000);
    updateGame(game.id, { playtime_minutes: 1800, recorded_playtime_minutes: 1200 });
    recalculatePlaytime();
    assert.equal(getGameById(game.id).playtime_minutes, 1800);
    assert.equal(getGameById(game.id).recorded_playtime_minutes, 1200);
    assert.equal(getGameById(game.id).manual_playtime_minutes, 600);
  });

  it('restores remote totals with manual provenance and leaves unknown completion dates empty', () => {
    const game = createGame({
      title: 'Restored completion', status: 'completed',
      playtime_minutes: 6000, recorded_playtime_minutes: 1200,
    });
    addSession(game.id, '2026-11-20T00:00:00Z', '2026-11-20T20:00:00Z');
    recalculatePlaytime();
    assert.equal(getGameById(game.id).recorded_playtime_minutes, 1200);
    assert.equal(getGameById(game.id).playtime_minutes, 6000);
    assert.equal(getGameById(game.id).completed_at, null);
  });
});
