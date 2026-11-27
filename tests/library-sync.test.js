import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDb, closeDb, createGame, getGames, getGameByTitle, updateGame, deleteGame, createSession, getSessions, getDb, setManualPlaytime, recalculatePlaytime } from '../src/main/db.ts';
import {
  configureCloudDb,
  getCloudLibrary,
  syncLibraryWithCloud,
} from '../src/main/cloud-db.ts';
import { configureAuth, persistSession, clearSession, getCurrentSession } from '../src/main/auth.ts';
import { LIBRARY_ACCOUNT_KEY } from '../src/main/account-library.ts';
import { setSetting } from '../src/main/db.ts';
import { createTestWorkerEnv, createTestSessionToken, authHeader } from './test-helpers-cloudflare.js';
import worker from '../worker/src/index.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-lib-sync-${prefix}-`));
}

describe('Multi-Device Game Library Sync Suite (Cloudflare D1 + Worker)', () => {
  let tmpDirs = [];
  let env;
  let d1;
  let r2;
  let sessionToken;
  let userDataDir;

  const newTmp = (prefix) => {
    const dir = makeTempDir(prefix);
    tmpDirs.push(dir);
    return dir;
  };

  beforeEach(async () => {
    initDb(':memory:');
    tmpDirs = [];
    userDataDir = newTmp('ud');

    const testEnv = await createTestWorkerEnv();
    env = testEnv.env;
    d1 = testEnv.d1;
    r2 = testEnv.r2;

    sessionToken = await createTestSessionToken(
      { uid: 'gamer-alpha', email: 'gamer@vault.vn', displayName: 'Gamer Alpha' },
      env.SESSION_SECRET
    );

    // Seed user in D1
    await d1
      .prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`)
      .bind('gamer-alpha', 'gamer@vault.vn', 'Gamer Alpha')
      .run();

    const fetchImpl = async (url, init = {}) => {
      const req = new Request(url, init);
      return worker.fetch(req, env);
    };

    const config = {
      oauthClientId: 'cid',
      oauthClientSecret: 'cs',
      workerApiUrl: 'http://localhost',
    };

    configureAuth({ config, userDataDir, fetchImpl });
    configureCloudDb({ workerApiUrl: 'http://localhost', fetchImpl, userDataDir });

    persistSession(
      {
        sessionToken,
        expiresAt: Date.now() + 3600 * 1000,
        user: {
          uid: 'gamer-alpha',
          email: 'gamer@vault.vn',
          displayName: 'Gamer Alpha',
          photoUrl: 'https://photo/gamer',
        },
        google: { accessToken: 'g_tok', refreshToken: 'g_ref', expiresAt: Date.now() + 3600 * 1000, scope: 'drive.appdata' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );
  });

  afterEach(() => {
    closeDb();
    clearSession({ userDataDir });
    configureCloudDb({ fetchImpl: undefined, workerApiUrl: undefined, projectId: undefined, userDataDir: undefined });
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  test('refuses to upload a library owned by a different account', async () => {
    createGame({ title: 'Other account data', playtime_minutes: 9999, user_rating: 10 });
    setSetting(LIBRARY_ACCOUNT_KEY, 'different-owner');
    await assert.rejects(syncLibraryWithCloud(), /another account/);
    const rows = await d1.prepare('SELECT * FROM user_library WHERE uid=?').bind('gamer-alpha').all();
    assert.equal(rows.results.length, 0);
  });

  test('an empty authoritative cloud snapshot removes stale local games, sessions and reviews', async () => {
    const game = createGame({ title: 'Accidentally copied game', user_rating: 10, playtime_minutes: 9999,
      cover_url: 'https://cdn.test/cover.jpg', banner_url: 'https://cdn.test/banner.jpg' });
    createSession({ game_id: game.id, start_time: '2026-11-20T10:00:00Z', end_time: '2026-11-20T11:00:00Z', duration_minutes: 60, source: 'tracker' });
    await d1.prepare("INSERT INTO user_sync_state(uid,sync_epoch,updated_at) VALUES(?,1,datetime('now'))").bind('gamer-alpha').run();
    const result = await syncLibraryWithCloud();
    assert.equal(result.authoritativePull, true);
    assert.deepEqual(getGames(), []);
    assert.deepEqual(getSessions(), []);
    assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM ratings').first()).n, 0);
    assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM user_library').first()).n, 0);
  });

  test('switching accounts while an upload is waiting keeps the new library and request credentials isolated', async () => {
    createGame({ title: 'Account A game', playtime_minutes: 120, user_rating: 9,
      cover_url: 'https://cdn.test/a.jpg', banner_url: 'https://cdn.test/a-banner.jpg' });
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { started = resolve; });
    let holdFirst = true;
    configureCloudDb({ fetchImpl: async (url, init = {}) => {
      const request = new Request(url, init);
      if (String(url).endsWith('/api/library/sync') && holdFirst) {
        holdFirst = false;
        started();
        await gate;
      }
      return worker.fetch(request, env);
    } });
    const pendingA = syncLibraryWithCloud();
    const rejectedA = assert.rejects(pendingA, /account changed/i);
    await waiting;
    const sessionA = getCurrentSession();
    initDb(path.join(newTmp('account-b'), 'gamevault.db'));
    const tokenB = await createTestSessionToken({ uid: 'gamer-beta', email: 'b@vault.vn', displayName: 'B' }, env.SESSION_SECRET);
    await d1.prepare('INSERT INTO users(uid,email,display_name) VALUES(?,?,?)').bind('gamer-beta', 'b@vault.vn', 'B').run();
    persistSession({ ...sessionA, sessionToken: tokenB, user: { ...sessionA.user, uid: 'gamer-beta', email: 'b@vault.vn' } }, { userDataDir });
    setSetting(LIBRARY_ACCOUNT_KEY, 'gamer-beta');
    createGame({ title: 'Account B game', playtime_minutes: 5, user_rating: 6,
      cover_url: 'https://cdn.test/b.jpg', banner_url: 'https://cdn.test/b-banner.jpg' });
    try {
      const resultB = await syncLibraryWithCloud();
      assert.equal(resultB.totalCount, 1);
    } finally { release(); }
    await rejectedA;
    assert.deepEqual(getGames().map(game => game.title), ['Account B game']);
    const libraryB = await d1.prepare('SELECT title FROM user_library WHERE uid=?').bind('gamer-beta').all();
    assert.deepEqual(libraryB.results.map(game => game.title), ['Account B game']);
    const ratingsB = await d1.prepare('SELECT game_title FROM ratings WHERE uid=?').bind('gamer-beta').all();
    assert.deepEqual(ratingsB.results.map(game => game.game_title), ['Account B game']);
  });

  // ==========================================================================
  // Part 1: Direct Worker Endpoints
  // ==========================================================================
  describe('Worker Endpoints (/api/library and /api/library/sync)', () => {
    test('rejects unauthenticated requests with 401', async () => {
      const getReq = new Request('http://localhost/api/library');
      const getRes = await worker.fetch(getReq, env);
      assert.equal(getRes.status, 401);

      const postReq = new Request('http://localhost/api/library/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      });
      const postRes = await worker.fetch(postReq, env);
      assert.equal(postRes.status, 401);
    });

    test('returns empty library for a new user', async () => {
      const req = new Request('http://localhost/api/library', {
        headers: authHeader(sessionToken),
      });
      const res = await worker.fetch(req, env);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.deepEqual(data.games, []);
      assert.equal(data.stats.total, 0);
      assert.equal(data.stats.completed, 0);
    });

    test('syncs multiple games with completed status and playtime preservation', async () => {
      const payload = {
        items: [
          {
            gameKey: 't_bloodborne',
            title: 'Bloodborne',
            status: 'completed',
            playtimeMinutes: 3600,
            recordedPlaytimeMinutes: 3600,
            completedAt: '2026-10-25T19:58:12',
            coverUrl: 'https://cdn/bloodborne.jpg',
            clientUpdatedAt: '2026-01-01T00:00:00Z',
          },
          {
            gameKey: 't_eldenring',
            title: 'Elden Ring',
            status: 'playing',
            playtimeMinutes: 1800,
            recordedPlaytimeMinutes: 1800,
            coverUrl: 'https://cdn/eldenring.jpg',
            clientUpdatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      };

      const req = new Request('http://localhost/api/library/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(sessionToken),
        },
        body: JSON.stringify(payload),
      });

      const res = await worker.fetch(req, env);
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.stats.total, 2);
      assert.equal(data.stats.completed, 1);
      assert.equal(data.stats.playing, 1);
      assert.equal(data.stats.totalPlaytimeMinutes, 5400);
      assert.equal(data.stats.recordedMinutes, 5400);

      // Verify second sync: Bloodborne status cannot regress from completed to playing
      const regressionAttempt = {
        items: [
          {
            gameKey: 't_bloodborne',
            title: 'Bloodborne',
            status: 'playing', // Attempting to downgrade
            playtimeMinutes: 1000, // Attempting to decrease playtime
            clientUpdatedAt: '2026-01-02T00:00:00Z',
          },
        ],
      };

      const req2 = new Request('http://localhost/api/library/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(sessionToken),
        },
        body: JSON.stringify(regressionAttempt),
      });

      const res2 = await worker.fetch(req2, env);
      assert.equal(res2.status, 200);
      const data2 = await res2.json();

      const bloodborne = data2.games.find((g) => g.gameKey === 't_bloodborne');
      assert.ok(bloodborne);
      assert.equal(bloodborne.status, 'completed', 'Completed status must be preserved');
      assert.equal(bloodborne.playtimeMinutes, 3600, 'Playtime must never decrease');
      assert.equal(bloodborne.recordedPlaytimeMinutes, 3600, 'A legacy payload must retain the recorded baseline');
      assert.equal(bloodborne.completedAt, '2026-10-25T19:58:12', 'completedAt must be preserved when subsequent sync omits it');
    });

    test('tombstoned deletion removes game from active library', async () => {
      // First insert
      await worker.fetch(
        new Request('http://localhost/api/library/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(sessionToken) },
          body: JSON.stringify({
            items: [
              { gameKey: 't_todelete', title: 'To Delete', status: 'backlog', playtimeMinutes: 10 },
            ],
          }),
        }),
        env
      );

      // Then delete
      const delRes = await worker.fetch(
        new Request('http://localhost/api/library/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(sessionToken) },
          body: JSON.stringify({
            items: [
              { gameKey: 't_todelete', title: 'To Delete', isDeleted: true, clientUpdatedAt: '2026-01-05T00:00:00Z' },
            ],
          }),
        }),
        env
      );

      const delData = await delRes.json();
      assert.equal(delData.games.length, 0);
      assert.equal(delData.stats.total, 0);
    });
  });

  // ==========================================================================
  // Part 2: Client Roundtrip & Multi-PC Synchronization Scenario
  // ==========================================================================
  describe('Client Library Sync Simulation (Machine A -> Cloud -> Machine B)', () => {
    test('an older Worker response without recorded time never promotes a local manual component', async (t) => {
      t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unexpected external network request in legacy provenance test');
      });
      const methods = [];
      configureCloudDb({
        workerApiUrl: 'http://localhost', userDataDir,
        fetchImpl: async (url, init = {}) => {
          const parsed = new URL(url);
          assert.equal(parsed.origin, 'http://localhost');
          const response = await worker.fetch(new Request(url, init), env);
          if (response.ok && ['/api/library', '/api/library/sync'].includes(parsed.pathname)) {
            methods.push(init.method || 'GET');
            const body = await response.json();
            for (const game of body.games) delete game.recordedPlaytimeMinutes;
            delete body.stats.recordedMinutes;
            return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
          }
          return response;
        },
      });
      createGame({
        title: 'Sekiro', steam_id: 814380, status: 'completed',
        playtime_minutes: 6000, recorded_playtime_minutes: 1200,
        cover_url: 'https://cdn.example.test/sekiro.jpg',
        banner_url: 'https://cdn.example.test/sekiro-banner.jpg',
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await syncLibraryWithCloud();
        const game = getGameByTitle('Sekiro');
        assert.equal(game.playtime_minutes, 6000);
        assert.equal(game.recorded_playtime_minutes, 1200, 'Missing provenance must preserve the known local recorded baseline');
        assert.equal(game.manual_playtime_minutes, 4800);
        assert.equal(getSessions(game.id).filter(s => s.source === 'manual')
          .reduce((total, session) => total + session.duration_minutes, 0), 4800);
      }
      assert.deepEqual(methods, ['POST', 'GET'], 'Both upload reconciliation and an unchanged GET must handle legacy responses');
    });

    test('authoritative epoch recovery restores a local manual audit offset before new real sessions accrue', async (t) => {
      t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unexpected external network request in epoch provenance test');
      });
      const uploads = [];
      configureCloudDb({
        workerApiUrl: 'http://localhost', userDataDir,
        fetchImpl: async (url, init = {}) => {
          assert.equal(new URL(url).origin, 'http://localhost');
          if (new URL(url).pathname === '/api/library/sync' && init.method === 'POST') uploads.push(JSON.parse(String(init.body)));
          return worker.fetch(new Request(url, init), env);
        },
      });
      const staleFile = path.join(newTmp('epoch-stale'), 'library.db');
      const cleanFile = path.join(newTmp('epoch-clean'), 'library.db');
      const openMachine = (file) => { closeDb(); initDb(file); };
      const artwork = {
        cover_url: 'https://cdn.example.test/sekiro.jpg',
        banner_url: 'https://cdn.example.test/sekiro-banner.jpg',
      };
      openMachine(staleFile);
      createGame({ ...artwork, title: 'Sekiro', steam_id: 814380, status: 'playing', playtime_minutes: 9999 });
      await syncLibraryWithCloud();

      openMachine(cleanFile);
      const clean = createGame({ ...artwork, title: 'Sekiro', steam_id: 814380, status: 'completed', playtime_minutes: 6000, recorded_playtime_minutes: 1200 });
      createSession({ game_id: clean.id, source: 'tracker', start_time: '2026-11-01T00:00:00Z', end_time: '2026-11-01T20:00:00Z', duration_minutes: 1200, is_running: 0 });
      const overwritten = await syncLibraryWithCloud({ mode: 'overwrite' });
      assert.equal(overwritten.syncEpoch, 1);

      openMachine(staleFile);
      const recovered = await syncLibraryWithCloud();
      assert.equal(recovered.authoritativePull, true);
      assert.equal(recovered.syncEpoch, 1);
      let game = getGameByTitle('Sekiro');
      assert.equal(game.playtime_minutes, 6000);
      assert.equal(game.recorded_playtime_minutes, 1200);
      assert.equal(game.manual_playtime_minutes, 4800);
      const recoveredSessions = getSessions(game.id);
      assert.equal(recoveredSessions.filter(s => s.source !== 'manual').length, 1);
      assert.equal(recoveredSessions.filter(s => s.source === 'manual')
        .reduce((minutes, session) => minutes + session.duration_minutes, 0), 4800,
      'Authoritative session replacement must reconstruct the local manual offset');

      createSession({ game_id: game.id, source: 'tracker', start_time: '2026-11-02T00:00:00Z', end_time: '2026-11-02T01:00:00Z', duration_minutes: 60, is_running: 0 });
      for (let attempt = 0; attempt < 2; attempt++) {
        recalculatePlaytime(undefined, [game.id]);
        game = getGameByTitle('Sekiro');
        assert.equal(game.playtime_minutes, 6060, 'A new real session must keep accruing after authoritative recovery');
        assert.equal(game.recorded_playtime_minutes, 1260);
        assert.equal(game.manual_playtime_minutes, 4800);
      }
      await syncLibraryWithCloud();
      const cloud = await getCloudLibrary();
      assert.equal(cloud.games[0].playtimeMinutes, 6060);
      assert.equal(cloud.games[0].recordedPlaytimeMinutes, 1260);
      assert.ok(uploads.every(upload => upload.sessions.every(session => session.source !== 'manual')));
      assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS n FROM user_sessions WHERE source='manual'").get().n, 0);
    });

    test('two machines preserve 100 total/20 recorded hours, real session growth and later manual reductions without exporting audit rows', async (t) => {
      // Every request uses the in-process Worker. Artwork is already populated,
      // so this scenario must never need a real cover or discovery service.
      t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unexpected external network request in provenance integration test');
      });
      const uploads = [];
      configureCloudDb({
        workerApiUrl: 'http://localhost', userDataDir,
        fetchImpl: async (url, init = {}) => {
          const parsed = new URL(url);
          assert.equal(parsed.origin, 'http://localhost');
          if (parsed.pathname === '/api/library/sync' && init.method === 'POST') {
            uploads.push(JSON.parse(String(init.body)));
          }
          return worker.fetch(new Request(url, init), env);
        },
      });
      const machineA = path.join(newTmp('provenance-a'), 'library.db');
      const machineB = path.join(newTmp('provenance-b'), 'library.db');
      const openMachine = (file) => { closeDb(); initDb(file); };
      const stamp = (id, time) => getDb().prepare('UPDATE games SET updated_at=? WHERE id=?').run(time, id);
      const assertCounters = (game, total, recorded) => {
        assert.equal(game.playtime_minutes, total);
        assert.equal(game.recorded_playtime_minutes, recorded);
        assert.equal(game.manual_playtime_minutes, total - recorded);
      };
      const auditTotal = (id) => getSessions(id).filter(s => s.source === 'manual')
        .reduce((total, session) => total + session.duration_minutes, 0);

      openMachine(machineA);
      const a = createGame({
        title: 'Sekiro', steam_id: 814380, status: 'completed', playtime_minutes: 1200,
        cover_url: 'https://cdn.example.test/sekiro.jpg',
        banner_url: 'https://cdn.example.test/sekiro-banner.jpg',
      });
      createSession({ game_id: a.id, source: 'tracker', start_time: '2026-11-01T00:00:00Z', end_time: '2026-11-01T20:00:00Z', duration_minutes: 1200, is_running: 0 });
      setManualPlaytime(a.id, 6000);
      stamp(a.id, '2026-11-24T10:00:00.000Z');
      assertCounters(getGameByTitle('Sekiro'), 6000, 1200);
      assert.equal(auditTotal(a.id), 4800);
      await syncLibraryWithCloud();
      assert.equal(uploads[0].items[0].playtimeMinutes, 6000);
      assert.equal(uploads[0].items[0].recordedPlaytimeMinutes, 1200);

      openMachine(machineB);
      await syncLibraryWithCloud();
      let b = getGameByTitle('Sekiro');
      assertCounters(b, 6000, 1200);
      assert.equal(auditTotal(b.id), 4800, 'A pulled manual component gets a local-only audit offset');
      assert.equal(getSessions(b.id).filter(s => s.source !== 'manual').length, 1);

      // A new real interval grows only the recorded portion, while the old
      // manually supplied 80 hours remain exactly 4800 minutes.
      createSession({ game_id: b.id, source: 'tracker', start_time: '2026-11-02T00:00:00Z', end_time: '2026-11-02T01:00:00Z', duration_minutes: 60, is_running: 0 });
      recalculatePlaytime(undefined, [b.id]);
      stamp(b.id, '2026-11-24T11:00:00.000Z');
      assertCounters(getGameByTitle('Sekiro'), 6060, 1260);
      await syncLibraryWithCloud();

      openMachine(machineA);
      await syncLibraryWithCloud();
      assertCounters(getGameByTitle('Sekiro'), 6060, 1260);
      assert.equal(auditTotal(a.id), 4800);
      assert.equal(getSessions(a.id).filter(s => s.source !== 'manual').length, 2);

      // A corrects the old estimate down to 9 manual hours, then records a
      // separate 30-minute interval that B has never seen before.
      setManualPlaytime(a.id, 1800);
      assertCounters(getGameByTitle('Sekiro'), 1800, 1260);
      createSession({ game_id: a.id, source: 'tracker', start_time: '2026-11-03T00:00:00Z', end_time: '2026-11-03T00:30:00Z', duration_minutes: 30, is_running: 0 });
      recalculatePlaytime(undefined, [a.id]);
      stamp(a.id, '2026-11-24T12:00:00.000Z');
      await syncLibraryWithCloud();
      assertCounters(getGameByTitle('Sekiro'), 1830, 1290);

      openMachine(machineB);
      await syncLibraryWithCloud();
      b = getGameByTitle('Sekiro');
      assertCounters(b, 1830, 1290);
      assert.equal(auditTotal(b.id), 540, 'Remote manual reduction reconciles the local audit offset');
      assert.equal(getSessions(b.id).filter(s => s.source !== 'manual').length, 3, 'The new remote interval actually exercises session merge and recalc');
      recalculatePlaytime(undefined, [b.id]);
      assertCounters(getGameByTitle('Sekiro'), 1830, 1290);

      const cloud = await getCloudLibrary();
      assert.equal(cloud.games[0].playtimeMinutes, 1830);
      assert.equal(cloud.games[0].recordedPlaytimeMinutes, 1290);
      assert.equal(cloud.stats.recordedMinutes, 1290);
      for (const upload of uploads) {
        assert.ok(upload.sessions.every(s => s.source !== 'manual'), 'Manual audit rows must never leave either machine');
      }
      const stored = d1.sqlite.prepare('SELECT source,duration_minutes FROM user_sessions').all();
      assert.equal(stored.length, 3);
      assert.ok(stored.every(s => s.source !== 'manual'));
      assert.equal(stored.reduce((minutes, session) => minutes + session.duration_minutes, 0), 1290);
    });

    test('Machine A pushes games; fresh Machine B pulls and populates local database', async () => {
      // === Machine A ===
      createGame({
        title: 'Dark Souls 3',
        status: 'completed',
        playtime_minutes: 4200,
        cover_url: 'https://img/ds3.png',
        banner_url: 'https://img/ds3_banner.png',
        user_rating: 10,
        notes: 'Greatest boss fights',
      });
      createGame({
        title: 'Armored Core 6',
        status: 'playing',
        playtime_minutes: 1200,
        cover_url: 'https://cdn.example.test/ac6.jpg',
        banner_url: 'https://cdn.example.test/ac6-banner.jpg',
      });

      // Machine A runs sync
      const resultA = await syncLibraryWithCloud();
      assert.equal(resultA.pushed, 2);
      assert.equal(resultA.completedCount, 1);
      assert.equal(resultA.totalCount, 2);

      // === Machine B (New machine simulation) ===
      // Close Machine A's DB and open a fresh empty DB for Machine B
      closeDb();
      initDb(':memory:');

      // Verify Machine B is currently empty
      assert.equal(getGames().length, 0, 'Machine B should start empty');

      // Machine B logs in and runs sync
      const resultB = await syncLibraryWithCloud();
      assert.equal(resultB.pulled, 2, 'Machine B should pull down 2 games from cloud');
      assert.equal(resultB.completedCount, 1);

      // Inspect Machine B local SQLite database
      const gamesOnB = getGames();
      assert.equal(gamesOnB.length, 2);

      const ds3 = getGameByTitle('Dark Souls 3');
      assert.ok(ds3);
      assert.equal(ds3.status, 'completed', 'Completed status must carry over to new machine');
      assert.equal(ds3.playtime_minutes, 4200, 'Playtime must carry over');
      assert.equal(ds3.cover_url, 'https://img/ds3.png', 'Cover URL must carry over');
      assert.equal(ds3.user_rating, 10, 'User rating must carry over');
      assert.equal(ds3.notes, 'Greatest boss fights', 'Notes must carry over');

      const ac6 = getGameByTitle('Armored Core 6');
      assert.ok(ac6);
      assert.equal(ac6.status, 'playing');
      assert.equal(ac6.playtime_minutes, 1200);

      // Now on Machine B, player plays Armored Core 6 for 300 more minutes and completes it!
      updateGame(ac6.id, {
        status: 'completed',
        playtime_minutes: 1500,
      });

      const resultB2 = await syncLibraryWithCloud();
      assert.equal(resultB2.completedCount, 2, 'Cloud now has 2 completed games');

      // Check cloud library directly
      const cloudLib = await getCloudLibrary();
      assert.equal(cloudLib.stats.completed, 2);
    });

    test('syncs non-manual play sessions and completed_at across two machines without manual audit noise', async () => {
      const ds = createGame({
        title: 'Dead Space',
        steam_id: 1693980,
        status: 'completed',
        completed_at: '2026-07-16T22:11:28',
        playtime_minutes: 0,
        cover_url: 'https://cdn.example.test/dead-space.jpg',
        banner_url: 'https://cdn.example.test/dead-space-banner.jpg',
      });
      createSession({
        game_id: ds.id,
        start_time: '2026-07-16T20:00:00.000Z',
        end_time: '2026-07-16T22:00:00.000Z',
        duration_minutes: 120,
        is_running: 0,
        source: 'amd_import',
      });
      createSession({
        game_id: ds.id,
        start_time: '2026-11-24T18:55:49',
        end_time: '2026-11-24T18:55:49',
        duration_minutes: -1500,
        is_running: 0,
        source: 'manual',
      });

      await syncLibraryWithCloud();

      // Switch to Machine B (empty DB)
      closeDb();
      initDb(':memory:');

      await syncLibraryWithCloud();

      const pulledDs = getGameByTitle('Dead Space');
      assert.ok(pulledDs);
      assert.equal(pulledDs.completed_at, '2026-07-16T22:11:28');
      assert.equal(pulledDs.playtime_minutes, 120);
      const pulledSessions = getSessions(pulledDs.id);
      assert.equal(pulledSessions.length, 1);
      assert.equal(pulledSessions[0].source, 'amd_import');
      assert.equal(pulledSessions[0].start_time, '2026-07-16T20:00:00.000Z');
    });

    test('overwrite mode sets authoritative Cloud snapshot and stale machine auto-pulls exact playtime and sessions', async () => {
      // 1. Machine A (corrupted/inflated data) pushes first
      const inflatedGame = createGame({
        title: 'Elden Ring',
        steam_id: 1245620,
        status: 'playing',
        playtime_minutes: 9999,
        cover_url: 'https://cdn.example.test/elden-ring.jpg',
        banner_url: 'https://cdn.example.test/elden-ring-banner.jpg',
      });
      createSession({
        game_id: inflatedGame.id,
        start_time: '2026-11-20T01:00:00.000Z',
        end_time: '2026-11-20T10:00:00.000Z',
        duration_minutes: 540,
        is_running: 0,
        source: 'tracker',
      });
      createGame({
        title: 'Stale Junk Game',
        status: 'backlog',
        playtime_minutes: 50,
        cover_url: 'https://cdn.example.test/stale.jpg',
        banner_url: 'https://cdn.example.test/stale-banner.jpg',
      });

      await syncLibraryWithCloud();

      // 2. Machine B (authoritative clean machine) has accurate 120m playtime and 1 clean session
      closeDb();
      initDb(':memory:');

      const cleanGame = createGame({
        title: 'Elden Ring',
        steam_id: 1245620,
        status: 'completed',
        completed_at: '2026-11-25T20:00:00',
        playtime_minutes: 120,
        cover_url: 'https://cdn.example.test/elden-ring.jpg',
        banner_url: 'https://cdn.example.test/elden-ring-banner.jpg',
      });
      createSession({
        game_id: cleanGame.id,
        start_time: '2026-11-25T18:00:00.000Z',
        end_time: '2026-11-25T20:00:00.000Z',
        duration_minutes: 120,
        is_running: 0,
        source: 'tracker',
      });

      const overwriteRes = await syncLibraryWithCloud({ mode: 'overwrite' });
      assert.equal(overwriteRes.syncEpoch, 1);
      assert.equal(overwriteRes.totalCount, 1);

      // 3. Machine A (with stale inflated 9999m and Stale Junk Game) runs normal merge sync
      closeDb();
      initDb(':memory:');
      const staleA = createGame({
        title: 'Elden Ring',
        steam_id: 1245620,
        status: 'playing',
        playtime_minutes: 9999,
        cover_url: 'https://cdn.example.test/elden-ring.jpg',
        banner_url: 'https://cdn.example.test/elden-ring-banner.jpg',
      });
      createSession({
        game_id: staleA.id,
        start_time: '2026-11-20T01:00:00.000Z',
        end_time: '2026-11-20T10:00:00.000Z',
        duration_minutes: 540,
        is_running: 0,
        source: 'tracker',
      });
      createGame({
        title: 'Stale Junk Game',
        status: 'backlog',
        playtime_minutes: 50,
        cover_url: 'https://cdn.example.test/stale.jpg',
        banner_url: 'https://cdn.example.test/stale-banner.jpg',
      });

      const pullResA = await syncLibraryWithCloud();
      assert.equal(pullResA.authoritativePull, true);
      assert.equal(pullResA.syncEpoch, 1);

      // Machine A must now match Machine B 100%
      const gamesA = getGames();
      assert.equal(gamesA.length, 1);
      assert.equal(gamesA[0].title, 'Elden Ring');
      assert.equal(gamesA[0].playtime_minutes, 120);
      assert.equal(gamesA[0].status, 'completed');
      assert.equal(gamesA[0].completed_at, '2026-11-25T20:00:00');

      const sessionsA = getSessions(gamesA[0].id);
      assert.equal(sessionsA.length, 1);
      assert.equal(sessionsA[0].start_time, '2026-11-25T18:00:00.000Z');
      assert.equal(sessionsA[0].duration_minutes, 120);

      // 4. Subsequent normal sync on Machine A with new playtime works normally
      updateGame(gamesA[0].id, { playtime_minutes: 180 });
      const nextResA = await syncLibraryWithCloud();
      assert.equal(nextResA.authoritativePull, false);
      const cloudLib = await getCloudLibrary();
      assert.equal(cloudLib.games[0].playtimeMinutes, 180);
    });

    test('unchanged syncs skip POST /api/library/sync on client and perform zero D1 writes on worker', async () => {
      const g = createGame({
        title: 'Sekiro',
        steam_id: 814380,
        status: 'playing',
        playtime_minutes: 90,
        recorded_playtime_minutes: 20,
        cover_url: 'https://cdn/sekiro.jpg',
        banner_url: 'https://cdn/sekiro-banner.jpg',
      });
      createSession({
        game_id: g.id,
        start_time: '2026-11-26T01:00:00.000Z',
        end_time: '2026-11-26T01:20:00.000Z',
        duration_minutes: 20,
        is_running: 0,
        source: 'tracker',
      });

      const methodCalls = [];
      let d1WriteQueries = 0;
      const origPrepare = d1.prepare.bind(d1);
      d1.prepare = (sql) => {
        const stmt = origPrepare(sql);
        const isWrite = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql);
        const wrap = (s) => ({
          bind: (...vals) => wrap(s.bind(...vals)),
          first: (...args) => s.first(...args),
          all: (...args) => s.all(...args),
          raw: (...args) => s.raw(...args),
          run: async (...args) => {
            if (isWrite) d1WriteQueries++;
            return s.run(...args);
          },
        });
        return wrap(stmt);
      };

      configureCloudDb({
        workerApiUrl: 'http://localhost',
        userDataDir,
        fetchImpl: async (url, init = {}) => {
          methodCalls.push({ method: init.method || 'GET', path: new URL(url).pathname });
          return worker.fetch(new Request(url, init), env);
        },
      });

      // 1st sync uploads the game + session
      const first = await syncLibraryWithCloud();
      assert.equal(first.pushed, 1);
      assert.ok(methodCalls.some((c) => c.method === 'POST' && c.path === '/api/library/sync'));

      // 2nd sync with zero local changes must only GET /api/library and do 0 D1 writes
      methodCalls.length = 0;
      d1WriteQueries = 0;
      const second = await syncLibraryWithCloud();
      assert.equal(second.pushed, 0);
      assert.equal(second.totalCount, 1);
      assert.equal(d1WriteQueries, 0, 'Unchanged client sync must produce zero D1 writes');
      assert.ok(!methodCalls.some((c) => c.method === 'POST' && c.path === '/api/library/sync'));

      // Direct Worker POST /api/library/sync with identical payload must also produce 0 D1 writes
      d1WriteQueries = 0;
      const directRes = await worker.fetch(
        new Request('http://localhost/api/library/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(sessionToken) },
          body: JSON.stringify({
            items: [
              {
                gameKey: '814380',
                title: 'Sekiro',
                steamId: 814380,
                coverUrl: 'https://cdn/sekiro.jpg',
                bannerUrl: 'https://cdn/sekiro-banner.jpg',
                status: 'playing',
                playtimeMinutes: 90,
                recordedPlaytimeMinutes: 20,
                clientUpdatedAt: '2026-11-26T02:30:00.000Z',
              },
            ],
            sessions: [
              {
                gameKey: '814380',
                source: 'tracker',
                startTime: '2026-11-26T01:00:00.000Z',
                endTime: '2026-11-26T01:20:00.000Z',
                durationMinutes: 20,
              },
            ],
          }),
        }),
        env
      );
      assert.equal(directRes.status, 200);
      assert.equal(d1WriteQueries, 0, 'Worker POST with unchanged items and sessions must do 0 D1 writes');
    });
  });
});
