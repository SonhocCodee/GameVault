import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { initDb, closeDb, createGame, createSession, getGames, getSessions, getSetting, setSetting, getDb } from '../src/main/db.ts';
import { accountLibraryPath, openAccountLibrary, persistDevicePreferences, assertLibraryAccount, ownedSessionSlices, LIBRARY_ACCOUNT_KEY } from '../src/main/account-library.ts';
import { PlaytimeWatchImporter } from '../src/main/ptwatch.ts';
import { importAMDDatabase } from '../src/main/importer.ts';

let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-account-library-'));
});
afterEach(() => {
  closeDb();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('logout opens an empty guest library; another account receives no games, sessions, scores or checkpoints', () => {
  const dbA = openAccountLibrary('account-a', directory);
  const game = createGame({ title: 'Private A', user_rating: 9, notes: 'Private review', playtime_minutes: 180 });
  createSession({ game_id: game.id, start_time: '2026-11-20T10:00:00Z', end_time: '2026-11-20T11:00:00Z', duration_minutes: 60, source: 'tracker' });
  setSetting('library_sync_epoch', '42');
  setSetting('library_sync_hash', 'private-a');
  setSetting('review_scores_migrated:account-a', '1');
  setSetting('media_base_dir', 'D:/SharedMedia');
  persistDevicePreferences(directory);

  openAccountLibrary(null, directory);
  assert.deepEqual(getGames(), []);
  assert.deepEqual(getSessions(), []);
  assert.throws(() => assertLibraryAccount('account-a'), /another account/);
  assert.throws(() => assertLibraryAccount('account-a', dbA), /account changed/);
  createGame({ title: 'Ephemeral guest game' });
  openAccountLibrary(null, directory);
  assert.deepEqual(getGames(), []);

  openAccountLibrary('account-b', directory);
  assert.deepEqual(getGames(), []);
  assert.deepEqual(getSessions(), []);
  assert.equal(getSetting('library_sync_epoch'), null);
  assert.equal(getSetting('library_sync_hash'), null);
  assert.equal(getSetting('review_scores_migrated:account-a'), null);
  assert.equal(getSetting('media_base_dir'), 'D:/SharedMedia');
  createGame({ title: 'Private B', user_rating: 5 });

  openAccountLibrary('account-a', directory);
  assert.equal(getGames().length, 1);
  assert.equal(getGames()[0].title, 'Private A');
  assert.equal(getGames()[0].user_rating, 9);
  assert.equal(getSessions().length, 1);
  assert.equal(getSetting('library_sync_epoch'), '42');
  assertLibraryAccount('account-a');
});

test('unowned legacy data is preserved and never silently claimed by the next login', () => {
  initDb(path.join(directory, 'gamevault.db'));
  createGame({ title: 'Legacy personal data', playtime_minutes: 100 });
  setSetting('setup_completed', 'true');
  closeDb();
  openAccountLibrary('new-login', directory);
  assert.deepEqual(getGames(), []);
  assert.equal(getSetting('setup_completed'), 'true');
  const legacy = new DatabaseSync(path.join(directory, 'gamevault.db'), { readOnly: true });
  assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM games').get().n, 1);
  legacy.close();
});

test('a verified legacy owner keeps local history without exposing it to another login', () => {
  initDb(path.join(directory, 'gamevault.db'));
  createGame({ title: 'Verified legacy history', playtime_minutes: 100 });
  setSetting(LIBRARY_ACCOUNT_KEY, 'original-owner');
  closeDb();
  openAccountLibrary('other-login', directory);
  assert.deepEqual(getGames(), []);
  openAccountLibrary('original-owner', directory);
  assert.equal(getGames()[0].title, 'Verified legacy history');
});

test('account filenames cannot escape the data directory', () => {
  assert.equal(path.dirname(accountLibraryPath('../../escape', directory)), directory);
  assert.notEqual(accountLibraryPath('a', directory), accountLibraryPath('b', directory));
});

test('a failed account switch falls back to an empty guest, never the legacy library', () => {
  initDb(path.join(directory, 'gamevault.db'));
  createGame({ title: 'Legacy private history' });
  closeDb();
  fs.writeFileSync(path.join(directory, 'device-account-history.json'), '{broken', 'utf8');
  assert.throws(() => openAccountLibrary('account-b', directory));
  assert.deepEqual(getGames(), []);
  assert.throws(() => assertLibraryAccount('account-b'), /another account/);
});

function seedHistory(uid) {
  const db = openAccountLibrary(uid, directory);
  fs.writeFileSync(path.join(directory, 'device-account-history.json'), JSON.stringify([
    { uid: 'account-a', start: Date.parse('2026-11-26T10:00:00Z'), end: Date.parse('2026-11-26T11:00:00Z') },
    { uid: null, start: Date.parse('2026-11-26T11:00:00Z'), end: Date.parse('2026-11-26T12:00:00Z') },
    { uid: 'account-b', start: Date.parse('2026-11-26T12:00:00Z'), end: Date.parse('2026-11-26T13:00:00Z') },
    { uid: 'account-a', start: Date.parse('2026-11-26T13:00:00Z'), end: null },
  ]), 'utf8');
  return db;
}

test('shared device sessions are split at login/logout boundaries and exclude signed-out time', () => {
  const db = seedHistory('account-a');
  const slices = ownedSessionSlices(db, '2026-11-26T10:30:00Z', '2026-11-26T13:30:00Z');
  assert.equal(slices.length, 2);
  assert.equal(Date.parse(slices[0].start), Date.parse('2026-11-26T10:30:00Z'));
  assert.equal(Date.parse(slices[0].end), Date.parse('2026-11-26T11:00:00Z'));
  assert.equal(Date.parse(slices[1].start), Date.parse('2026-11-26T13:00:00Z'));
  assert.deepEqual(ownedSessionSlices(db, '2026-11-26T11:10:00Z', '2026-11-26T11:50:00Z'), []);
});

test('watchdog imports only the current account slice, without historical hours from another account', () => {
  const db = seedHistory('account-b');
  createGame({ title: 'Shared installed game', exe_name: 'shared.exe' });
  const log = path.join(directory, 'playtime-watch.json');
  fs.writeFileSync(log, JSON.stringify({ sessions: [
    { exe: 'shared.exe', start: '2026-11-26T10:30:00Z', end: '2026-11-26T13:30:00Z' },
  ] }));
  const importer = new PlaytimeWatchImporter();
  importer.autoRegisterGames = false;
  importer.checkAndSync(db, log);
  assert.equal(getSessions().length, 1);
  assert.equal(getSessions()[0].duration_minutes, 60);
  assert.equal(getGames()[0].playtime_minutes, 60);
  openAccountLibrary(null, directory);
  importer.stop();
  importer.checkAndSync(getDb(), log);
  assert.deepEqual(getGames(), []);
});

test('AMD import excludes other accounts lifetime counters, old games and signed-out sessions', () => {
  const db = seedHistory('account-b');
  const amdPath = path.join(directory, 'RGStats.db');
  const amd = new DatabaseSync(amdPath);
  amd.exec(`CREATE TABLE InstalledGames(GameID INTEGER,Title TEXT,ExePath TEXT,PlayTotal INTEGER);
    CREATE TABLE GameSessions(GameID INTEGER,Start TEXT,End TEXT,IsRunning INTEGER);
    INSERT INTO InstalledGames VALUES(1,'Shared game','D:/Games/shared.exe',99999),(2,'Old game','D:/Games/old.exe',88888);
    INSERT INTO GameSessions VALUES(1,'2026-11-26T10:30:00Z','2026-11-26T13:30:00Z',0),(2,'2026-11-26T10:00:00Z','2026-11-26T11:00:00Z',0);`);
  amd.close();
  importAMDDatabase(amdPath, { targetDb: db });
  assert.equal(getGames().length, 1);
  assert.equal(getGames()[0].title, 'Shared game');
  assert.equal(getGames()[0].playtime_minutes, 60);
  assert.equal(getSessions().length, 1);
  openAccountLibrary(null, directory);
  importAMDDatabase(amdPath);
  assert.deepEqual(getGames(), []);
});
