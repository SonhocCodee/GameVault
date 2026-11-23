import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import electronModule from 'electron';
import type { AuthStatus, CloudConfig, UserProfile } from '../shared/types.js';

// Electron runtime helpers (shell.openExternal for the system browser); safe
// fallbacks keep the module importable under plain node test runs.
const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;

const SESSION_FILE = 'auth-session.json';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_SLACK_MS = 60 * 1000;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const FIREBASE_IDP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const FIREBASE_REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';

const OAUTH_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';

export type FetchLike = (url: string, init?: any) => Promise<any>;

function defaultFetch(): FetchLike {
  const netFetch = electron?.net?.fetch;
  if (typeof netFetch === 'function') {
    return netFetch.bind(electron.net);
  }
  return fetch;
}

function openExternal(url: string): void {
  const shell = electron?.shell;
  if (shell && typeof shell.openExternal === 'function') {
    shell.openExternal(url).catch(() => {});
    return;
  }
  // Non-Electron (tests) — the injected openExternal handles this
}

function getUserDataDir(options?: AuthOptions): string {
  if (options?.userDataDir) return options.userDataDir;
  try {
    const app = electron?.app;
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // not inside Electron
  }
  return process.cwd();
}

// ==========================================
// Config (cloud-config.json, bundled with the app)
// ==========================================

