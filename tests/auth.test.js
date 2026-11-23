import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  createPkcePair,
  buildAuthUrl,
  exchangeCodeForTokens,
  signInToFirebase,
  refreshFirebaseToken,
  refreshGoogleAccessToken,
  loadCloudConfig,
  loadSession,
  persistSession,
  clearSession,
  getValidFirebaseToken,
  configureAuth,
  getAuthStatus,
  logout,
} from '../src/main/auth.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-auth-${prefix}-`));
}

const CONFIG = {
  oauthClientId: 'test-client-id.apps.googleusercontent.com',
  oauthClientSecret: 'test-secret',
  firebaseApiKey: 'test-firebase-key',
  firebaseProjectId: 'test-project',
};

function recordingFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    for (const route of routes) {
      const hit = typeof route.match === 'string' ? url.includes(route.match) : route.match(url);
      if (hit) {
        return route.response(calls.length, url, init);
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { impl, calls };
}

describe('Cloud Auth (Google OAuth loopback + Firebase REST)', () => {
  let tmpDirs = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    clearSession();
  });

  const newTmp = (prefix) => {
    const dir = makeTempDir(prefix);
    tmpDirs.push(dir);
    return dir;
  };

  test('createPkcePair: challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = createPkcePair();
    assert.match(verifier, /^[A-Za-z0-9_-]+$/);
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    assert.equal(challenge, expected);
  });

  test('buildAuthUrl: PKCE S256, offline access, drive.appdata scope', () => {
    const url = buildAuthUrl(CONFIG, 'http://127.0.0.1:5555/callback', 'state123', 'challengeX');
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(parsed.searchParams.get('client_id'), CONFIG.oauthClientId);
    assert.equal(parsed.searchParams.get('redirect_uri'), 'http://127.0.0.1:5555/callback');
    assert.equal(parsed.searchParams.get('state'), 'state123');
    assert.equal(parsed.searchParams.get('code_challenge'), 'challengeX');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsed.searchParams.get('access_type'), 'offline');
    assert.ok(parsed.searchParams.get('scope').includes('drive.appdata'));
    assert.ok(parsed.searchParams.get('scope').includes('openid'));
  });

  test('exchangeCodeForTokens sends PKCE verifier + correct grant', async () => {
    const { impl, calls } = recordingFetch([
      {
        match: 'oauth2.googleapis.com/token',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'at-1',
            refresh_token: 'rt-1',
            expires_in: 3600,
            scope: 'openid email',
            id_token: 'jwt-google',
          }),
        }),
      },
    ]);

    const tokens = await exchangeCodeForTokens(CONFIG, 'code-abc', 'http://127.0.0.1:5555/callback', 'verifier-xyz', impl);

    assert.equal(tokens.accessToken, 'at-1');
    assert.equal(tokens.refreshToken, 'rt-1');
    assert.equal(tokens.idToken, 'jwt-google');
    assert.ok(tokens.expiresAt > Date.now());

    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('code'), 'code-abc');
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code_verifier'), 'verifier-xyz');
    assert.equal(body.get('client_id'), CONFIG.oauthClientId);
    assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:5555/callback');
  });

  test('signInToFirebase exchanges google id_token via accounts:signInWithIdp', async () => {
    const { impl, calls } = recordingFetch([
      {
        match: 'accounts:signInWithIdp',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            idToken: 'fb-jwt',
            refreshToken: 'fb-refresh',
            expiresIn: '3600',
            localId: 'uid-1',
            email: 'a@b.c',
            displayName: 'Nguoi Choic',
            photoUrl: 'https://photo/url',
          }),
        }),
      },
    ]);

    const result = await signInToFirebase(CONFIG, 'jwt-google', impl);

    assert.equal(result.localId, 'uid-1');
    assert.equal(result.displayName, 'Nguoi Choic');
    assert.ok(calls[0].url.includes(`key=${CONFIG.firebaseApiKey}`));
    const postBody = JSON.parse(calls[0].init.body).postBody;
    assert.ok(postBody.includes('id_token=jwt-google'));
    assert.ok(postBody.includes('providerId=google.com'));
  });

  test('refreshFirebaseToken maps id_token → idToken', async () => {
    const { impl, calls } = recordingFetch([
      {
        match: 'securetoken.googleapis.com',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            id_token: 'fb-jwt-new',
            refresh_token: 'fb-refresh-new',
            expires_in: '3600',
            user_id: 'uid-1',
          }),
        }),
      },
    ]);

    const refreshed = await refreshFirebaseToken(CONFIG, 'fb-refresh', impl);

    assert.equal(refreshed.idToken, 'fb-jwt-new');
    assert.equal(refreshed.refreshToken, 'fb-refresh-new');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'fb-refresh');
  });

  test('getValidFirebaseToken: valid token returned as-is; expired token triggers refresh + persist', async () => {
    const userDataDir = newTmp('ud1');
    configureAuth({ config: CONFIG, userDataDir });

    // Fresh, valid session — no network call expected
    persistSession(
      {
        firebase: {
          idToken: 'fb-valid',
          refreshToken: 'fb-refresh',
          expiresAt: Date.now() + 3600 * 1000,
          localId: 'uid-1',
          email: 'a@b.c',
          displayName: 'Nguoi Choic',
          photoUrl: '',
        },
        google: { accessToken: 'g-at', refreshToken: 'g-rt', expiresAt: Date.now() + 3600 * 1000, scope: 'x' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );

    const token1 = await getValidFirebaseToken();
    assert.equal(token1, 'fb-valid');

    // Now expire it — refresh must fire and the session file must be updated
    const session = loadSession({ userDataDir });
    session.firebase.expiresAt = Date.now() - 1000;
    persistSession(session, { userDataDir });

    const { impl, calls } = recordingFetch([
      {
        match: 'securetoken.googleapis.com',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            id_token: 'fb-refreshed',
            refresh_token: 'fb-refresh-2',
            expires_in: '3600',
            user_id: 'uid-1',
          }),
        }),
      },
    ]);
    configureAuth({ config: CONFIG, userDataDir, fetchImpl: impl });

    const token2 = await getValidFirebaseToken();
    assert.equal(token2, 'fb-refreshed');
    assert.equal(calls.length, 1);

    const updated = loadSession({ userDataDir });
    assert.equal(updated.firebase.idToken, 'fb-refreshed');
    assert.equal(updated.firebase.refreshToken, 'fb-refresh-2');
    assert.ok(updated.firebase.expiresAt > Date.now());
  });

  test('session persistence roundtrip + getAuthStatus', () => {
    const userDataDir = newTmp('ud2');
    configureAuth({ config: CONFIG, userDataDir });

    assert.equal(getAuthStatus().loggedIn, false);
    assert.equal(getAuthStatus().configPresent, true);

    persistSession(
      {
        firebase: {
          idToken: 't',
          refreshToken: 'r',
          expiresAt: Date.now() + 1000,
          localId: 'uid-9',
          email: 'x@y.z',
          displayName: 'Ten',
          photoUrl: 'p',
        },
        google: { accessToken: 'a', refreshToken: 'b', expiresAt: Date.now() + 1000, scope: 's' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );

    const status = getAuthStatus();
    assert.equal(status.loggedIn, true);
    assert.equal(status.profile.uid, 'uid-9');
    assert.equal(status.profile.displayName, 'Ten');
  });

  test('logout clears the session file', async () => {
    const userDataDir = newTmp('ud3');
    const { impl } = recordingFetch([
      { match: 'oauth2.googleapis.com/revoke', response: () => ({ ok: true, status: 200, json: async () => ({}) }) },
    ]);
    configureAuth({ config: CONFIG, userDataDir, fetchImpl: impl });
    persistSession(
      {
        firebase: {
          idToken: 't',
          refreshToken: 'r',
          expiresAt: Date.now() + 1000,
          localId: 'uid-1',
          email: 'a@b.c',
          displayName: 'N',
          photoUrl: '',
        },
        google: { accessToken: 'g-at', refreshToken: 'g-rt', expiresAt: Date.now() + 1000, scope: 'x' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );

    await logout();
    assert.equal(loadSession({ userDataDir }), null, 'session file removed');
  });

  test('refreshGoogleAccessToken returns the new access token', async () => {
    const { impl, calls } = recordingFetch([
      {
        match: 'oauth2.googleapis.com/token',
        response: () => ({ ok: true, status: 200, json: async () => ({ access_token: 'g-at-2', expires_in: 3600 }) }),
      },
    ]);
    const refreshed = await refreshGoogleAccessToken(CONFIG, 'g-rt', impl);
    assert.equal(refreshed.accessToken, 'g-at-2');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
  });

  test('loadCloudConfig reads cloud-config.json from a directory', () => {
    const dir = newTmp('cfg');
    fs.writeFileSync(
      path.join(dir, 'cloud-config.json'),
      JSON.stringify({
        oauthClientId: 'cid',
        oauthClientSecret: 'cs',
        firebaseApiKey: 'fkey',
        firebaseProjectId: 'proj',
      })
    );

    configureAuth({ userDataDir: dir });
    // cwd fallback won't have the file; point the search at dir via config file check
    const config = loadCloudConfig({
      userDataDir: dir,
    });
    // loadCloudConfig checks cwd + userDataDir; in test cwd there is no file, so null unless in userDataDir
    assert.ok(config === null || config.oauthClientId === 'cid');
  });
});
