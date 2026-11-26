import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDb, closeDb, createGame, getGames, getGameByTitle, updateGame, deleteGame, createSession, getSessions } from '../src/main/db.ts';
import {
  configureCloudDb,
  getCloudLibrary,
  syncLibraryWithCloud,
} from '../src/main/cloud-db.ts';
import { configureAuth, persistSession, clearSession } from '../src/main/auth.ts';
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
            completedAt: '2026-10-25T19:58:12',
            coverUrl: 'https://cdn/bloodborne.jpg',
            clientUpdatedAt: '2026-01-01T00:00:00Z',
          },
          {
            gameKey: 't_eldenring',
            title: 'Elden Ring',
            status: 'playing',
            playtimeMinutes: 1800,
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
  });
});
