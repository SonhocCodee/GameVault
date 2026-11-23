import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  loadAppSettings,
  saveAppSettings,
  maskSettingsSecrets,
  testStorageConnection,
  createMockS3Server,
  createMockGooglePhotosServer,
  MASK_SECRET,
} from './test-helpers-storage.js';

const SETTINGS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`;

describe('Storage Settings & Credential Persistence Test Suite', () => {
  let db;
  let s3Mock;
  let gphotosMock;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(SETTINGS_SCHEMA_SQL);

    s3Mock = createMockS3Server({
      expectedBucket: 'my-vault-bucket',
      expectedAccessKeyId: 'ACCESS_KEY_VALID',
    });
    gphotosMock = createMockGooglePhotosServer();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // Ignore if already closed
    }
  });

  // ==========================================================================
  // Tier 1 — Feature Coverage (Isolated Happy Path)
  // ==========================================================================
  describe('Tier 1: Feature Coverage', () => {
    test('T1-SET-01: Default storage settings on fresh database', () => {
      const s = loadAppSettings(db);
      assert.equal(s.imageStorageProvider, 'cloudflare_r2');
      assert.equal(s.customS3Config.enabled, false);
      assert.equal(s.customS3Config.endpoint, '');
      assert.equal(s.customS3Config.bucket, '');
      assert.equal(s.customS3Config.accessKeyId, '');
      assert.equal(s.customS3Config.secretAccessKey, '');
      assert.equal(s.customS3Config.region, 'auto');
      assert.equal(s.customS3Config.publicUrlBase, '');
      assert.equal(s.googlePhotosAlbumId, '');
    });

    test('T1-SET-02: Persist provider selection', () => {
      saveAppSettings({ imageStorageProvider: 'google_photos' }, db);
      const s = loadAppSettings(db);
      assert.equal(s.imageStorageProvider, 'google_photos');

      // Switch back
      saveAppSettings({ imageStorageProvider: 'cloudflare_r2' }, db);
      const s2 = loadAppSettings(db);
      assert.equal(s2.imageStorageProvider, 'cloudflare_r2');
    });

    test('T1-SET-03: Persist custom S3 config', () => {
      saveAppSettings({
        customS3Config: {
          enabled: true,
          endpoint: 'https://xxx.r2.cloudflarestorage.com',
          bucket: 'game-covers',
          accessKeyId: 'KEY_123',
          secretAccessKey: 'SECRET_999',
          region: 'auto',
          publicUrlBase: 'https://cdn.example.com',
        },
      }, db);

      const s = loadAppSettings(db);
      assert.equal(s.customS3Config.enabled, true);
      assert.equal(s.customS3Config.endpoint, 'https://xxx.r2.cloudflarestorage.com');
      assert.equal(s.customS3Config.bucket, 'game-covers');
      assert.equal(s.customS3Config.accessKeyId, 'KEY_123');
      assert.equal(s.customS3Config.secretAccessKey, 'SECRET_999');
      assert.equal(s.customS3Config.region, 'auto');
      assert.equal(s.customS3Config.publicUrlBase, 'https://cdn.example.com');
    });

    test('T1-SET-04: Persist Google Photos album ID', () => {
      saveAppSettings({ googlePhotosAlbumId: 'album_xyz_987' }, db);
      const s = loadAppSettings(db);
      assert.equal(s.googlePhotosAlbumId, 'album_xyz_987');
    });

    test('T1-SET-05: Credential masking for UI', () => {
      saveAppSettings({
        customS3Config: {
          enabled: true,
          accessKeyId: 'MY_KEY',
          secretAccessKey: 'SUPER_CONFIDENTIAL_SECRET',
        },
      }, db);

      const raw = loadAppSettings(db);
      assert.equal(raw.customS3Config.secretAccessKey, 'SUPER_CONFIDENTIAL_SECRET');

      const masked = maskSettingsSecrets(raw);
      assert.equal(masked.customS3Config.secretAccessKey, MASK_SECRET);
      assert.equal(masked.customS3Config.hasSecretKey, true);
    });

    test('T1-SET-06: S3 connection test success', async () => {
      const settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'my-vault-bucket',
          accessKeyId: 'ACCESS_KEY_VALID',
          secretAccessKey: 'SECRET_VALID',
        },
      };

      const result = await testStorageConnection(settings, s3Mock.fetch);
      assert.equal(result.ok, true);
    });

    test('T1-SET-07: Google Photos connection test success', async () => {
      const settings = {
        imageStorageProvider: 'google_photos',
      };

      const result = await testStorageConnection(settings, gphotosMock.fetch, 'valid_token');
      assert.equal(result.ok, true);
    });
  });

  // ==========================================================================
  // Tier 2 — Boundary & Corner Cases
  // ==========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    test('T2-SET-01: Mask preservation on update — saving MASK_SECRET NEVER overwrites stored secret', () => {
      saveAppSettings({
        customS3Config: {
          enabled: true,
          secretAccessKey: 'ORIGINAL_TRUE_SECRET',
        },
      }, db);

      // UI returns settings with masked secret
      saveAppSettings({
        customS3Config: {
          secretAccessKey: MASK_SECRET,
        },
      }, db);

      const reloaded = loadAppSettings(db);
      assert.equal(reloaded.customS3Config.secretAccessKey, 'ORIGINAL_TRUE_SECRET');
    });

    test('T2-SET-02: Empty secret preservation when secret exists in database', () => {
      saveAppSettings({
        customS3Config: {
          secretAccessKey: 'EXISTING_SECRET',
        },
      }, db);

      // User submits form without touching secret field (empty string)
      saveAppSettings({
        customS3Config: {
          bucket: 'new-bucket',
          secretAccessKey: '',
        },
      }, db);

      const reloaded = loadAppSettings(db);
      assert.equal(reloaded.customS3Config.bucket, 'new-bucket');
      assert.equal(reloaded.customS3Config.secretAccessKey, 'EXISTING_SECRET');
    });

    test('T2-SET-03: Secret key replacement with new cleartext secret string', () => {
      saveAppSettings({
        customS3Config: {
          secretAccessKey: 'OLD_SECRET',
        },
      }, db);

      saveAppSettings({
        customS3Config: {
          secretAccessKey: 'NEW_ROTATED_SECRET',
        },
      }, db);

      const reloaded = loadAppSettings(db);
      assert.equal(reloaded.customS3Config.secretAccessKey, 'NEW_ROTATED_SECRET');
    });

    test('T2-SET-04: Whitespace trimming on string fields', () => {
      saveAppSettings({
        customS3Config: {
          endpoint: '  https://s3.custom.com/  ',
          bucket: '  my-bucket  ',
          accessKeyId: '  KEY_SPACES  ',
          region: '  us-east-1  ',
          publicUrlBase: '  https://cdn.custom.com/  ',
        },
      }, db);

      const reloaded = loadAppSettings(db);
      assert.equal(reloaded.customS3Config.endpoint, 'https://s3.custom.com/');
      assert.equal(reloaded.customS3Config.bucket, 'my-bucket');
      assert.equal(reloaded.customS3Config.accessKeyId, 'KEY_SPACES');
      assert.equal(reloaded.customS3Config.region, 'us-east-1');
      assert.equal(reloaded.customS3Config.publicUrlBase, 'https://cdn.custom.com/');
    });

    test('T2-SET-05: Invalid provider fallback to cloudflare_r2', () => {
      saveAppSettings({ imageStorageProvider: 'unsupported_provider_xyz' }, db);
      const reloaded = loadAppSettings(db);
      assert.equal(reloaded.imageStorageProvider, 'cloudflare_r2');
    });

    test('T2-SET-06: S3 probe rejection with bad credentials', async () => {
      const settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'my-vault-bucket',
          accessKeyId: 'BAD_KEY',
          secretAccessKey: 'BAD_SECRET',
        },
      };

      const result = await testStorageConnection(settings, s3Mock.fetch);
      assert.equal(result.ok, false);
      assert.match(result.error, /HTTP 403/);
    });

    test('T2-SET-07: S3 probe rejection with non-existent bucket', async () => {
      const settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'non-existent-bucket',
          accessKeyId: 'ACCESS_KEY_VALID',
          secretAccessKey: 'SECRET_VALID',
        },
      };

      const result = await testStorageConnection(settings, s3Mock.fetch);
      assert.equal(result.ok, false);
      assert.match(result.error, /HTTP 404/);
    });

    test('T2-SET-08: Unreachable endpoint network error', async () => {
      const offlineMock = createMockS3Server({ simulateNetworkError: true });
      const settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://dead-host.invalid',
          bucket: 'b',
          accessKeyId: 'k',
          secretAccessKey: 's',
        },
      };

      const result = await testStorageConnection(settings, offlineMock.fetch);
      assert.equal(result.ok, false);
      assert.match(result.error, /network offline/);
    });

    test('T2-SET-09: Corrupt database row recovery (safe defaults)', () => {
      // Inject unexpected non-boolean or corrupt values
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('custom_s3_enabled', 'not-a-bool')").run();
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('image_storage_provider', 'invalid')").run();

      const s = loadAppSettings(db);
      assert.equal(s.customS3Config.enabled, false);
      assert.equal(s.imageStorageProvider, 'cloudflare_r2');
    });

    test('T2-SET-10: Partial patch isolation', () => {
      saveAppSettings({
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.initial.com',
          bucket: 'initial-bucket',
          accessKeyId: 'INITIAL_KEY',
          secretAccessKey: 'INITIAL_SECRET',
        },
      }, db);

      // Update only bucket name
      saveAppSettings({
        customS3Config: {
          bucket: 'changed-bucket',
        },
      }, db);

      const reloaded = loadAppSettings(db);
      assert.equal(reloaded.customS3Config.bucket, 'changed-bucket');
      assert.equal(reloaded.customS3Config.endpoint, 'https://s3.initial.com');
      assert.equal(reloaded.customS3Config.accessKeyId, 'INITIAL_KEY');
      assert.equal(reloaded.customS3Config.secretAccessKey, 'INITIAL_SECRET');
    });
  });

  // ==========================================================================
  // Tier 3 — Cross-Feature Combinations
  // ==========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    test('T3-SET-01: Save + Masking Round-Trip with Connection Test', async () => {
      // 1. Initial save with real valid credentials
      saveAppSettings({
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'my-vault-bucket',
          accessKeyId: 'ACCESS_KEY_VALID',
          secretAccessKey: 'REAL_SECRET_PASS',
        },
      }, db);

      // 2. UI receives masked settings
      const raw = loadAppSettings(db);
      const uiVersion = maskSettingsSecrets(raw);
      assert.equal(uiVersion.customS3Config.secretAccessKey, MASK_SECRET);
      assert.equal(uiVersion.customS3Config.hasSecretKey, true);

      // 3. User modifies region in UI and sends back the masked object
      uiVersion.customS3Config.region = 'auto';
      saveAppSettings({ customS3Config: uiVersion.customS3Config }, db);

      // 4. Test connection using updated settings from DB
      const verified = loadAppSettings(db);
      assert.equal(verified.customS3Config.secretAccessKey, 'REAL_SECRET_PASS'); // Unaltered!

      const probe = await testStorageConnection(verified, s3Mock.fetch);
      assert.equal(probe.ok, true);
    });

    test('T3-SET-02: Provider Switch + Connection Test Target', async () => {
      // In Google Photos mode without token -> fails with auth notice
      const gphotoSettings = { imageStorageProvider: 'google_photos' };
      const gphotoRes = await testStorageConnection(gphotoSettings, gphotosMock.fetch, null);
      assert.equal(gphotoRes.ok, false);
      assert.match(gphotoRes.error, /Chưa đăng nhập/);

      // Switch to Custom S3 mode with valid config -> probes S3 instead
      const s3Settings = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'my-vault-bucket',
          accessKeyId: 'ACCESS_KEY_VALID',
          secretAccessKey: 'VALID_SECRET',
        },
      };

      const s3Res = await testStorageConnection(s3Settings, s3Mock.fetch);
      assert.equal(s3Res.ok, true);
    });
  });

  // ==========================================================================
  // Tier 4 — Real-World Scenarios
  // ==========================================================================
  describe('Tier 4: Real-World Scenarios', () => {
    test('T4-SET-01: Power User Custom S3 Setup', async () => {
      // 1. User configures personal Cloudflare R2 / MinIO storage
      const input = {
        imageStorageProvider: 'cloudflare_r2',
        customS3Config: {
          enabled: true,
          endpoint: 'https://my-account.r2.cloudflarestorage.com',
          bucket: 'my-vault-bucket',
          accessKeyId: 'ACCESS_KEY_VALID',
          secretAccessKey: 'MY_SECRET_KEY_12345',
          region: 'auto',
          publicUrlBase: 'https://cdn.myvault.app',
        },
      };

      // 2. User clicks "Test Connection" in settings dialog -> probe passes
      const probeRes = await testStorageConnection(input, s3Mock.fetch);
      assert.equal(probeRes.ok, true);

      // 3. User clicks "Save" -> settings stored in SQLite
      saveAppSettings(input, db);

      // 4. Verification: stored correctly, masked when queried for UI
      const stored = loadAppSettings(db);
      assert.equal(stored.customS3Config.endpoint, 'https://my-account.r2.cloudflarestorage.com');
      assert.equal(stored.customS3Config.secretAccessKey, 'MY_SECRET_KEY_12345');

      const uiSettings = maskSettingsSecrets(stored);
      assert.equal(uiSettings.customS3Config.secretAccessKey, MASK_SECRET);
      assert.equal(uiSettings.customS3Config.hasSecretKey, true);
    });

    test('T4-SET-02: Credential Key Rotation', async () => {
      // 1. Existing configuration
      saveAppSettings({
        customS3Config: {
          enabled: true,
          endpoint: 'https://s3.example.com',
          bucket: 'my-vault-bucket',
          accessKeyId: 'ACCESS_KEY_VALID',
          secretAccessKey: 'OLD_KEY_VALUE',
        },
      }, db);

      // 2. User types a newly rotated secret key into SettingsModal
      saveAppSettings({
        customS3Config: {
          secretAccessKey: 'NEW_ROTATED_KEY_VAL_999',
        },
      }, db);

      // 3. Verify database has the rotated key
      const updated = loadAppSettings(db);
      assert.equal(updated.customS3Config.secretAccessKey, 'NEW_ROTATED_KEY_VAL_999');

      // 4. Verify connection still succeeds
      const probe = await testStorageConnection(updated, s3Mock.fetch);
      assert.equal(probe.ok, true);
    });
  });
});
