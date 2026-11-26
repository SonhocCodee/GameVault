import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.ts';
import {
  createTestWorkerEnv,
  createTestSessionToken,
  authHeader,
} from './test-helpers-cloudflare.js';
import { initDb, closeDb, createGame, getGames, getGameById, updateGame } from '../src/main/db.ts';
import {
  configureCloudDb,
  getCloudGameCover,
  cacheCloudGameCover,
  uploadCloudGameCover,
  adminGetCloudCovers,
  adminUpdateCloudCover,
  adminDeleteCloudCover,
  adminUploadCloudCover,
  syncLibraryWithCloud,
} from '../src/main/cloud-db.ts';
import { configureAuth, persistSession, clearSession } from '../src/main/auth.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveWebCoversForGame, autoEnrichAllGameCovers, migrateExternalCoversToCloud } from '../src/main/covers.ts';

describe('Central Cloud Game Covers & Image Persistence Architecture', () => {
  let env;
  let d1;
  let r2;
  let aliceToken;
  let bobToken;
  let adminToken;
  let tmpUserDataDir;
  const aliceUid = 'gamer_alice';
  const bobUid = 'gamer_bob';

  // Sample binary image mock (1x1 PNG)
  const samplePngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  beforeEach(async () => {
    initDb(':memory:');
    const testEnv = await createTestWorkerEnv();
    env = testEnv.env;
    d1 = testEnv.d1;
    r2 = testEnv.r2;

    aliceToken = await createTestSessionToken(
      { uid: aliceUid, email: 'alice@gamevault.test', displayName: 'Alice' },
      env.SESSION_SECRET
    );
    bobToken = await createTestSessionToken(
      { uid: bobUid, email: 'bob@gamevault.test', displayName: 'Bob' },
      env.SESSION_SECRET
    );

    adminToken = await createTestSessionToken(
      { uid: 'admin_pawpaw', email: 'son6232000@gmail.com', displayName: 'PawPaw' },
      env.SESSION_SECRET
    );

    tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-covers-admin-'));

    // Mock global fetch for worker external image downloads
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('steamstatic') || urlStr.includes('igdb') || urlStr.includes('wikimedia') || urlStr.includes('external-art')) {
        return new Response(samplePngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return originalFetch(url, init);
    };

    // Configure client-side cloud-db to communicate with in-memory worker
    const fetchImpl = async (url, init = {}) => {
      const req = new Request(url, init);
      return worker.fetch(req, env);
    };
    configureAuth({
      config: { workerApiUrl: 'http://localhost', oauthClientId: 'test-cid' },
      userDataDir: tmpUserDataDir,
    });
    configureCloudDb({ workerApiUrl: 'http://localhost', fetchImpl, userDataDir: tmpUserDataDir });
    persistSession(
      {
        sessionToken: aliceToken,
        expiresAt: Date.now() + 3600 * 1000,
        user: { uid: aliceUid, email: 'alice@gamevault.test', displayName: 'Alice', photoUrl: '' },
        google: { accessToken: '', refreshToken: '', expiresAt: 0, scope: '' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir: tmpUserDataDir }
    );
  });

  afterEach(() => {
    closeDb();
    clearSession({ userDataDir: tmpUserDataDir });
    configureCloudDb({ fetchImpl: undefined, workerApiUrl: undefined, userDataDir: undefined });
    configureAuth({ userDataDir: undefined, config: undefined });
    try {
      if (tmpUserDataDir) fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // Part 1: Central Cloud Worker Endpoints
  // ==========================================================================
  describe('Worker Covers API (/api/covers)', () => {
    test('1.1: Uncached game returns 404 from GET /api/covers/:gameKey', async () => {
      const res = await worker.fetch(new Request('http://localhost/api/covers/unknown-game-123'), env);
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.found, false);
      assert.equal(data.gameKey, 'unknown-game-123');
    });

    test('1.2: First user plays new game -> POST /api/covers/cache downloads external URL and permanently stores in cloud', async () => {
      const payload = {
        gameKey: 't_black_myth_wukong',
        title: 'Black Myth: Wukong',
        steamId: 2358720,
        sourcePosterUrl: 'https://external-art.test/wukong_poster.png',
        sourceBannerUrl: 'https://external-art.test/wukong_banner.png',
      };

      const res = await worker.fetch(
        new Request('http://localhost/api/covers/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify(payload),
        }),
        env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.gameKey, 't_black_myth_wukong');
      assert.equal(data.title, 'Black Myth: Wukong');
      assert.equal(data.fromCache, false);
      assert.ok(data.coverUrl.startsWith('/api/images/cover_t_black_myth_wukong_poster'));
      assert.ok(data.bannerUrl.startsWith('/api/images/cover_t_black_myth_wukong_banner'));

      // Verify image exists and can be retrieved directly from cloud storage
      const imgRes = await worker.fetch(new Request(`http://localhost${data.coverUrl}`), env);
      assert.equal(imgRes.status, 200);
      assert.equal(imgRes.headers.get('Content-Type'), 'image/png');
      assert.equal(imgRes.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    });

    test('1.3: Second user (and all other users) retrieves EXACT SAME cloud URL from cache without re-downloading', async () => {
      // User Alice caches the game first
      const firstRes = await (
        await worker.fetch(
          new Request('http://localhost/api/covers/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
            body: JSON.stringify({
              gameKey: 't_elden_ring',
              title: 'Elden Ring',
              steamId: 1245620,
              sourcePosterUrl: 'https://external-art.test/elden_ring.png',
            }),
          }),
          env
        )
      ).json();

      assert.equal(firstRes.fromCache, false);
      const originalCoverUrl = firstRes.coverUrl;
      assert.ok(originalCoverUrl);

      // User Bob queries /api/covers/:gameKey
      const getRes = await worker.fetch(new Request('http://localhost/api/covers/t_elden_ring'), env);
      assert.equal(getRes.status, 200);
      const getData = await getRes.json();
      assert.equal(getData.found, true);
      assert.equal(getData.coverUrl, originalCoverUrl, 'Bob must receive Alice-cached cloud URL');

      // User Bob calls POST /api/covers/cache
      const secondRes = await (
        await worker.fetch(
          new Request('http://localhost/api/covers/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
            body: JSON.stringify({
              gameKey: 't_elden_ring',
              title: 'Elden Ring',
              sourcePosterUrl: 'https://some-other-url.test/diff.png',
            }),
          }),
          env
        )
      ).json();

      assert.equal(secondRes.fromCache, true, 'Subsequent calls must be served from cache');
      assert.equal(secondRes.coverUrl, originalCoverUrl, 'Cover URL must be identical for all users');
    });

    test('1.4: Direct cover upload updates central catalog and is accessible globally', async () => {
      const uploadRes = await worker.fetch(
        new Request('http://localhost/api/covers/upload?gameKey=t_custom_game&type=poster&title=Custom+Game', {
          method: 'POST',
          headers: {
            'Content-Type': 'image/png',
            ...authHeader(aliceToken),
          },
          body: samplePngBuffer,
        }),
        env
      );

      assert.equal(uploadRes.status, 201);
      const data = await uploadRes.json();
      assert.equal(data.success, true);
      assert.ok(data.url.startsWith('/api/images/cover_t_custom_game_poster'));

      // Verify central catalog has it
      const catRes = await worker.fetch(new Request('http://localhost/api/covers/t_custom_game'), env);
      const catData = await catRes.json();
      assert.equal(catData.found, true);
      assert.equal(catData.coverUrl, data.url);
    });

    test('1.5: Fallback to D1 image_store when IMAGES_BUCKET (R2) is disabled', async () => {
      // Create environment with DB only (no IMAGES_BUCKET)
      const noR2Env = {
        DB: d1,
        SESSION_SECRET: env.SESSION_SECRET,
      };

      const res = await worker.fetch(
        new Request('http://localhost/api/covers/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify({
            gameKey: 't_hades2',
            title: 'Hades II',
            sourcePosterUrl: 'https://external-art.test/hades2.png',
          }),
        }),
        noR2Env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.coverUrl);

      // Verify image was saved into D1 image_store and can be served
      const imgRes = await worker.fetch(new Request(`http://localhost${data.coverUrl}`), noR2Env);
      assert.equal(imgRes.status, 200);
      assert.equal(imgRes.headers.get('Content-Type'), 'image/png');
    });
  });

  // ==========================================================================
  // Part 2: Desktop Client Integration (covers.ts & cloud-db.ts)
  // ==========================================================================
  describe('Desktop Client Cover Resolution & Cloud Ingestion', () => {
    test('2.1: resolveWebCoversForGame checks cloud first; if missing, caches to cloud and saves cloud URL', async () => {
      const g = createGame({
        title: 'Resident Evil 4',
        steam_id: 2050650,
      });

      const db = {
        prepare: () => ({
          run: () => {},
        }),
      };

      const result = await resolveWebCoversForGame(db, g, {
        fetchImpl: async () => new Response(samplePngBuffer, { headers: { 'Content-Type': 'image/png' } }),
      });

      assert.ok(result.poster);
      assert.ok(result.poster.includes('/api/images/cover_2050650_poster'), 'Local game must receive permanent cloud URL');

      // Now verify that the cloud database actually has this game permanently stored
      const cloudCheck = await getCloudGameCover('2050650');
      assert.ok(cloudCheck);
      assert.equal(cloudCheck.found, true);
      assert.equal(cloudCheck.coverUrl, result.poster);
    });

    test('2.2: Second user resolves the same game and instantly gets the cloud URL without hitting external CDN', async () => {
      // User 1 uploads/caches game cover
      await cacheCloudGameCover({
        gameKey: 't_sekiro',
        title: 'Sekiro',
        steamId: 814380,
        sourcePosterUrl: 'https://external-art.test/sekiro_art.png',
      });

      // User 2 runs resolveWebCoversForGame for Sekiro
      const db = { prepare: () => ({ run: () => {} }) };
      const gUser2 = { id: 99, title: 'Sekiro', steam_id: 814380 };

      // Make external fetch throw to prove it NEVER hits external network
      const result = await resolveWebCoversForGame(db, gUser2, {
        fetchImpl: async () => {
          throw new Error('Should not hit external network when cached in cloud!');
        },
      });

      assert.ok(result.poster);
      assert.ok(result.poster.includes('/api/images/cover_814380_poster'));
    });

    test('2.3: autoEnrichAllGameCovers enriches missing covers by storing permanently in cloud', async () => {
      // Game without cover art
      const game = createGame({
        title: 'Cyberpunk 2077',
        steam_id: 1091500,
      });

      assert.equal(game.cover_url, null);

      // Run auto-enrich pass
      const updatedCount = await autoEnrichAllGameCovers(undefined, {
        fetchImpl: async () => new Response(samplePngBuffer, { headers: { 'Content-Type': 'image/png' } }),
      });

      assert.ok(updatedCount >= 1);

      // Verify the game in SQLite local database now points to the permanent cloud URL
      const refreshed = getGameById(game.id);
      assert.ok(refreshed.cover_url.includes('/api/images/cover_1091500_poster'));
      assert.ok(refreshed.banner_url.includes('/api/images/cover_1091500_banner'));
    });

    test('2.4: migrateExternalCoversToCloud migrates fragile external URLs to durable cloud URLs', async () => {
      const game = createGame({
        title: 'Death Stranding 2',
        steam_id: 3280350,
        cover_url: 'https://external-art.test/ds2_poster.png',
        banner_url: 'https://external-art.test/ds2_banner.png',
      });

      assert.ok(game.cover_url.startsWith('https://external-art.test'));

      const migrated = await migrateExternalCoversToCloud();
      assert.ok(migrated >= 1);

      const refreshed = getGameById(game.id);
      assert.ok(refreshed.cover_url.includes('/api/images/cover_3280350_poster'));
      assert.ok(refreshed.banner_url.includes('/api/images/cover_3280350_banner'));
    });
  });

  // ==========================================================================
  // Part 3: Admin Covers Management & Security Enforcement
  // ==========================================================================
  describe('Admin Covers Management API & Access Control', () => {
    test('3.1: Unauthenticated request to GET /api/admin/covers returns 401', async () => {
      const res = await worker.fetch(new Request('http://localhost/api/admin/covers'), env);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.includes('Authentication required'));
    });

    test('3.2: Non-admin user (Alice / Bob) is rejected from GET /api/admin/covers with 403', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/admin/covers', {
          headers: authHeader(aliceToken),
        }),
        env
      );
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.ok(data.error.includes('Admin access required'));
    });

    test('3.3: Admin user (son6232000@gmail.com) can list and search game covers with pagination', async () => {
      // Seed some game covers
      await d1.prepare(`
        INSERT INTO game_covers (game_key, title, steam_id, cover_url, banner_url, updated_at)
        VALUES ('t_elden_ring', 'Elden Ring', 1245620, '/api/images/elden.jpg', '/api/images/elden_hero.jpg', datetime('now')),
               ('t_hades_2', 'Hades II', 1145350, '/api/images/hades.jpg', '/api/images/hades_hero.jpg', datetime('now'))
      `).run();

      const res = await worker.fetch(
        new Request('http://localhost/api/admin/covers?query=elden', {
          headers: authHeader(adminToken),
        }),
        env
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.total, 1);
      assert.equal(data.covers.length, 1);
      assert.equal(data.covers[0].game_key, 't_elden_ring');
      assert.equal(data.covers[0].title, 'Elden Ring');
    });

    test('3.4: Non-admin user cannot update covers (PUT /api/admin/covers/:gameKey returns 403)', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/admin/covers/t_elden_ring', {
          method: 'PUT',
          headers: {
            ...authHeader(aliceToken),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Hacked Title' }),
        }),
        env
      );
      assert.equal(res.status, 403);
    });

    test('3.5: Admin user can update/override poster and banner URLs and external image gets ingested', async () => {
      const payload = {
        title: 'Elden Ring Shadow of the Erdtree',
        steamId: 1245620,
        sourcePosterUrl: 'https://external-art.test/er_new_poster.png',
        sourceBannerUrl: 'https://external-art.test/er_new_banner.png',
      };

      const res = await worker.fetch(
        new Request('http://localhost/api/admin/covers/t_elden_ring', {
          method: 'PUT',
          headers: {
            ...authHeader(adminToken),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }),
        env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.cover.title, 'Elden Ring Shadow of the Erdtree');
      assert.ok(data.cover.cover_url.startsWith('/api/images/cover_t_elden_ring_poster'));
      assert.ok(data.cover.banner_url.startsWith('/api/images/cover_t_elden_ring_banner'));

      // Verify any regular user fetching this game gets the admin-updated images
      const checkRes = await worker.fetch(new Request('http://localhost/api/covers/t_elden_ring'), env);
      assert.equal(checkRes.status, 200);
      const checkData = await checkRes.json();
      assert.equal(checkData.coverUrl, data.cover.cover_url);
      assert.equal(checkData.bannerUrl, data.cover.banner_url);
    });

    test('3.6: Admin user can delete a cover from the cloud catalog (DELETE /api/admin/covers/:gameKey)', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/admin/covers/t_elden_ring', {
          method: 'DELETE',
          headers: authHeader(adminToken),
        }),
        env
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Verify it is no longer in catalog
      const checkRes = await worker.fetch(new Request('http://localhost/api/covers/t_elden_ring'), env);
      assert.equal(checkRes.status, 404);
    });

    test('3.7: Client methods adminGetCloudCovers, adminUpdateCloudCover, adminDeleteCloudCover function properly', async () => {
      // Configure client auth with admin token
      configureAuth({
        config: { workerApiUrl: 'http://localhost' },
        userDataDir: tmpUserDataDir,
      });
      configureCloudDb({
        workerApiUrl: 'http://localhost',
        userDataDir: tmpUserDataDir,
        fetchImpl: async (url, init = {}) => worker.fetch(new Request(url, init), env),
      });

      persistSession(
        {
          sessionToken: adminToken,
          expiresAt: Date.now() + 3600 * 1000,
          user: {
            uid: 'admin_pawpaw',
            email: 'son6232000@gmail.com',
            displayName: 'PawPaw',
          },
        },
        { userDataDir: tmpUserDataDir }
      );

      // 1. Create/update a cover via client admin method
      const updateRes = await adminUpdateCloudCover('2358720', {
        title: 'Black Myth Wukong Remastered',
        steamId: 2358720,
        sourcePosterUrl: 'https://external-art.test/wukong_custom.png',
      });
      assert.equal(updateRes.success, true);
      assert.equal(updateRes.cover.title, 'Black Myth Wukong Remastered');
      assert.ok(updateRes.cover.cover_url.includes('/api/images/cover_2358720_poster'));

      // 2. Fetch via client admin method
      const listRes = await adminGetCloudCovers({ query: 'Wukong' });
      assert.equal(listRes.total, 1);
      assert.equal(listRes.covers[0].title, 'Black Myth Wukong Remastered');

      // 3. Delete via client admin method
      const delRes = await adminDeleteCloudCover('2358720');
      assert.equal(delRes.success, true);

      const checkDel = await getCloudGameCover('2358720');
      assert.equal(checkDel.found, false);
    });

    test('3.8: Admin cover update & binary upload propagate across user_library, ratings, community_picks, community_votes and overwrite stale client covers on sync', async () => {
      const brokenUrl = 'https://broken.cdn.test/dead_cover.jpg';
      // Seed stale broken covers across all server tables
      await d1.prepare(`
        INSERT INTO user_library (uid, game_key, title, steam_id, cover_url, banner_url, status, playtime_minutes)
        VALUES (?, '1245620', 'Elden Ring', 1245620, ?, ?, 'playing', 120)
      `).bind(aliceUid, brokenUrl, brokenUrl).run();

      await d1.prepare(`
        INSERT INTO ratings (id, uid, game_key, game_title, cover_url, score, review)
        VALUES ('r1', ?, '1245620', 'Elden Ring', ?, 9.5, 'Masterpiece')
      `).bind(aliceUid, brokenUrl).run();

      await d1.prepare(`
        INSERT INTO community_picks (month, state, game_key, game_title, cover_url)
        VALUES ('2026-11', 'voting', '1245620', 'Elden Ring', ?)
      `).bind(brokenUrl).run();

      await d1.prepare(`
        INSERT INTO community_votes (id, month, uid, game_key, game_title, cover_url)
        VALUES ('v1', '2026-11', ?, '1245620', 'Elden Ring', ?)
      `).bind(aliceUid, brokenUrl).run();

      // Admin uploads a new poster binary directly via admin upload endpoint
      const uploadRes = await worker.fetch(
        new Request('http://localhost/api/admin/covers/1245620/upload?type=poster&title=Elden%20Ring&steamId=1245620', {
          method: 'POST',
          headers: {
            ...authHeader(adminToken),
            'Content-Type': 'image/png',
          },
          body: samplePngBuffer,
        }),
        env
      );
      assert.equal(uploadRes.status, 201);
      const uploadData = await uploadRes.json();
      assert.equal(uploadData.success, true);
      assert.ok(uploadData.url.startsWith('/api/images/cover_1245620_poster'));
      assert.equal(uploadData.syncStats.userLibraryUpdated, 1);
      assert.equal(uploadData.syncStats.ratingsUpdated, 1);
      assert.equal(uploadData.syncStats.picksUpdated, 1);
      assert.equal(uploadData.syncStats.votesUpdated, 1);

      // Verify all tables in D1 now have the new cloud URL
      const libRow = await d1.prepare('SELECT cover_url FROM user_library WHERE uid = ? AND game_key = ?').bind(aliceUid, '1245620').first();
      const ratingRow = await d1.prepare('SELECT cover_url FROM ratings WHERE id = ?').bind('r1').first();
      const pickRow = await d1.prepare('SELECT cover_url FROM community_picks WHERE month = ?').bind('2026-11').first();
      const voteRow = await d1.prepare('SELECT cover_url FROM community_votes WHERE id = ?').bind('v1').first();
      assert.equal(libRow.cover_url, uploadData.url);
      assert.equal(ratingRow.cover_url, uploadData.url);
      assert.equal(pickRow.cover_url, uploadData.url);
      assert.equal(voteRow.cover_url, uploadData.url);

      // Simulate Alice's local SQLite having the old broken cover URL, then running syncLibraryWithCloud()
      configureAuth({
        config: { workerApiUrl: 'http://localhost' },
        userDataDir: tmpUserDataDir,
      });
      configureCloudDb({
        workerApiUrl: 'http://localhost',
        userDataDir: tmpUserDataDir,
        fetchImpl: async (url, init = {}) => worker.fetch(new Request(url, init), env),
      });
      persistSession(
        {
          sessionToken: aliceToken,
          expiresAt: Date.now() + 3600 * 1000,
          user: { uid: aliceUid, email: 'alice@gamevault.test', displayName: 'Alice' },
        },
        { userDataDir: tmpUserDataDir }
      );

      const localGame = createGame({
        title: 'Elden Ring',
        steam_id: 1245620,
        status: 'playing',
        playtime_minutes: 120,
        cover_url: brokenUrl,
        banner_url: brokenUrl,
      });

      await syncLibraryWithCloud();
      const updatedLocal = getGameById(localGame.id);
      assert.equal(updatedLocal.cover_url, `http://localhost${uploadData.url}`);
    });

    test('3.9: Admin discover, health-check, batch-ingest, sync-all, /api/admin/me, /api/admin/config & /admin assets serving', async () => {
      // Seed a game only in user_library (not yet in game_covers) with an external art URL
      await d1.prepare(`
        INSERT INTO user_library (uid, game_key, title, steam_id, cover_url, banner_url, status, playtime_minutes)
        VALUES (?, 't_bloodborne', 'Bloodborne', NULL, 'https://external-art.test/bb.png', 'https://broken.test/404.png', 'completed', 500)
      `).bind(aliceUid).run();

      // Mock 404 for broken.test
      const prevFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('broken.test')) {
          return new Response('Not Found', { status: 404 });
        }
        return prevFetch(url, init);
      };

      // 1. Admin /me and /config
      const cfgRes = await worker.fetch(new Request('http://localhost/api/admin/config'), env);
      assert.equal(cfgRes.status, 200);
      const meRes = await worker.fetch(new Request('http://localhost/api/admin/me', { headers: authHeader(adminToken) }), env);
      assert.equal(meRes.status, 200);
      const meData = await meRes.json();
      assert.equal(meData.isAdmin, true);

      // 2. Discover games from DB
      const discRes = await worker.fetch(
        new Request('http://localhost/api/admin/covers/discover', {
          method: 'POST',
          headers: authHeader(adminToken),
        }),
        env
      );
      assert.equal(discRes.status, 200);
      const discData = await discRes.json();
      assert.equal(discData.discovered, 1);

      // 3. Health check detects external poster & broken banner
      const hcRes = await worker.fetch(
        new Request('http://localhost/api/admin/covers/health-check', {
          method: 'POST',
          headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameKeys: ['t_bloodborne'] }),
        }),
        env
      );
      assert.equal(hcRes.status, 200);
      const hcData = await hcRes.json();
      assert.equal(hcData.results[0].overall, 'broken');
      assert.equal(hcData.results[0].poster.status, 'external_ok');
      assert.equal(hcData.results[0].banner.status, 'broken');

      // 4. Batch ingest downloads healthy external poster to cloud storage
      const biRes = await worker.fetch(
        new Request('http://localhost/api/admin/covers/batch-ingest', {
          method: 'POST',
          headers: { ...authHeader(adminToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameKeys: ['t_bloodborne'] }),
        }),
        env
      );
      assert.equal(biRes.status, 200);
      const biData = await biRes.json();
      assert.equal(biData.fixed, 1);

      const libAfter = await d1.prepare('SELECT cover_url FROM user_library WHERE game_key = ?').bind('t_bloodborne').first();
      assert.ok(libAfter.cover_url.startsWith('/api/images/cover_t_bloodborne_poster'));

      // 5. Serving /admin via ASSETS binding
      const envWithAssets = {
        ...env,
        ASSETS: {
          async fetch(req) {
            const u = new URL(req.url);
            if (u.pathname === '/index.html') {
              return new Response('<html>Admin App</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('Not found', { status: 404 });
          },
        },
      };
      const redirectRes = await worker.fetch(new Request('http://localhost/admin'), envWithAssets);
      assert.equal(redirectRes.status, 302);
      const htmlRes = await worker.fetch(new Request('http://localhost/admin/'), envWithAssets);
      assert.equal(htmlRes.status, 200);
      assert.ok((await htmlRes.text()).includes('Admin App'));

      // 6. Test adminUploadCloudCover client helper
      configureAuth({
        config: { workerApiUrl: 'http://localhost' },
        userDataDir: tmpUserDataDir,
      });
      persistSession(
        {
          sessionToken: adminToken,
          expiresAt: Date.now() + 3600 * 1000,
          user: { uid: 'admin_pawpaw', email: 'son6232000@gmail.com', displayName: 'PawPaw' },
        },
        { userDataDir: tmpUserDataDir }
      );
      const clientUpload = await adminUploadCloudCover('t_bloodborne', 'banner', samplePngBuffer, 'image/png', { title: 'Bloodborne' });
      assert.equal(clientUpload.success, true);
      assert.ok(clientUpload.url.includes('/api/images/cover_t_bloodborne_banner'));
      globalThis.fetch = prevFetch;
    });

    test('3.10: POST /api/covers/cache rejects landscape images as posters and never reuses library_hero for poster slot', async () => {
      // Create a 16x9 PNG (width=16, height=9 -> strictly landscape)
      const landscapePng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x10, // width = 16
        0x00, 0x00, 0x00, 0x09, // height = 9
        0x08, 0x06, 0x00, 0x00, 0x00,
      ]);

      const prevFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('landscape-art.test')) {
          return new Response(landscapePng, { status: 200, headers: { 'Content-Type': 'image/png' } });
        }
        return prevFetch(url, init);
      };

      const res = await worker.fetch(
        new Request('http://localhost/api/covers/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify({
            gameKey: '9999991',
            title: 'Landscape Test Game',
            sourcePosterUrl: 'https://landscape-art.test/wide_poster.png',
            sourceBannerUrl: 'https://landscape-art.test/library_hero.jpg',
          }),
        }),
        env
      );

      globalThis.fetch = prevFetch;
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.coverUrl, null, 'Landscape image must NOT be stored as vertical poster');
      assert.ok(data.bannerUrl && data.bannerUrl.startsWith('/api/images/cover_9999991_banner'), 'Landscape image is still valid for banner');
    });
  });
});