export function loadCloudConfig(options: AuthOptions = {}): CloudConfig | null {
  if (options.config) {
    return options.config;
  }
  const candidates = [
    // Bundled with the app (repo root / packaged resources)
    path.resolve(process.cwd(), 'cloud-config.json'),
    path.resolve(getUserDataDir(options), 'cloud-config.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (parsed?.oauthClientId && parsed?.oauthClientSecret && parsed?.firebaseApiKey) {
        return {
          oauthClientId: String(parsed.oauthClientId),
          oauthClientSecret: String(parsed.oauthClientSecret),
          firebaseApiKey: String(parsed.firebaseApiKey),
          firebaseProjectId: String(parsed.firebaseProjectId || ''),
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ==========================================
// Session persistence (atomic write, covers.ts convention)
// ==========================================

export interface AuthSession {
  firebase: {
    idToken: string;
    refreshToken: string;
    expiresAt: number;
    localId: string;
    email: string;
    displayName: string;
    photoUrl: string;
  };
  google: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scope: string;
  };
  updatedAt: string;
}

function sessionPath(options?: AuthOptions): string {
  return path.join(getUserDataDir(options), SESSION_FILE);
}

export function loadSession(options?: AuthOptions): AuthSession | null {
  try {
    const file = sessionPath(options);
    if (!fs.existsSync(file)) return null;
    const session = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!session?.firebase?.refreshToken || !session?.firebase?.localId) return null;
    return session as AuthSession;
  } catch {
    return null;
  }
}

export function persistSession(session: AuthSession, options?: AuthOptions): void {
  const file = sessionPath(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

export function clearSession(options?: AuthOptions): void {
  try {
    fs.rmSync(sessionPath(options), { force: true });
  } catch {
    // best effort
  }
}

// ==========================================
// PKCE + URL building
// ==========================================

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthUrl(config: CloudConfig, redirectUri: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: config.oauthClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // force a refresh_token so Drive later works forever
    prompt: 'consent',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ==========================================
// Token exchange (pure HTTP — easily mockable)
// ==========================================

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  idToken: string;
}

export async function exchangeCodeForTokens(
  config: CloudConfig,
  code: string,
  redirectUri: string,
  verifier: string,
  fetchImpl: FetchLike = defaultFetch()
): Promise<GoogleTokens> {
  const resp = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }).toString(),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.access_token) {
    throw new Error(`Google token exchange failed: ${data?.error_description || data?.error || resp.status}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    scope: data.scope || '',
    idToken: data.id_token || '',
  };
}

export interface FirebaseSignInResult {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  localId: string;
  email: string;
  displayName: string;
  photoUrl: string;
}

export async function signInToFirebase(
  config: CloudConfig,
  googleIdToken: string,
  fetchImpl: FetchLike = defaultFetch()
): Promise<FirebaseSignInResult> {
  const resp = await fetchImpl(`${FIREBASE_IDP_URL}?key=${config.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.idToken) {
    throw new Error(`Firebase sign-in failed: ${data?.error?.message || resp.status}`);
  }
  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    localId: data.localId,
    email: data.email || '',
    displayName: data.displayName || '',
    photoUrl: data.photoUrl || '',
  };
}

export async function refreshFirebaseToken(
  config: CloudConfig,
  refreshToken: string,
  fetchImpl: FetchLike = defaultFetch()
): Promise<{ idToken: string; refreshToken: string; expiresAt: number; localId: string }> {
  const resp = await fetchImpl(`${FIREBASE_REFRESH_URL}?key=${config.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.id_token) {
    throw new Error(`Firebase refresh failed: ${data?.error?.message || resp.status}`);
  }
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    localId: data.user_id,
  };
}

export async function refreshGoogleAccessToken(
  config: CloudConfig,
  refreshToken: string,
  fetchImpl: FetchLike = defaultFetch()
): Promise<{ accessToken: string; expiresAt: number }> {
  const resp = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
    }).toString(),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.access_token) {
    throw new Error(`Google refresh failed: ${data?.error_description || data?.error || resp.status}`);
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
}

// ==========================================
// Public API
// ==========================================

export interface AuthOptions {
  config?: CloudConfig;
  userDataDir?: string;
  fetchImpl?: FetchLike;
  openExternal?: (url: string) => void;
}

let authOptions: AuthOptions = {};

export function configureAuth(options: AuthOptions): void {
  authOptions = { ...authOptions, ...options };
}

function getFetch(): FetchLike {
  return authOptions.fetchImpl || defaultFetch();
}

function requireConfig(): CloudConfig {
  const config = authOptions.config || loadCloudConfig(authOptions);
  if (!config) {
    throw new Error(
      'Chưa cấu hình cloud-config.json (oauthClientId, oauthClientSecret, firebaseApiKey). Xem SETUP.md.'
    );
  }
  return config;
}

/** Shared config accessor for sibling cloud modules (cloud-db, drive). */
export function getCloudConfig(): CloudConfig | null {
  return authOptions.config || loadCloudConfig(authOptions);
}

/** Current session honoring the configured auth options (for sibling modules). */
export function getCurrentSession(): AuthSession | null {
  return loadSession(authOptions);
}

export function getAuthStatus(): AuthStatus {
  const session = loadSession(authOptions);
  const config = authOptions.config || loadCloudConfig(authOptions);
  return {
    loggedIn: session !== null,
    profile: session
      ? {
          uid: session.firebase.localId,
          email: session.firebase.email,
          displayName: session.firebase.displayName || session.firebase.email,
          photoUrl: session.firebase.photoUrl,
        }
      : null,
    configPresent: config !== null,
  };
}

/**
 * Full browser login: loopback HTTP server + system browser (PKCE). Resolves
 * with the signed-in profile once Google redirects back.
 */
export async function login(): Promise<UserProfile> {
  const config = requireConfig();
  if (loadSession(authOptions)) {
    const status = getAuthStatus();
    if (status.profile) return status.profile; // already signed in
  }

  const fetchImpl = getFetch();
  const verifierPair = createPkcePair();
  const state = crypto.randomBytes(16).toString('base64url');

  const codeResult = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get('error');
        const returnedState = url.searchParams.get('state');
        const returnedCode = url.searchParams.get('code');
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Đăng nhập bị hủy</h1><p>Bạn có thể đóng tab này.</p>');
          reject(new Error(`Google trả về lỗi: ${error}`));
          return;
        }
        if (!returnedCode || returnedState !== state) {
          res.writeHead(400).end('Bad state');
          reject(new Error('OAuth state không khớp (có thể do retry/CSRF)'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<h1>Đăng nhập thành công ✓</h1><p>Quay lại GameVault — bạn có thể đóng tab này.</p>'
        );
        const redirectUri = `http://127.0.0.1:${(server.address() as any)?.port}/callback`;
        resolve({ code: returnedCode, redirectUri });
      } catch (err) {
        reject(err as Error);
      } finally {
        // Give the browser a beat to receive the response before closing
        setTimeout(() => server.close(), 300);
      }
    });

    server.on('error', (err) => reject(new Error(`Không mở được server loopback: ${err.message}`)));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Loopback server không nhận được port'));
        return;
      }
      const redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const authUrl = buildAuthUrl(config, redirectUri, state, verifierPair.challenge);
      if (authOptions.openExternal) {
        authOptions.openExternal(authUrl);
      } else {
        openExternal(authUrl);
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Hết thời gian chờ đăng nhập (5 phút)'));
    }, LOGIN_TIMEOUT_MS);
    timer.unref?.();
  });

  const tokens = await exchangeCodeForTokens(
    config,
    codeResult.code,
    codeResult.redirectUri,
    verifierPair.verifier,
    fetchImpl
  );

  const firebase = await signInToFirebase(config, tokens.idToken, fetchImpl);
  const session: AuthSession = {
    firebase,
    google: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    },
    updatedAt: new Date().toISOString(),
  };
  persistSession(session, authOptions);
  return {
    uid: firebase.localId,
    email: firebase.email,
    displayName: firebase.displayName || firebase.email,
    photoUrl: firebase.photoUrl,
  };
}

