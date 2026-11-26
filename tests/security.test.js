import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index.ts';
import { createSessionToken, verifySessionToken, isValidSessionSecret } from '../worker/src/auth.ts';
import { isAllowedExternalImageUrl } from '../worker/src/routes/covers.ts';
import { createTestWorkerEnv, createTestSessionToken, authHeader } from './test-helpers-cloudflare.js';
import {
  configureSecureStorage,
  encryptSecretString,
  decryptSecretString,
  isEncryptedSecret,
} from '../src/main/secure-storage.ts';
import {
  configureAuth,
  persistSession,
  loadSession,
  clearSession,
} from '../src/main/auth.ts';
import { loadAppSettings, saveAppSettings, maskSettingsSecrets, MASK_SECRET } from '../src/main/settings.ts';

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function createMockSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`MOCK_DPAPI:${Buffer.from(plain, 'utf-8').toString('base64')}`, 'utf-8'),
    decryptString: (buf) => {
      const s = Buffer.from(buf).toString('utf-8');
      if (!s.startsWith('MOCK_DPAPI:')) throw new Error('Invalid ciphertext');
      return Buffer.from(s.slice('MOCK_DPAPI:'.length), 'base64').toString('utf-8');
    },
  };
}

describe('Security Hardening Regression Suite', () => {
  let env;
  let d1;
  let aliceToken;
  let adminToken;
  let tmpDir;

  beforeEach(async () => {
    ({ env, d1 } = await createTestWorkerEnv({
      env: { ADMIN_EMAILS: 'admin@gamevault.test' },
    }));
    aliceToken = await createTestSessionToken(
      { uid: 'alice_uid', email: 'alice@gamevault.test', displayName: 'Alice' },
      env.SESSION_SECRET
    );
    adminToken = await createTestSessionToken(
      { uid: 'admin_uid', email: 'admin@gamevault.test', displayName: 'Admin' },
      env.SESSION_SECRET
    );
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-sec-'));
  });

  afterEach(() => {
    configureSecureStorage(null);
    configureAuth({ userDataDir: undefined, config: undefined });
    try {
      d1?.sqlite?.close();
    } catch {}
    try {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Worker Cover Endpoints Auth, Overwrite & SSRF Guards', () => {
    test('unauthenticated POST /api/covers/cache returns 401', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/covers/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameKey: '1245620',
            title: 'Elden Ring',
            sourcePosterUrl: 'https://external-art.test/er.png',
          }),
        }),
        env
      );
      assert.equal(res.status, 401);
    });

    test('unauthenticated POST /api/covers/upload returns 401', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/covers/upload?gameKey=1245620&type=poster', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: PNG_1X1,
        }),
        env
      );
      assert.equal(res.status, 401);
    });

    test('non-admin cannot overwrite an existing shared catalog cover via POST /api/covers/upload (403)', async () => {
      // First upload fills the empty slot
      const first = await worker.fetch(
        new Request('http://localhost/api/covers/upload?gameKey=1245620&type=poster&title=Elden+Ring', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(aliceToken) },
          body: PNG_1X1,
        }),
        env
      );
      assert.equal(first.status, 201);

      // Non-admin trying to replace existing cached cover must be rejected
      const second = await worker.fetch(
        new Request('http://localhost/api/covers/upload?gameKey=1245620&type=poster&title=Vandalized', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(aliceToken) },
          body: PNG_1X1,
        }),
        env
      );
      assert.equal(second.status, 403);

      // Admin can still replace it
      const adminRes = await worker.fetch(
        new Request('http://localhost/api/covers/upload?gameKey=1245620&type=poster&title=Elden+Ring', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(adminToken) },
          body: PNG_1X1,
        }),
        env
      );
      assert.equal(adminRes.status, 201);
    });

    test('POST /api/covers/upload rejects unsupported MIME (415) and spoofed non-image bytes (400)', async () => {
      const badMime = await worker.fetch(
        new Request('http://localhost/api/covers/upload?gameKey=test_bad_mime&type=poster', {
          method: 'POST',
          headers: { 'Content-Type': 'text/html', ...authHeader(aliceToken) },
          body: Buffer.from('<script>alert(1)</script>'),
        }),
        env
      );
      assert.equal(badMime.status, 415);

      const spoofedBytes = await worker.fetch(
        new Request('http://localhost/api/covers/upload?gameKey=test_spoof&type=poster', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(aliceToken) },
          body: Buffer.from('not-actually-a-png-file'),
        }),
        env
      );
      assert.equal(spoofedBytes.status, 400);
    });

    test('SSRF guard blocks HTTP, localhost, private IPs, and metadata endpoints', async () => {
      const dangerousUrls = [
        'http://shared.fastly.steamstatic.com/poster.png',
        'https://localhost/admin',
        'https://127.0.0.1/secret.png',
        'https://169.254.169.254/latest/meta-data/',
        'https://10.0.0.1/internal.png',
        'https://192.168.1.1/router.png',
        'https://172.16.0.5/private.png',
        'https://[::1]/loopback.png',
        'https://user:pass@cdn.example.com/a.png',
        'https://cdn.example.com:8443/a.png',
      ];
      for (const badUrl of dangerousUrls) {
        assert.equal(isAllowedExternalImageUrl(badUrl), false, `Must reject ${badUrl}`);
        const res = await worker.fetch(
          new Request('http://localhost/api/covers/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
            body: JSON.stringify({
              gameKey: 'ssrf_test',
              title: 'SSRF Test',
              sourcePosterUrl: badUrl,
            }),
          }),
          env
        );
        assert.equal(res.status, 400, `Cache endpoint must reject SSRF URL ${badUrl}`);
      }
      assert.equal(isAllowedExternalImageUrl('https://shared.fastly.steamstatic.com/app/1/library_600x900.jpg'), true);
    });
  });

  describe('Session Secret & Production Auth Hardening', () => {
    test('rejects leaked placeholder, short, or missing SESSION_SECRET', async () => {
      const badSecrets = [
        '',
        'short',
        'gamevault-session-secret-key-production-32chars-min',
      ];
      for (const bad of badSecrets) {
        assert.equal(isValidSessionSecret(bad), false);
        await assert.rejects(() => createSessionToken({ uid: 'u', email: 'e@t.com' }, bad));
        assert.equal(await verifySessionToken(aliceToken, bad), null);
      }

      const badEnv = { ...env, SESSION_SECRET: 'gamevault-session-secret-key-production-32chars-min' };
      const authRes = await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: 'mock:{"uid":"u1","email":"u1@test.com"}' }),
        }),
        badEnv
      );
      assert.equal(authRes.status, 500);
    });

    test('blocks mock: auth tokens when ENVIRONMENT=production even if ALLOW_MOCK_AUTH=true', async () => {
      const prodEnv = { ...env, ENVIRONMENT: 'production', ALLOW_MOCK_AUTH: 'true' };
      const res = await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: 'mock:{"uid":"attacker","email":"son6232000@gmail.com"}' }),
        }),
        prodEnv
      );
      assert.equal(res.status, 401);
    });
  });

  describe('Local Secret Encryption via safeStorage', () => {
    test('auth-session.json stores encrypted payload on disk with zero plaintext tokens', () => {
      configureSecureStorage(createMockSafeStorage());
      configureAuth({ userDataDir: tmpDir, config: { oauthClientId: 'cid', workerApiUrl: 'http://localhost' } });

      persistSession(
        {
          sessionToken: 'super-secret-jwt-token',
          expiresAt: Date.now() + 3600_000,
          user: { uid: 'u1', email: 'player@example.com', displayName: 'Player', photoUrl: '' },
          google: {
            accessToken: 'google-access-secret',
            refreshToken: 'google-refresh-secret',
            expiresAt: Date.now() + 3600_000,
            scope: 'openid',
            idToken: 'google-id-secret',
          },
          updatedAt: new Date().toISOString(),
        },
        { userDataDir: tmpDir }
      );

      const rawDisk = fs.readFileSync(path.join(tmpDir, 'auth-session.json'), 'utf-8');
      assert.equal(rawDisk.includes('super-secret-jwt-token'), false);
      assert.equal(rawDisk.includes('google-refresh-secret'), false);
      assert.equal(rawDisk.includes('google-access-secret'), false);
      assert.ok(rawDisk.includes('enc:v1:'));

      const loaded = loadSession({ userDataDir: tmpDir });
      assert.equal(loaded.sessionToken, 'super-secret-jwt-token');
      assert.equal(loaded.google.refreshToken, 'google-refresh-secret');
      assert.equal(loaded.google.accessToken, 'google-access-secret');
    });

    test('legacy plaintext auth-session.json migrates automatically to encrypted format on load', () => {
      configureAuth({ userDataDir: tmpDir, config: { oauthClientId: 'cid', workerApiUrl: 'http://localhost' } });
      const legacyFile = path.join(tmpDir, 'auth-session.json');
      fs.writeFileSync(
        legacyFile,
        JSON.stringify({
          sessionToken: 'legacy-jwt',
          expiresAt: Date.now() + 3600_000,
          user: { uid: 'u2', email: 'u2@test.com', displayName: 'U2', photoUrl: '' },
          google: { accessToken: 'lat', refreshToken: 'lrt', expiresAt: 0, scope: '' },
          updatedAt: new Date().toISOString(),
        })
      );

      configureSecureStorage(createMockSafeStorage());
      const loaded = loadSession({ userDataDir: tmpDir });
      assert.equal(loaded.sessionToken, 'legacy-jwt');

      const upgradedDisk = fs.readFileSync(legacyFile, 'utf-8');
      assert.equal(upgradedDisk.includes('legacy-jwt'), false);
      assert.ok(upgradedDisk.includes('enc:v1:'));
    });

    test('settings SQLite encrypts API keys/S3 secrets and maskSettingsSecrets hides googleApiKey', () => {
      configureSecureStorage(createMockSafeStorage());
      const db = new DatabaseSync(':memory:');
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
      `);

      saveAppSettings(
        {
          googleApiKey: 'AIzaSyMyPrivateGoogleKey',
          customS3Config: {
            enabled: true,
            endpoint: 'https://r2.example.com',
            bucket: 'vault',
            accessKeyId: 'AKID',
            secretAccessKey: 'S3_TOP_SECRET_VALUE',
          },
        },
        db
      );

      const rawGoogle = db.prepare("SELECT value FROM app_settings WHERE key = 'google_api_key'").get().value;
      const rawS3 = db.prepare("SELECT value FROM app_settings WHERE key = 'custom_s3_secret_access_key'").get().value;
      assert.ok(isEncryptedSecret(rawGoogle));
      assert.ok(isEncryptedSecret(rawS3));
      assert.equal(rawGoogle.includes('AIzaSy'), false);
      assert.equal(rawS3.includes('S3_TOP_SECRET_VALUE'), false);

      const loaded = loadAppSettings(db);
      assert.equal(loaded.googleApiKey, 'AIzaSyMyPrivateGoogleKey');
      assert.equal(loaded.customS3Config.secretAccessKey, 'S3_TOP_SECRET_VALUE');

      const masked = maskSettingsSecrets(loaded);
      assert.equal(masked.googleApiKey, MASK_SECRET);
      assert.equal(masked.customS3Config.secretAccessKey, MASK_SECRET);

      // Saving masked value must preserve original secret
      saveAppSettings({ googleApiKey: MASK_SECRET }, db);
      assert.equal(loadAppSettings(db).googleApiKey, 'AIzaSyMyPrivateGoogleKey');

      // Secret string helper fail-closed when decryption fails
      assert.equal(decryptSecretString(encryptSecretString('abc')), 'abc');
      configureSecureStorage(null);
      assert.equal(decryptSecretString('enc:v1:deadbeef'), '');
      db.close();
    });
  });
});
