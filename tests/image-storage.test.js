import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.ts';
import {
  createTestWorkerEnv,
  createTestSessionToken,
  authHeader,
} from './test-helpers-cloudflare.js';
import {
  createMockGooglePhotosServer,
  createMockS3Server,
  createMockStorageMultiplexer,
  uploadToGooglePhotos,
  createGooglePhotosAlbum,
  refreshGooglePhotosBaseUrl,
  uploadToS3,
  testS3Connection,
  uploadImageFile,
  sha256Hex,
  MOCK_SESSION_SECRET,
} from './test-helpers-storage.js';

describe('Image Storage Architecture Test Suite', () => {
  let gphotosMock;
  let s3Mock;
  let workerEnv;
  let d1;
  let r2;
  let sessionToken;
  const testAccessToken = 'test_google_access_token_123';

  beforeEach(async () => {
    gphotosMock = createMockGooglePhotosServer();
    s3Mock = createMockS3Server({
      expectedBucket: 'game-covers-bucket',
      expectedAccessKeyId: 'MY_AWS_ACCESS_KEY',
    });

    const testEnv = await createTestWorkerEnv({ sessionSecret: MOCK_SESSION_SECRET });
    workerEnv = testEnv.env;
    d1 = testEnv.d1;
    r2 = testEnv.r2;

    sessionToken = await createTestSessionToken({ uid: 'gamer_1', email: 'gamer1@test.com' }, workerEnv.SESSION_SECRET);
  });

  // ==========================================================================
  // Tier 1 — Feature Coverage (Isolated Happy Path)
  // ==========================================================================
  describe('Tier 1: Feature Coverage', () => {
    test('T1-GPHOTOS-01: 2-Step Upload Flow (byte upload to /v1/uploads followed by batchCreate)', async () => {
      const imgBuffer = Buffer.from('fake-jpeg-image-bytes');
      const result = await uploadToGooglePhotos(
        imgBuffer,
        'cover.jpg',
        'image/jpeg',
        undefined,
        testAccessToken,
        gphotosMock.fetch
      );

      assert.ok(result.mediaItemId.startsWith('photo_'));
      assert.ok(result.baseUrl.startsWith('https://lh3.googleusercontent.com/'));
      assert.ok(result.expiresAt > Date.now());

      const calls = gphotosMock.getCalls();
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, 'https://photoslibrary.googleapis.com/v1/uploads');
      assert.equal(calls[0].method, 'POST');
      assert.equal(calls[1].url, 'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate');
      assert.equal(calls[1].method, 'POST');
    });

    test('T1-GPHOTOS-02: Album Attachment in batchCreate payload', async () => {
      const imgBuffer = Buffer.from('album-image-bytes');
      const albumId = 'album_custom_123';

      await uploadToGooglePhotos(
        imgBuffer,
        'game_art.jpg',
        'image/jpeg',
        albumId,
        testAccessToken,
        gphotosMock.fetch
      );

      const calls = gphotosMock.getCalls();
      const batchCall = calls.find(c => c.url.includes('batchCreate'));
      assert.ok(batchCall);
      const payload = JSON.parse(batchCall.body);
      assert.equal(payload.albumId, albumId);
    });

    test('T1-GPHOTOS-03: Album Creation creates record and returns id', async () => {
      const album = await createGooglePhotosAlbum('GameVault Covers', testAccessToken, gphotosMock.fetch);
      assert.ok(album.id.startsWith('album_'));
      assert.equal(album.title, 'GameVault Covers');
      assert.ok(album.productUrl.includes(album.id));

      const albumsMap = gphotosMock.getAlbums();
      assert.ok(albumsMap.has(album.id));
    });

    test('T1-GPHOTOS-04: BaseUrl Refresh retrieves fresh URL without re-uploading bytes', async () => {
      const imgBuffer = Buffer.from('refresh-test-bytes');
      const initial = await uploadToGooglePhotos(imgBuffer, 'refresh.jpg', 'image/jpeg', null, testAccessToken, gphotosMock.fetch);

      gphotosMock.clearCalls();

      const refreshed = await refreshGooglePhotosBaseUrl(initial.mediaItemId, testAccessToken, gphotosMock.fetch);
      assert.equal(refreshed.id, initial.mediaItemId);
      assert.ok(refreshed.baseUrl.startsWith('https://lh3.googleusercontent.com/'));
      assert.notEqual(refreshed.baseUrl, initial.baseUrl); // Fresh URL

      const calls = gphotosMock.getCalls();
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'GET');
    });

    test('T1-GPHOTOS-05: Cache TTL Tracking margin (~50 minutes)', async () => {
      const now = Date.now();
      const result = await uploadToGooglePhotos(Buffer.from('ttl-bytes'), 'ttl.jpg', 'image/jpeg', null, testAccessToken, gphotosMock.fetch);
      const diffMinutes = (result.expiresAt - now) / (60 * 1000);
      assert.ok(diffMinutes >= 49 && diffMinutes <= 51, `Expected ~50 min TTL, got ${diffMinutes}`);
    });

    test('T1-S3-01: SigV4 Signature Generation with AWS4-HMAC-SHA256 header', async () => {
      const body = Buffer.from('s3-binary-png');
      await uploadToS3({
        endpoint: 'https://s3.example.com',
        bucket: 'game-covers-bucket',
        accessKeyId: 'MY_AWS_ACCESS_KEY',
        secretAccessKey: 'MY_AWS_SECRET_KEY',
        key: 'covers/game1.png',
        body,
        contentType: 'image/png',
        fetchImpl: s3Mock.fetch,
      });

      const calls = s3Mock.getCalls();
      assert.equal(calls.length, 1);
      const auth = calls[0].headers.authorization || calls[0].headers.Authorization;
      assert.ok(auth.startsWith('AWS4-HMAC-SHA256 '));
      assert.ok(auth.includes('Credential=MY_AWS_ACCESS_KEY/'));
      assert.ok(auth.includes('SignedHeaders='));
      assert.ok(auth.includes('Signature='));
    });

    test('T1-S3-02: S3 Payload Hash Verification matches SHA256 of body', async () => {
      const body = Buffer.from('verify-sha256-payload');
      const expectedHash = sha256Hex(body);

      await uploadToS3({
        endpoint: 'https://s3.example.com',
        bucket: 'game-covers-bucket',
        accessKeyId: 'MY_AWS_ACCESS_KEY',
        secretAccessKey: 'MY_AWS_SECRET_KEY',
        key: 'covers/sha.png',
        body,
        contentType: 'image/png',
        fetchImpl: s3Mock.fetch,
      });

      const calls = s3Mock.getCalls();
      const sentHash = calls[0].headers['x-amz-content-sha256'];
      assert.equal(sentHash, expectedHash);
    });

    test('T1-S3-03: Custom Public URL Base formatting', async () => {
      const url = await uploadToS3({
        endpoint: 'https://s3.example.com',
        bucket: 'game-covers-bucket',
        accessKeyId: 'MY_AWS_ACCESS_KEY',
        secretAccessKey: 'MY_AWS_SECRET_KEY',
        key: 'covers/cdn-test.jpg',
        body: Buffer.from('cdn-data'),
        contentType: 'image/jpeg',
        publicUrlBase: 'https://cdn.mygamevault.net',
        fetchImpl: s3Mock.fetch,
      });

      assert.equal(url, 'https://cdn.mygamevault.net/covers/cdn-test.jpg');
    });

    test('T1-S3-04: Path-Style URL Fallback without custom CDN base', async () => {
      const url = await uploadToS3({
        endpoint: 'https://s3.example.com',
        bucket: 'game-covers-bucket',
        accessKeyId: 'MY_AWS_ACCESS_KEY',
        secretAccessKey: 'MY_AWS_SECRET_KEY',
        key: 'covers/direct.jpg',
        body: Buffer.from('direct-data'),
        contentType: 'image/jpeg',
        fetchImpl: s3Mock.fetch,
      });

      assert.equal(url, 'https://s3.example.com/game-covers-bucket/covers/direct.jpg');
    });

    test('T1-S3-05: Connection Probe (Valid) returns { ok: true }', async () => {
      const probeRes = await testS3Connection(
        {
          endpoint: 'https://s3.example.com',
          bucket: 'game-covers-bucket',
          accessKeyId: 'MY_AWS_ACCESS_KEY',
          secretAccessKey: 'MY_AWS_SECRET_KEY',
        },
        s3Mock.fetch
      );
      assert.equal(probeRes.ok, true);
    });

    test('T1-R2-01: Shared R2 Worker Upload via POST /api/images/upload', async () => {
      const pngBytes = Buffer.from('shared-r2-png-data');
      const res = await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(sessionToken) },
          body: pngBytes,
        }),
        workerEnv
      );

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.key.endsWith('.png'));
      assert.equal(data.url, `/api/images/${data.key}`);
    });

    test('T1-R2-02: Image Kind Headers (poster, banner, screenshot)', async () => {
      const kinds = ['poster', 'banner', 'screenshot'];
      for (const kind of kinds) {
        const res = await worker.fetch(
          new Request('http://localhost/api/images/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg', 'X-Image-Kind': kind, ...authHeader(sessionToken) },
            body: Buffer.from(`data-for-${kind}`),
          }),
          workerEnv
        );
        assert.equal(res.status, 201);
      }
    });

    test('T1-DISPATCH-01: Google Photos Dispatch via uploadImageFile', async () => {
      const fileBuffer = Buffer.from('dispatch-photo-bytes');
      const settings = {
        imageStorageProvider: 'google_photos',
        googlePhotosAlbumId: 'album_g1',
      };

      const result = await uploadImageFile({
        fileBuffer,
        fileName: 'game.png',
        mimeType: 'image/png',
        settings,
        googleAccessToken: testAccessToken,
        fetchImpl: gphotosMock.fetch,
      });

      assert.equal(result.provider, 'google_photos');
      assert.ok(result.url.startsWith('https://lh3.googleusercontent.com/'));
      assert.equal(result.isCustomS3, false);
    });

    test('T1-DISPATCH-02: Custom S3 Dispatch via uploadImageFile', async () => {
      const fileBuffer = Buffer.from('dispatch-s3-bytes');
      const settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'game-covers-bucket',
          accessKeyId: 'MY_AWS_ACCESS_KEY',
          secretAccessKey: 'MY_AWS_SECRET_KEY',
        },
      };

      const result = await uploadImageFile({
        fileBuffer,
        fileName: 'cover_s3.png',
        mimeType: 'image/png',
        settings,
        fetchImpl: s3Mock.fetch,
      });

      assert.equal(result.provider, 'cloudflare_r2');
      assert.equal(result.isCustomS3, true);
      assert.ok(result.url.includes('cover_s3.png'));
    });

    test('T1-DISPATCH-03: Shared R2 Dispatch via uploadImageFile', async () => {
      const fileBuffer = Buffer.from('dispatch-r2-bytes');
      const settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: { enabled: false },
      };

      const result = await uploadImageFile({
        fileBuffer,
        fileName: 'shared.png',
        mimeType: 'image/png',
        settings,
        sessionToken,
        fetchImpl: (url, init) => worker.fetch(new Request(url, init), workerEnv),
      });

      assert.equal(result.provider, 'cloudflare_r2');
      assert.equal(result.isCustomS3, false);
      assert.ok(result.url.startsWith('/api/images/'));
    });
  });

  // ==========================================================================
  // Tier 2 — Boundary & Corner Cases
  // ==========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    test('T2-GPHOTOS-01: Expired OAuth Token returns 401', async () => {
      await assert.rejects(
        async () => {
          await uploadToGooglePhotos(
            Buffer.from('bytes'),
            'cover.jpg',
            'image/jpeg',
            null,
            'expired_token',
            gphotosMock.fetch
          );
        },
        /HTTP 401/
      );
    });

    test('T2-GPHOTOS-02: Missing Scope returns 403 Forbidden', async () => {
      await assert.rejects(
        async () => {
          await uploadToGooglePhotos(
            Buffer.from('bytes'),
            'cover.jpg',
            'image/jpeg',
            null,
            'missing_scope_token',
            gphotosMock.fetch
          );
        },
        /HTTP 403/
      );
    });

    test('T2-GPHOTOS-03: API Rate Limit / Quota (429) handled cleanly', async () => {
      const quotaMock = createMockGooglePhotosServer({ simulateQuotaError: true });
      await assert.rejects(
        async () => {
          await uploadToGooglePhotos(
            Buffer.from('bytes'),
            'cover.jpg',
            'image/jpeg',
            null,
            testAccessToken,
            quotaMock.fetch
          );
        },
        /HTTP 429/
      );
    });

    test('T2-GPHOTOS-04: Batch Item Creation Failure returns descriptive error', async () => {
      const errMock = createMockGooglePhotosServer({ simulateBatchItemError: true });
      await assert.rejects(
        async () => {
          await uploadToGooglePhotos(
            Buffer.from('bytes'),
            'cover.jpg',
            'image/jpeg',
            null,
            testAccessToken,
            errMock.fetch
          );
        },
        /Google Photos creation error/
      );
    });

    test('T2-GPHOTOS-05: Network Disconnection throws TypeError', async () => {
      const offlineMock = createMockGooglePhotosServer({ simulateNetworkError: true });
      await assert.rejects(
        async () => {
          await uploadToGooglePhotos(
            Buffer.from('bytes'),
            'cover.jpg',
            'image/jpeg',
            null,
            testAccessToken,
            offlineMock.fetch
          );
        },
        /network offline/
      );
    });

    test('T2-S3-01: Invalid Access Key ID returns 403', async () => {
      const res = await testS3Connection(
        {
          endpoint: 'https://s3.example.com',
          bucket: 'game-covers-bucket',
          accessKeyId: 'WRONG_KEY',
          secretAccessKey: 'MY_AWS_SECRET_KEY',
        },
        s3Mock.fetch
      );
      assert.equal(res.ok, false);
      assert.match(res.error, /HTTP 403/);
    });

    test('T2-S3-02: Invalid Secret Key returns 403 SignatureDoesNotMatch', async () => {
      const badSigMock = createMockS3Server({ simulateInvalidSignature: true });
      const res = await testS3Connection(
        {
          endpoint: 'https://s3.example.com',
          bucket: 'game-covers-bucket',
          accessKeyId: 'MY_AWS_ACCESS_KEY',
          secretAccessKey: 'WRONG_SECRET',
        },
        badSigMock.fetch
      );
      assert.equal(res.ok, false);
      assert.match(res.error, /HTTP 403/);
    });

    test('T2-S3-03: Non-Existent Bucket returns 404 NoSuchBucket', async () => {
      const res = await testS3Connection(
        {
          endpoint: 'https://s3.example.com',
          bucket: 'totally-non-existent-bucket',
          accessKeyId: 'MY_AWS_ACCESS_KEY',
          secretAccessKey: 'MY_AWS_SECRET_KEY',
        },
        s3Mock.fetch
      );
      assert.equal(res.ok, false);
      assert.match(res.error, /HTTP 404/);
    });

    test('T2-S3-04: Clock Skew returns 403 RequestTimeTooSkewed', async () => {
      const skewMock = createMockS3Server({ simulateClockSkew: true });
      const res = await testS3Connection(
        {
          endpoint: 'https://s3.example.com',
          bucket: 'game-covers-bucket',
          accessKeyId: 'MY_AWS_ACCESS_KEY',
          secretAccessKey: 'MY_AWS_SECRET_KEY',
        },
        skewMock.fetch
      );
      assert.equal(res.ok, false);
      assert.match(res.error, /HTTP 403/);
    });

    test('T2-S3-05: Payload Hash Mismatch returns 400', async () => {
      const res = await s3Mock.fetch('https://s3.example.com/game-covers-bucket/tampered.png', {
        method: 'PUT',
        headers: {
          Host: 's3.example.com',
          Authorization: 'AWS4-HMAC-SHA256 Credential=MY_AWS_ACCESS_KEY/20261123/auto/s3/aws4_request, SignedHeaders=host, Signature=abcdef1234',
          'x-amz-date': '20261123T120000Z',
          'x-amz-content-sha256': '0000000000000000000000000000000000000000000000000000000000000000',
        },
        body: Buffer.from('different-content'),
      });
      assert.equal(res.status, 400);
      const text = await res.text();
      assert.match(text, /XAmzContentSHA256Mismatch/);
    });

    test('T2-DISPATCH-01: Missing Session for Shared R2 throws error', async () => {
      await assert.rejects(
        async () => {
          await uploadImageFile({
            fileBuffer: Buffer.from('test'),
            fileName: 'pic.png',
            settings: { imageStorageProvider: 'cloudflare_r2', customS3Config: { enabled: false } },
            sessionToken: null, // missing token
          });
        },
        /Chưa đăng nhập/
      );
    });

    test('T2-DISPATCH-02: Zero-byte image file rejection', async () => {
      await assert.rejects(
        async () => {
          await uploadImageFile({
            fileBuffer: Buffer.alloc(0),
            fileName: 'empty.png',
            settings: { imageStorageProvider: 'google_photos' },
          });
        },
        /cannot be empty/
      );
    });

    test('T2-DISPATCH-03: Max file size (>10MB) rejection', async () => {
      await assert.rejects(
        async () => {
          await uploadImageFile({
            fileBuffer: Buffer.alloc(11 * 1024 * 1024),
            fileName: 'huge.png',
            settings: { imageStorageProvider: 'google_photos' },
          });
        },
        /exceeds maximum size/
      );
    });
  });

  // ==========================================================================
  // Tier 3 — Cross-Feature Combinations
  // ==========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    test('T3-IMAGE-01: Provider Switch + Cover Persistence across Google Photos and S3', async () => {
      const multiplexer = createMockStorageMultiplexer({
        googlePhotosMock: gphotosMock,
        s3Mock,
      });

      // 1. Upload Game 1 cover via Google Photos
      const gphotoCover = await uploadImageFile({
        fileBuffer: Buffer.from('game-1-art'),
        fileName: 'game1.jpg',
        settings: { imageStorageProvider: 'google_photos' },
        googleAccessToken: testAccessToken,
        fetchImpl: multiplexer,
      });
      assert.equal(gphotoCover.provider, 'google_photos');

      // 2. User switches provider in settings to Custom S3
      const s3Settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'game-covers-bucket',
          accessKeyId: 'MY_AWS_ACCESS_KEY',
          secretAccessKey: 'MY_AWS_SECRET_KEY',
          publicUrlBase: 'https://mycdn.test',
        },
      };

      // 3. Upload Game 2 cover via Custom S3
      const s3Cover = await uploadImageFile({
        fileBuffer: Buffer.from('game-2-art'),
        fileName: 'game2.jpg',
        settings: s3Settings,
        fetchImpl: multiplexer,
      });
      assert.equal(s3Cover.provider, 'cloudflare_r2');
      assert.equal(s3Cover.isCustomS3, true);

      // Verify both URLs are distinct and valid
      assert.ok(gphotoCover.url.startsWith('https://lh3.googleusercontent.com/'));
      assert.ok(s3Cover.url.startsWith('https://mycdn.test/covers/game2.jpg'));
    });

    test('T3-IMAGE-02: Auth Session + Shared R2 Upload + Image Retrieval Stream', async () => {
      // Authenticate
      const userToken = await createTestSessionToken({ uid: 'screenshot_hero', email: 'hero@vault.test' }, workerEnv.SESSION_SECRET);

      // Upload screenshot to R2
      const screenshotData = Buffer.from('4k-victory-screenshot-buffer');
      const uploadResult = await uploadImageFile({
        fileBuffer: screenshotData,
        fileName: 'victory.png',
        mimeType: 'image/png',
        kind: 'screenshot',
        settings: { imageStorageProvider: 'cloudflare_r2', customS3Config: { enabled: false } },
        sessionToken: userToken,
        fetchImpl: (url, init) => worker.fetch(new Request(url, init), workerEnv),
      });

      assert.equal(uploadResult.provider, 'cloudflare_r2');
      assert.ok(uploadResult.url.startsWith('/api/images/'));

      // Stream image back from public worker endpoint
      const streamRes = await worker.fetch(new Request(`http://localhost${uploadResult.url}`), workerEnv);
      assert.equal(streamRes.status, 200);
      assert.equal(streamRes.headers.get('Content-Type'), 'image/png');
      const downloaded = Buffer.from(await streamRes.arrayBuffer());
      assert.deepEqual(downloaded, screenshotData);
    });

    test('T3-IMAGE-03: Connection Test + Settings Persistence + Upload', async () => {
      const config = {
        enabled: true,
        endpoint: 'https://s3.example.com',
        bucket: 'game-covers-bucket',
        accessKeyId: 'MY_AWS_ACCESS_KEY',
        secretAccessKey: 'MY_AWS_SECRET_KEY',
      };

      // 1. Connection test probe passes
      const probe = await testS3Connection(config, s3Mock.fetch);
      assert.equal(probe.ok, true);

      // 2. Subsequent upload succeeds against tested configuration
      const uploadedUrl = await uploadToS3({
        ...config,
        key: 'covers/verified.png',
        body: Buffer.from('verified-cover'),
        contentType: 'image/png',
        fetchImpl: s3Mock.fetch,
      });

      assert.ok(uploadedUrl.includes('covers/verified.png'));
    });
  });

  // ==========================================================================
  // Tier 4 — Real-World Application Scenarios
  // ==========================================================================
  describe('Tier 4: Real-World Scenarios', () => {
    test('T4-IMAGE-01: Custom Cover Upload Workflow', async () => {
      // User uploads a custom cover art for a game
      const customCoverBytes = Buffer.from('custom-hd-boxart-image');
      const uploadRes = await uploadImageFile({
        fileBuffer: customCoverBytes,
        fileName: 'hollow_knight_hd.png',
        mimeType: 'image/png',
        kind: 'poster',
        settings: {
          imageStorageProvider: 'cloudflare_r2',
          customS3Config: {
            enabled: true,
            endpoint: 'https://s3.example.com',
            bucket: 'game-covers-bucket',
            accessKeyId: 'MY_AWS_ACCESS_KEY',
            secretAccessKey: 'MY_AWS_SECRET_KEY',
          },
        },
        fetchImpl: s3Mock.fetch,
      });

      assert.equal(uploadRes.isCustomS3, true);
      assert.ok(uploadRes.url.includes('hollow_knight_hd.png'));

      // Attach to game review in D1
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, cover_url, score) VALUES (?, ?, ?, ?, ?, ?)`).bind(
        'rev_hk', 'user_custom', 'hk', 'Hollow Knight', uploadRes.url, 10
      ).run();

      const saved = await d1.prepare('SELECT cover_url FROM ratings WHERE id = ?').bind('rev_hk').first();
      assert.equal(saved.cover_url, uploadRes.url);
    });

    test('T4-IMAGE-02: Dual Storage Migration Scenario', async () => {
      const multiplexer = createMockStorageMultiplexer({
        googlePhotosMock: gphotosMock,
        s3Mock,
      });

      // 5 games stored on Google Photos
      const gphotoGames = [];
      for (let i = 1; i <= 5; i++) {
        const res = await uploadImageFile({
          fileBuffer: Buffer.from(`art-${i}`),
          fileName: `game-${i}.jpg`,
          settings: { imageStorageProvider: 'google_photos' },
          googleAccessToken: testAccessToken,
          fetchImpl: multiplexer,
        });
        gphotoGames.push(res.url);
      }
      assert.equal(gphotoGames.length, 5);

      // User switches to Cloudflare R2
      const r2Settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'game-covers-bucket',
          accessKeyId: 'MY_AWS_ACCESS_KEY',
          secretAccessKey: 'MY_AWS_SECRET_KEY',
        },
      };

      // 5 new games stored on Cloudflare R2
      const r2Games = [];
      for (let i = 6; i <= 10; i++) {
        const res = await uploadImageFile({
          fileBuffer: Buffer.from(`art-${i}`),
          fileName: `game-${i}.jpg`,
          settings: r2Settings,
          fetchImpl: multiplexer,
        });
        r2Games.push(res.url);
      }
      assert.equal(r2Games.length, 5);

      // Verify all 10 URLs are intact and valid
      for (const url of gphotoGames) {
        assert.ok(url.startsWith('https://lh3.googleusercontent.com/'));
      }
      for (const url of r2Games) {
        assert.ok(url.includes('game-covers-bucket'));
      }
    });
  });
});