/**
 * Returns a Firebase ID token that is guaranteed valid for the next minute,
 * refreshing it through Google's securetoken endpoint when needed.
 */
export async function getValidFirebaseToken(): Promise<string> {
  const config = requireConfig();
  const session = loadSession(authOptions);
  if (!session) {
    throw new Error('Chưa đăng nhập');
  }
  if (session.firebase.expiresAt - TOKEN_EXPIRY_SLACK_MS > Date.now()) {
    return session.firebase.idToken;
  }
  const fetchImpl = getFetch();
  const refreshed = await refreshFirebaseToken(config, session.firebase.refreshToken, fetchImpl);
  const updated: AuthSession = {
    ...session,
    firebase: {
      ...session.firebase,
      idToken: refreshed.idToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      localId: refreshed.localId || session.firebase.localId,
    },
    updatedAt: new Date().toISOString(),
  };
  persistSession(updated, authOptions);
  return updated.firebase.idToken;
}

/** Google access token for Drive API calls (Phase 4), refreshed on demand. */
export async function getValidGoogleAccessToken(): Promise<string> {
  const config = requireConfig();
  const session = loadSession(authOptions);
  if (!session) {
    throw new Error('Chưa đăng nhập');
  }
  if (session.google.expiresAt - TOKEN_EXPIRY_SLACK_MS > Date.now() && session.google.accessToken) {
    return session.google.accessToken;
  }
  if (!session.google.refreshToken) {
    throw new Error('Không có Google refresh token — đăng nhập lại để cấp quyền Drive');
  }
  const fetchImpl = getFetch();
  const refreshed = await refreshGoogleAccessToken(config, session.google.refreshToken, fetchImpl);
  const updated: AuthSession = {
    ...session,
    google: { ...session.google, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt },
    updatedAt: new Date().toISOString(),
  };
  persistSession(updated, authOptions);
  return updated.google.accessToken;
}

export async function logout(): Promise<void> {
  const session = loadSession(authOptions);
  if (session?.google.accessToken) {
    try {
      await getFetch()(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: session.google.accessToken }).toString(),
      });
    } catch {
      // revoke is best-effort
    }
  }
  clearSession(authOptions);
}
