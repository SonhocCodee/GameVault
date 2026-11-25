import type { Env, AuthUser, UserProfile } from './types.ts';
import { jsonResponse, errorResponse } from './utils.ts';

export interface SessionPayload {
  uid: string;
  email: string;
  displayName?: string;
  iat: number;
  exp: number;
}

export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64url'));
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function getHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createSessionToken(
  payload: Omit<SessionPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number = 7 * 86400
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const fullPayload: SessionPayload = {
    ...payload,
    iat: now,
    exp,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const encodedSignature = base64UrlEncode(signature);

  return {
    token: `${encodedHeader}.${encodedPayload}.${encodedSignature}`,
    expiresAt: exp * 1000,
  };
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  try {
    const key = await getHmacKey(secret);
    const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const signature = base64UrlDecode(encodedSignature);

    const isValid = await crypto.subtle.verify('HMAC', key, signature, data);
    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(payloadJson) as SessionPayload;

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return null; // Expired token
    }

    if (!payload.uid) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function authenticate(request: Request, env: Env): Promise<AuthUser | null> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  const payload = await verifySessionToken(token, env.SESSION_SECRET);
  if (!payload) return null;

  return {
    uid: payload.uid,
    email: payload.email,
    displayName: payload.displayName || payload.email,
  };
}

export function isAdminUser(user: AuthUser | null, env?: Env): boolean {
  if (!user || !user.email) return false;
  const configured = env?.ADMIN_EMAILS
    ? env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase())
    : [];
  const allowed = new Set(['son6232000@gmail.com', ...configured]);
  return allowed.has(user.email.toLowerCase().trim());
}

export async function verifyGoogleIdToken(
  idToken: string,
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<{ uid: string; email: string; displayName: string; photoUrl: string } | null> {
  if (!idToken || typeof idToken !== 'string') return null;

  // Mock support for automated testing without internet connection
  if (env.ALLOW_MOCK_AUTH === 'true' && idToken.startsWith('mock:')) {
    const jsonStr = idToken.slice(5);
    try {
      const parsed = JSON.parse(jsonStr);
      return {
        uid: String(parsed.uid || 'mock-user'),
        email: String(parsed.email || 'mock@example.com'),
        displayName: String(parsed.displayName || 'Mock User'),
        photoUrl: String(parsed.photoUrl || ''),
      };
    } catch {
      const parts = idToken.split(':');
      return {
        uid: parts[1] || 'mock-user',
        email: parts[2] || 'mock@example.com',
        displayName: parts[3] || 'Mock User',
        photoUrl: parts.slice(4).join(':') || '',
      };
    }
  }

  const endpoint =
    (env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo') +
    `?id_token=${encodeURIComponent(idToken)}`;

  try {
    const resp = await fetchImpl(endpoint);
    if (!resp.ok) return null;

    const data = (await resp.json()) as Record<string, any>;
    if (!data || !data.sub) return null;

    const allowedClientIds = [env.GOOGLE_CLIENT_ID, env.WEB_GOOGLE_CLIENT_ID]
      .filter((v): v is string => Boolean(v && v.trim()))
      .flatMap((v) => v.split(',').map((s) => s.trim()))
      .filter(Boolean);

    if (allowedClientIds.length > 0 && !allowedClientIds.includes(String(data.aud || ''))) {
      return null;
    }

    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (data.iss && !validIssuers.includes(data.iss)) {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (data.exp && Number(data.exp) < nowSec) {
      return null;
    }

    return {
      uid: String(data.sub),
      email: String(data.email || ''),
      displayName: String(data.name || data.email || ''),
      photoUrl: String(data.picture || ''),
    };
  } catch {
    return null;
  }
}

export async function handleGoogleAuth(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { idToken } = body || {};
  if (!idToken || typeof idToken !== 'string') {
    return errorResponse('Missing idToken in request body', 400);
  }

  const googleUser = await verifyGoogleIdToken(idToken, env);
  if (!googleUser) {
    return errorResponse('Invalid or expired Google ID token', 401);
  }

  // Upsert user into D1
  await env.DB.prepare(
    `INSERT INTO users (uid, email, display_name, photo_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(uid) DO UPDATE SET
       email = excluded.email,
       display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE users.display_name END,
       photo_url = COALESCE(excluded.photo_url, users.photo_url),
       updated_at = datetime('now')`
  )
    .bind(googleUser.uid, googleUser.email, googleUser.displayName, googleUser.photoUrl)
    .run();

  // Retrieve user record with hardware info
  const userRow = await env.DB.prepare(
    `SELECT uid, email, display_name AS displayName, photo_url AS photoUrl,
            gpu, cpu, ram_gb AS ramGb, created_at AS createdAt, updated_at AS updatedAt
     FROM users WHERE uid = ?`
  )
    .bind(googleUser.uid)
    .first<UserProfile>();

  const user: UserProfile = {
    uid: googleUser.uid,
    email: googleUser.email,
    displayName: userRow?.displayName || googleUser.displayName,
    photoUrl: userRow?.photoUrl || googleUser.photoUrl,
    gpu: userRow?.gpu || '',
    cpu: userRow?.cpu || '',
    ramGb: userRow?.ramGb || 0,
  };

  const { token, expiresAt } = await createSessionToken(
    {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
    },
    env.SESSION_SECRET
  );

  return jsonResponse({
    token,
    expiresAt,
    user,
  });
}
