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
  exchangeGoogleIdTokenForSession,
  refreshGoogleTokens,
  refreshGoogleAccessToken,
  loadCloudConfig,
  loadSession,
  persistSession,
  clearSession,
  getValidSessionToken,
  getValidFirebaseToken,
  getValidGoogleAccessToken,
  configureAuth,
  getAuthStatus,
  login,
  logout,
} from '../src/main/auth.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-auth-${prefix}-`));
}

const CONFIG = {
  oauthClientId: 'test-client-id.apps.googleusercontent.com',
  oauthClientSecret: 'test-secret',
  workerApiUrl: 'http://127.0.0.1:8787',
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

describe('Cloud Auth (Google OAuth loopback + Cloudflare Worker Session)', () => {
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

  test('buildAuthUrl: PKCE S256, offline access, drive.appdata and photoslibrary.appendonly scope', () => {
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
    assert.ok(parsed.searchParams.get('scope').includes('photoslibrary.appendonly'));
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

  test('exchangeGoogleIdTokenForSession exchanges google id_token via Worker /api/auth/google', async () => {
    const { impl, calls } = recordingFetch([
      {
        match: '/api/auth/google',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            token: 'worker-session-jwt',
            expiresAt: Date.now() + 7 * 86400 * 1000,
            user: {
              uid: 'uid-worker-1',
              email: 'worker@test.com',
              displayName: 'Worker User',
              photoUrl: 'https://photo/worker',
            },
          }),
        }),
      },
    ]);

    const result = await exchangeGoogleIdTokenForSession(CONFIG, 'jwt-google-id', impl);

    assert.equal(result.token, 'worker-session-jwt');
    assert.equal(result.user.uid, 'uid-worker-1');
    assert.equal(result.user.displayName, 'Worker User');
    assert.ok(calls[0].url.includes('/api/auth/google'));
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.idToken, 'jwt-google-id');
  });

  test('getValidSessionToken: valid token returned as-is; expired token triggers refresh + re-exchange + persist', async () => {
    const userDataDir = newTmp('ud1');
    configureAuth({ config: CONFIG, userDataDir });

    // Fresh, valid session — no network call expected
    persistSession(
      {
        sessionToken: 'worker-token-valid',
        expiresAt: Date.now() + 3600 * 1000,
        user: {
          uid: 'uid-1',
          email: 'a@b.c',
          displayName: 'Nguoi Choi',
          photoUrl: '',
        },
        google: { accessToken: 'g-at', refreshToken: 'g-rt', expiresAt: Date.now() + 3600 * 1000, scope: 'x', idToken: 'g-id-valid' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );

    const token1 = await getValidSessionToken();
    assert.equal(token1, 'worker-token-valid');

    // Backward-compatible alias
    const tokenCompat = await getValidFirebaseToken();
    assert.equal(tokenCompat, 'worker-token-valid');

    // Now expire it — refresh must fire and the session file must be updated
    const session = loadSession({ userDataDir });
    session.expiresAt = Date.now() - 1000;
    persistSession(session, { userDataDir });

    const { impl, calls } = recordingFetch([
      {
        match: 'oauth2.googleapis.com/token',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'g-at-refreshed',
            expires_in: 3600,
            id_token: 'g-id-refreshed',
          }),
        }),
      },
      {
        match: '/api/auth/google',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            token: 'worker-token-refreshed',
            expiresAt: Date.now() + 7 * 86400 * 1000,
            user: {
              uid: 'uid-1',
              email: 'a@b.c',
              displayName: 'Nguoi Choi',
              photoUrl: '',
            },
          }),
        }),
      },
    ]);
    configureAuth({ config: CONFIG, userDataDir, fetchImpl: impl });

    const token2 = await getValidSessionToken();
    assert.equal(token2, 'worker-token-refreshed');
    assert.equal(calls.length, 2);

    const updated = loadSession({ userDataDir });
    assert.equal(updated.sessionToken, 'worker-token-refreshed');
    assert.ok(updated.expiresAt > Date.now());
  });

  test('session persistence roundtrip + getAuthStatus', () => {
    const userDataDir = newTmp('ud2');
    configureAuth({ config: CONFIG, userDataDir });

    assert.equal(getAuthStatus().loggedIn, false);
    assert.equal(getAuthStatus().configPresent, true);

    persistSession(
      {
        sessionToken: 'token-test',
        expiresAt: Date.now() + 1000,
        user: {
          uid: 'uid-9',
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

  test('logout clears the session file and revokes Google access token', async () => {
    const userDataDir = newTmp('ud3');
    const { impl, calls } = recordingFetch([
      { match: 'oauth2.googleapis.com/revoke', response: () => ({ ok: true, status: 200, json: async () => ({}) }) },
    ]);
    configureAuth({ config: CONFIG, userDataDir, fetchImpl: impl });
    persistSession(
      {
        sessionToken: 'session-to-clear',
        expiresAt: Date.now() + 1000,
        user: {
          uid: 'uid-1',
          email: 'a@b.c',
          displayName: 'N',
          photoUrl: '',
        },
        google: { accessToken: 'g-at-revoke', refreshToken: 'g-rt', expiresAt: Date.now() + 1000, scope: 'x' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );

    await logout();
    assert.equal(loadSession({ userDataDir }), null, 'session file removed');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes('revoke'));
  });

  test('refreshGoogleTokens and getValidGoogleAccessToken return fresh token', async () => {
    const userDataDir = newTmp('ud4');
    const { impl, calls } = recordingFetch([
      {
        match: 'oauth2.googleapis.com/token',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'g-at-2', expires_in: 3600, id_token: 'id-tok-2' }),
        }),
      },
    ]);
    configureAuth({ config: CONFIG, userDataDir, fetchImpl: impl });

    const refreshed = await refreshGoogleAccessToken(CONFIG, 'g-rt', impl);
    assert.equal(refreshed.accessToken, 'g-at-2');
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('grant_type'), 'refresh_token');

    // Test getValidGoogleAccessToken auto-refresh
    persistSession(
      {
        sessionToken: 's-tok',
        expiresAt: Date.now() + 100000,
        user: { uid: 'u1', email: 'e', displayName: 'd', photoUrl: '' },
        google: { accessToken: 'expired-at', refreshToken: 'g-rt', expiresAt: Date.now() - 1000, scope: 'x' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );

    const validGoogleAt = await getValidGoogleAccessToken();
    assert.equal(validGoogleAt, 'g-at-2');
  });

  test('loadCloudConfig reads cloud-config.json with workerApiUrl', () => {
    const dir = newTmp('cfg');
    fs.writeFileSync(
      path.join(dir, 'cloud-config.json'),
      JSON.stringify({
        oauthClientId: 'cid',
        oauthClientSecret: 'cs',
        workerApiUrl: 'http://127.0.0.1:8787/',
      })
    );

    configureAuth({ userDataDir: dir });
    const config = loadCloudConfig({
      userDataDir: dir,
    });
    assert.ok(config !== null);
    assert.equal(config.oauthClientId, 'cid');
    assert.equal(config.workerApiUrl, 'http://127.0.0.1:8787');
  });

  test('loopback server: /favicon.ico returns 404 without closing server, subsequent /callback succeeds', async () => {
    const userDataDir = newTmp('login-favicon');
    let capturedAuthUrl = null;

    const { impl } = recordingFetch([
      {
        match: 'oauth2.googleapis.com/token',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'at-fav',
            refresh_token: 'rt-fav',
            expires_in: 3600,
            scope: 'openid email profile',
            id_token: 'jwt-fav-google',
          }),
        }),
      },
      {
        match: '/api/auth/google',
        response: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            token: 'worker-session-fav',
            expiresAt: Date.now() + 7 * 86400 * 1000,
            user: {
              uid: 'uid-fav-1',
              email: 'fav@test.com',
              displayName: 'Favicon Test User',
              photoUrl: 'https://photo/fav',
            },
          }),
        }),
      },
    ]);

    configureAuth({
      config: CONFIG,
      userDataDir,
      fetchImpl: impl,
      openExternal: (url) => {
        capturedAuthUrl = url;
      },
    });

    const loginPromise = login();

    // Wait until openExternal is invoked with the auth URL
    while (!capturedAuthUrl) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const parsedAuthUrl = new URL(capturedAuthUrl);
    const redirectUri = parsedAuthUrl.searchParams.get('redirect_uri');
    assert.ok(redirectUri, 'redirect_uri should be present in authUrl');
    const callbackUrl = new URL(redirectUri);
    const port = callbackUrl.port;
    const state = parsedAuthUrl.searchParams.get('state');
    assert.ok(port, 'loopback server port should be bound');
    assert.ok(state, 'state should be present');

    // 1. Send stray request (/favicon.ico) - must return 404
    const faviconRes = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    assert.equal(faviconRes.status, 404, '/favicon.ico should return 404');

    // Wait 400ms (longer than the 300ms server close delay) to verify server does NOT prematurely close
    await new Promise((r) => setTimeout(r, 400));

    // 2. Legitimate callback request - must return 200 and complete authentication
    const callbackRes = await fetch(`http://127.0.0.1:${port}/callback?code=good-code&state=${state}`);
    assert.equal(callbackRes.status, 200, '/callback should return 200');
    const bodyText = await callbackRes.text();
    assert.ok(bodyText.includes('Đăng nhập thành công'), 'callback response should contain success text');

    // 3. Login promise should resolve with user profile
    const profile = await loginPromise;
    assert.equal(profile.uid, 'uid-fav-1');
    assert.equal(profile.displayName, 'Favicon Test User');

    // 4. After /callback is handled, verify loopback server closes cleanly
    await new Promise((r) => setTimeout(r, 400));
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/favicon.ico`),
      /ECONNREFUSED|fetch failed/,
      'server should close after callback processing'
    );
  });
});
