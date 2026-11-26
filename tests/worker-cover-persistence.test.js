import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.ts';
import { saveImageToCloud } from '../worker/src/routes/images.ts';
import { createTestWorkerEnv, createTestSessionToken, authHeader } from './test-helpers-cloudflare.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const oldPoster = '/api/images/old-poster.png';
const oldBanner = '/api/images/old-banner.png';
const sourcePoster = 'https://art.test/poster.png';
const sourceBanner = 'https://art.test/banner.png';

describe('Cloud cover persistence failures', () => {
  let env;
  let d1;
  let r2;
  let token;

  beforeEach(async () => {
    ({ env, d1, r2 } = await createTestWorkerEnv({ env: { ADMIN_EMAILS: 'admin@gamevault.test' } }));
    token = await createTestSessionToken({ uid: 'admin', email: 'admin@gamevault.test' }, env.SESSION_SECRET);
    await d1.exec(`
      INSERT INTO game_covers (game_key, title, steam_id, cover_url, banner_url)
      VALUES ('test-game', 'Original Title', 123, '${oldPoster}', '${oldBanner}');
      INSERT INTO user_library (uid, game_key, title, cover_url, banner_url)
      VALUES ('user', 'test-game', 'Original Title', '${oldPoster}', '${oldBanner}');
      INSERT INTO ratings (id, uid, game_key, game_title, score, cover_url)
      VALUES ('review', 'user', 'test-game', 'Original Title', 8, '${oldPoster}');
      INSERT INTO community_picks (month, game_key, game_title, cover_url)
      VALUES ('2026-11', 'test-game', 'Original Title', '${oldPoster}');
    `);
    for (const key of ['old-poster.png', 'old-banner.png']) {
      await r2.put(key, image, { httpMetadata: { contentType: 'image/png' } });
      await d1.prepare('INSERT INTO image_store (key, mime_type, data) VALUES (?, ?, ?)').bind(key, 'image/png', image).run();
    }
  });

  afterEach(() => d1.sqlite.close());

  async function snapshot() {
    return Promise.all(['game_covers', 'user_library', 'ratings', 'community_picks'].map(async (table) => (
      await d1.prepare(`SELECT * FROM ${table}`).all()
    ).results));
  }

  function update(payload, gameKey = 'test-game') {
    return worker.fetch(new Request(`http://localhost/api/admin/covers/${gameKey}`, {
      method: 'PUT',
      headers: { ...authHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), env);
  }

  async function assertFailedUpdate(payload, status = 502) {
    const before = await snapshot();
    const response = await update({ title: 'Changed Title', steamId: 456, ...payload });
    assert.equal(response.status, status);
    const result = await response.json();
    assert.ok(result.error);
    assert.notEqual(result.success, true);
    assert.deepEqual(await snapshot(), before, 'failed image saves must preserve catalog and propagated covers');
  }

  function failD1ImageWrite(t, result) {
    const prepare = d1.prepare.bind(d1);
    t.mock.method(d1, 'prepare', (sql) => {
      if (!sql.includes('INSERT OR REPLACE INTO image_store')) return prepare(sql);
      return {
        bind() { return this; },
        async run() {
          if (result) return result;
          throw new Error('Simulated D1 write failure');
        },
      };
    });
  }

  for (const field of ['coverUrl', 'bannerUrl', 'sourcePosterUrl', 'sourceBannerUrl']) {
    test(`${field}: broken source fails without replacing old covers`, async (t) => {
      t.mock.method(globalThis, 'fetch', async () => new Response('Not found', { status: 404 }));
      await assertFailedUpdate({ [field]: sourcePoster });
    });
    test(`${field}: missing cloud image fails instead of accepting a nonexistent URL`, async (t) => {
      t.mock.method(globalThis, 'fetch', async () => { throw new Error('Cloud images must not use external fetch'); });
      await assertFailedUpdate({ [field]: 'http://localhost/api/images/missing.png' });
    });
  }

  test('network timeout fails without saving the external URL', async (t) => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('Timed out', 'AbortError'); });
    await assertFailedUpdate({ coverUrl: sourcePoster });
  });

  test('successful poster plus broken banner preserves both old cover references', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url) => String(url) === sourcePoster
      ? new Response(image, { headers: { 'Content-Type': 'image/png' } })
      : new Response('Not found', { status: 404 }));
    await assertFailedUpdate({ coverUrl: sourcePoster, bannerUrl: sourceBanner });
  });

  test('failed source does not create a new catalog entry', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('Not found', { status: 404 }));
    const response = await update({ coverUrl: sourcePoster }, 'new-game');
    assert.equal(response.status, 502);
    assert.equal(await d1.prepare("SELECT * FROM game_covers WHERE game_key = 'new-game'").first(), null);
  });

  test('HTTP 200 with HTML is rejected instead of being saved as a JPEG', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('<html>Error page</html>', { headers: { 'Content-Type': 'text/html' } }));
    await assertFailedUpdate({ coverUrl: sourcePoster });
  });

  test('D1 write exception rejects imported covers', async (t) => {
    env.IMAGES_BUCKET = undefined;
    t.mock.method(console, 'warn', () => {});
    t.mock.method(globalThis, 'fetch', async () => new Response(image, { headers: { 'Content-Type': 'image/png' } }));
    failD1ImageWrite(t);
    await assertFailedUpdate({ coverUrl: sourcePoster });
  });

  test('D1 unsuccessful write result rejects imported covers', async (t) => {
    env.IMAGES_BUCKET = undefined;
    t.mock.method(console, 'warn', () => {});
    t.mock.method(globalThis, 'fetch', async () => new Response(image, { headers: { 'Content-Type': 'image/png' } }));
    failD1ImageWrite(t, { success: false, error: 'Simulated quota exceeded' });
    await assertFailedUpdate({ bannerUrl: sourceBanner });
  });

  test('R2 write failure rejects imported covers', async (t) => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(globalThis, 'fetch', async () => new Response(image, { headers: { 'Content-Type': 'image/png' } }));
    t.mock.method(r2, 'put', async () => { throw new Error('Simulated R2 failure'); });
    await assertFailedUpdate({ coverUrl: sourcePoster });
  });

  test('D1 write failure rejects binary uploads without updating the catalog', async (t) => {
    env.IMAGES_BUCKET = undefined;
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    failD1ImageWrite(t);
    const before = await snapshot();
    const response = await worker.fetch(new Request('http://localhost/api/admin/covers/test-game/upload?type=poster', {
      method: 'POST', headers: { ...authHeader(token), 'Content-Type': 'image/png' }, body: image,
    }), env);
    assert.equal(response.status, 500);
    assert.ok((await response.json()).error);
    assert.deepEqual(await snapshot(), before);
  });

  test('image storage helper rejects missing storage configuration', async () => {
    await assert.rejects(saveImageToCloud('missing.png', image, 'image/png', {}));
  });

  for (const storage of ['R2', 'D1']) {
    test(`${storage}: saved covers remain accessible when the source stops working`, async (t) => {
      if (storage === 'D1') env.IMAGES_BUCKET = undefined;
      t.mock.method(globalThis, 'fetch', async () => new Response(image, { headers: { 'Content-Type': 'image/png' } }));
      const response = await update({ coverUrl: sourcePoster, bannerUrl: sourceBanner });
      assert.equal(response.status, 200);
      const { success, cover } = await response.json();
      assert.equal(success, true);
      t.mock.method(globalThis, 'fetch', async () => { throw new Error('Source is no longer available'); });
      for (const url of [cover.cover_url, cover.banner_url]) {
        assert.match(url, /^\/api\/images\//);
        const saved = await worker.fetch(new Request(`http://localhost${url}`), env);
        assert.equal(saved.status, 200);
        assert.equal(saved.headers.get('Content-Type'), 'image/png');
        assert.deepEqual(Buffer.from(await saved.arrayBuffer()), image);
      }
      const library = await d1.prepare("SELECT cover_url, banner_url FROM user_library WHERE game_key = 'test-game'").first();
      assert.equal(library.cover_url, cover.cover_url);
      assert.equal(library.banner_url, cover.banner_url);
    });
  }

  test('existing cloud URLs can be retained and explicitly cleared', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('Existing cloud images must not be downloaded'); });
    const response = await update({ coverUrl: `http://localhost${oldPoster}`, bannerUrl: oldBanner });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cover.cover_url, oldPoster);
    const cleared = await update({ coverUrl: null, bannerUrl: '' });
    assert.equal(cleared.status, 200);
    const { cover } = await cleared.json();
    assert.equal(cover.cover_url, null);
    assert.equal(cover.banner_url, null);
  });
});
