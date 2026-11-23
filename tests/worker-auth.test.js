import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.ts';
import {
  createTestWorkerEnv,
  createTestSessionToken,
  authHeader,
} from './test-helpers-cloudflare.js';
import {
  createGoogleOAuthMockFetch,
  PRESET_GOOGLE_TOKENS,
  MOCK_GOOGLE_CLIENT_ID,
  MOCK_SESSION_SECRET,
  verifyTestSessionToken,
} from './test-helpers-storage.js';

describe('Worker Auth & Google OAuth Test Suite', () => {
  let env;
  let d1;
  let r2;

  beforeEach(async () => {
    const testEnv = await createTestWorkerEnv({
      sessionSecret: MOCK_SESSION_SECRET,
      googleClientId: MOCK_GOOGLE_CLIENT_ID,
    });
    env = testEnv.env;
    d1 = testEnv.d1;
    r2 = testEnv.r2;
  });

  // ==========================================================================
  // Tier 1 — Feature Coverage (Isolated Happy Path)
  // ==========================================================================
  describe('Tier 1: Feature Coverage', () => {
    test('T1-AUTH-01: Exchange valid Google ID token for session token (POST /api/auth/google)', async () => {
      const mockToken = 'mock:{"uid":"google_alice_123","email":"alice@gamevault.test","displayName":"Alice Gamer","photoUrl":"https://lh3.google.com/alice.png"}';
      const res = await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: mockToken }),
        }),
        env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.token, 'Response must contain session token');
      assert.ok(data.expiresAt > Date.now(), 'expiresAt must be in the future');
      assert.equal(data.user.uid, 'google_alice_123');
      assert.equal(data.user.email, 'alice@gamevault.test');
      assert.equal(data.user.displayName, 'Alice Gamer');
    });

    test('T1-AUTH-02: User upserted in D1 users table upon successful authentication', async () => {
      const mockToken = 'mock:{"uid":"google_bob_456","email":"bob@gamevault.test","displayName":"Bob Reviewer"}';
      await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: mockToken }),
        }),
        env
      );

      const userRow = await d1.prepare('SELECT * FROM users WHERE uid = ?').bind('google_bob_456').first();
      assert.ok(userRow, 'User must exist in D1');
      assert.equal(userRow.email, 'bob@gamevault.test');
      assert.equal(userRow.display_name, 'Bob Reviewer');
    });

    test('T1-AUTH-03: Authenticate protected endpoint with valid session token (Authorization: Bearer)', async () => {
      const token = await createTestSessionToken({ uid: 'user_authed', email: 'auth@test.com' }, env.SESSION_SECRET);
      await d1.prepare('INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)').bind('user_authed', 'auth@test.com', 'Authed').run();

      const res = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({ gpu: 'RTX 4070', cpu: 'Ryzen 5 7600', ramGb: 32 }),
        }),
        env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.gpu, 'RTX 4070');
    });

    test('T1-AUTH-04: Fetch authenticated user profile (GET /api/users/:uid)', async () => {
      await d1.prepare('INSERT INTO users (uid, email, display_name, gpu, cpu, ram_gb) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('user_profile_1', 'profile1@test.com', 'Profile 1', 'RTX 3080', 'i7-12700K', 32)
        .run();

      const res = await worker.fetch(new Request('http://localhost/api/users/user_profile_1'), env);
      assert.equal(res.status, 200);
      const profile = await res.json();
      assert.equal(profile.uid, 'user_profile_1');
      assert.equal(profile.displayName, 'Profile 1');
      assert.equal(profile.gpu, 'RTX 3080');
      assert.equal(profile.ramGb, 32);
    });

    test('T1-AUTH-05: Update hardware profile via authenticated endpoint (PUT /api/users/me/hardware)', async () => {
      const token = await createTestSessionToken({ uid: 'hw_user', email: 'hw@test.com' }, env.SESSION_SECRET);

      const res = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({ gpu: 'Radeon RX 7900 XTX', cpu: 'Ryzen 9 7950X', ramGb: 64 }),
        }),
        env
      );

      assert.equal(res.status, 200);
      const savedHw = await res.json();
      assert.equal(savedHw.gpu, 'Radeon RX 7900 XTX');
      assert.equal(savedHw.ramGb, 64);

      // Verify in database
      const row = await d1.prepare('SELECT gpu, cpu, ram_gb FROM users WHERE uid = ?').bind('hw_user').first();
      assert.equal(row.gpu, 'Radeon RX 7900 XTX');
      assert.equal(row.ram_gb, 64);
    });

    test('T1-AUTH-06: Session token claims verification (alg=HS256, typ=JWT, sub/uid, email, iat, exp)', async () => {
      const token = await createTestSessionToken({ uid: 'claims_user', email: 'claims@test.com' }, env.SESSION_SECRET);
      const payload = await verifyTestSessionToken(token, env.SESSION_SECRET);
      assert.ok(payload);
      assert.equal(payload.uid, 'claims_user');
      assert.equal(payload.email, 'claims@test.com');
      assert.ok(payload.iat <= Math.floor(Date.now() / 1000));
      assert.ok(payload.exp > Math.floor(Date.now() / 1000));
    });

    test('T1-AUTH-07: Idempotent re-login preserves previously saved hardware specs in D1', async () => {
      const uid = 'preserve_user';
      const mockToken = `mock:{"uid":"${uid}","email":"preserve@test.com","displayName":"Preserve User"}`;

      // First login
      await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: mockToken }),
        }),
        env
      );

      // Set hardware
      const session1 = await createTestSessionToken({ uid, email: 'preserve@test.com' }, env.SESSION_SECRET);
      await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader(session1) },
          body: JSON.stringify({ gpu: 'RTX 4080 Super', cpu: 'i9-14900K', ramGb: 32 }),
        }),
        env
      );

      // Second login (re-authenticate with Google)
      const res2 = await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: mockToken }),
        }),
        env
      );

      assert.equal(res2.status, 200);
      const data2 = await res2.json();
      assert.equal(data2.user.gpu, 'RTX 4080 Super');
      assert.equal(data2.user.cpu, 'i9-14900K');
      assert.equal(data2.user.ramGb, 32);
    });
  });

  // ==========================================================================
  // Tier 2 — Boundary & Security Cases
  // ==========================================================================
  describe('Tier 2: Boundary & Security Cases', () => {
    test('T2-AUTH-01: Reject expired Google ID token with 401 Unauthorized', async () => {
      const { fetch: mockFetch } = createGoogleOAuthMockFetch({ clientId: MOCK_GOOGLE_CLIENT_ID });
      const envWithFetch = {
        ...env,
        ALLOW_MOCK_AUTH: 'false',
        GOOGLE_TOKENINFO_URL: 'https://oauth2.googleapis.com/tokeninfo',
      };

      // Monkey-patch global fetch during this test
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        const res = await worker.fetch(
          new Request('http://localhost/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: PRESET_GOOGLE_TOKENS.EXPIRED }),
          }),
          envWithFetch
        );
        assert.equal(res.status, 401);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('T2-AUTH-02: Reject Google ID token with mismatched client ID (aud mismatch) with 401', async () => {
      const { fetch: mockFetch } = createGoogleOAuthMockFetch({ clientId: MOCK_GOOGLE_CLIENT_ID });
      const envWithFetch = {
        ...env,
        ALLOW_MOCK_AUTH: 'false',
        GOOGLE_CLIENT_ID: 'strict-client-id-12345.apps.googleusercontent.com',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        const res = await worker.fetch(
          new Request('http://localhost/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: PRESET_GOOGLE_TOKENS.WRONG_AUDIENCE }),
          }),
          envWithFetch
        );
        assert.equal(res.status, 401);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('T2-AUTH-03: Reject Google ID token with untrusted issuer (iss mismatch) with 401', async () => {
      const { fetch: mockFetch } = createGoogleOAuthMockFetch({ clientId: MOCK_GOOGLE_CLIENT_ID });
      const envWithFetch = { ...env, ALLOW_MOCK_AUTH: 'false' };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;
      try {
        const res = await worker.fetch(
          new Request('http://localhost/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: PRESET_GOOGLE_TOKENS.WRONG_ISSUER }),
          }),
          envWithFetch
        );
        assert.equal(res.status, 401);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('T2-AUTH-04: Reject protected route request missing Authorization header with 401', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gpu: 'GTX 1060' }),
        }),
        env
      );
      assert.equal(res.status, 401);
    });

    test('T2-AUTH-05: Reject non-Bearer schemes (Basic, Token, raw string) with 401', async () => {
      const resBasic = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Basic dXNlcjpwYXNz' },
          body: JSON.stringify({ gpu: 'GTX 1060' }),
        }),
        env
      );
      assert.equal(resBasic.status, 401);

      const resRaw = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'some-random-token' },
          body: JSON.stringify({ gpu: 'GTX 1060' }),
        }),
        env
      );
      assert.equal(resRaw.status, 401);
    });

    test('T2-AUTH-06: Reject tampered session token signature with 401', async () => {
      const validToken = await createTestSessionToken({ uid: 'user_tamper' }, env.SESSION_SECRET);
      // Tamper signature
      const tampered = validToken.slice(0, -5) + 'AAAAA';

      const res = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader(tampered) },
          body: JSON.stringify({ gpu: 'GTX 1060' }),
        }),
        env
      );
      assert.equal(res.status, 401);
    });

    test('T2-AUTH-07: Reject session token signed with mismatched HMAC secret with 401', async () => {
      const foreignToken = await createTestSessionToken({ uid: 'user_foreign' }, 'a-totally-different-hmac-secret-key!');

      const res = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader(foreignToken) },
          body: JSON.stringify({ gpu: 'GTX 1060' }),
        }),
        env
      );
      assert.equal(res.status, 401);
    });

    test('T2-AUTH-08: Reject expired session token with 401', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const expiredPayload = Buffer.from(JSON.stringify({ uid: 'expired_user', iat: now - 7200, exp: now - 3600 })).toString('base64url');
      const data = `${header}.${expiredPayload}`;

      // Sign with correct key
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
      const expiredToken = `${data}.${Buffer.from(sig).toString('base64url')}`;

      const res = await worker.fetch(
        new Request('http://localhost/api/users/me/hardware', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader(expiredToken) },
          body: JSON.stringify({ gpu: 'GTX 1060' }),
        }),
        env
      );
      assert.equal(res.status, 401);
    });

    test('T2-AUTH-09: Reject malformed JWT token structure', async () => {
      const badTokens = ['singlepart', 'part1.part2', 'part1.part2.part3.part4', 'invalid base64!'];
      for (const bad of badTokens) {
        const res = await worker.fetch(
          new Request('http://localhost/api/users/me/hardware', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeader(bad) },
            body: JSON.stringify({ gpu: 'GTX 1060' }),
          }),
          env
        );
        assert.equal(res.status, 401, `Token ${bad} should be rejected with 401`);
      }
    });

    test('T2-AUTH-10: Reject POST /api/auth/google with missing idToken in body with 400', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notIdToken: 'xyz' }),
        }),
        env
      );
      assert.equal(res.status, 400);
    });

    test('T2-AUTH-11: Successfully authenticate user with Unicode / Vietnamese display names and emojis', async () => {
      const unicodeToken = 'mock:{"uid":"vn_gamer_99","email":"phuc@gamevault.vn","displayName":"Nguyễn Văn Phúc 🎮 [Pro]"}';
      const res = await worker.fetch(
        new Request('http://localhost/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: unicodeToken }),
        }),
        env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.user.displayName, 'Nguyễn Văn Phúc 🎮 [Pro]');

      const row = await d1.prepare('SELECT display_name FROM users WHERE uid = ?').bind('vn_gamer_99').first();
      assert.equal(row.display_name, 'Nguyễn Văn Phúc 🎮 [Pro]');
    });
  });

  // ==========================================================================
  // Tier 3 — Cross-Feature Combinations
  // ==========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    test('T3-AUTH-01: Auth + Review Submission + SQL Leaderboard reflects caller myScore', async () => {
      const aliceToken = await createTestSessionToken({ uid: 'alice_t3', email: 'alice@t3.test' }, env.SESSION_SECRET);
      await d1.prepare('INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)').bind('alice_t3', 'alice@t3.test', 'Alice T3').run();

      // Submit review
      await worker.fetch(new Request('http://localhost/api/games/game-t3/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Game T3', score: 9.2 }),
      }), env);

      // Check leaderboard
      const lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard', {
        headers: authHeader(aliceToken)
      }), env)).json();

      assert.equal(lb.entries[0].gameKey, 'game-t3');
      assert.equal(lb.entries[0].myScore, 9.2);
    });

    test('T3-AUTH-02: Auth + Review Deletion + Leaderboard recalculates and removes myScore', async () => {
      const bobToken = await createTestSessionToken({ uid: 'bob_t3', email: 'bob@t3.test' }, env.SESSION_SECRET);
      await d1.prepare('INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)').bind('bob_t3', 'bob@t3.test', 'Bob T3').run();

      await worker.fetch(new Request('http://localhost/api/games/del-game/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameTitle: 'Del Game', score: 8.0 }),
      }), env);

      // Delete review
      const delRes = await worker.fetch(new Request('http://localhost/api/games/del-game/reviews', {
        method: 'DELETE',
        headers: authHeader(bobToken),
      }), env);
      assert.equal(delRes.status, 200);

      // Leaderboard is now empty
      const lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard', {
        headers: authHeader(bobToken)
      }), env)).json();
      assert.equal(lb.total, 0);
    });

    test('T3-AUTH-03: Multi-User Identity Isolation & Hardware Profile Enrichment in reviews', async () => {
      const u1Token = await createTestSessionToken({ uid: 'u1_iso', email: 'u1@iso.test' }, env.SESSION_SECRET);
      const u2Token = await createTestSessionToken({ uid: 'u2_iso', email: 'u2@iso.test' }, env.SESSION_SECRET);

      // User 1 hardware: AMD
      await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader(u1Token) },
        body: JSON.stringify({ gpu: 'RX 6800', cpu: 'Ryzen 5600X', ramGb: 16 }),
      }), env);

      // User 2 hardware: Nvidia
      await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader(u2Token) },
        body: JSON.stringify({ gpu: 'RTX 3080', cpu: 'i7-12700K', ramGb: 32 }),
      }), env);

      // Both review same game
      await worker.fetch(new Request('http://localhost/api/games/multi-hw/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(u1Token) },
        body: JSON.stringify({ gameTitle: 'Multi HW', score: 8, fps: 90 }),
      }), env);
      await worker.fetch(new Request('http://localhost/api/games/multi-hw/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(u2Token) },
        body: JSON.stringify({ gameTitle: 'Multi HW', score: 9, fps: 144 }),
      }), env);

      const reviews = await (await worker.fetch(new Request('http://localhost/api/games/multi-hw/reviews'), env)).json();
      assert.equal(reviews.total, 2);

      const rev1 = reviews.reviews.find(r => r.uid === 'u1_iso');
      const rev2 = reviews.reviews.find(r => r.uid === 'u2_iso');
      assert.equal(rev1.authorHw.gpu, 'RX 6800');
      assert.equal(rev2.authorHw.gpu, 'RTX 3080');
    });

    test('T3-AUTH-04: Auth + Community Pick Voting enforces atomic user voting and rejects unauthenticated votes', async () => {
      // Unauthenticated vote rejected
      const unauthRes = await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameKey: 'pick_game', gameTitle: 'Pick Game' }),
      }), env);
      assert.equal(unauthRes.status, 401);

      // Authenticated vote succeeds
      const token = await createTestSessionToken({ uid: 'voter_1' }, env.SESSION_SECRET);
      const authRes = await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ gameKey: 'pick_game', gameTitle: 'Pick Game', month: '2026-11' }),
      }), env);
      assert.equal(authRes.status, 200);
      const pick = await authRes.json();
      assert.equal(pick.votes['voter_1'], 'pick_game');
    });

    test('T3-AUTH-05: Auth + R2 Image Upload endpoint access control', async () => {
      // Unauthenticated upload rejected
      const unauthRes = await worker.fetch(new Request('http://localhost/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: Buffer.from('png-data'),
      }), env);
      assert.equal(unauthRes.status, 401);

      // Authenticated upload succeeds
      const token = await createTestSessionToken({ uid: 'uploader_1' }, env.SESSION_SECRET);
      const authRes = await worker.fetch(new Request('http://localhost/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', ...authHeader(token) },
        body: Buffer.from('png-data'),
      }), env);
      assert.equal(authRes.status, 201);
    });
  });

  // ==========================================================================
  // Tier 4 — Real-World Application Scenarios
  // ==========================================================================
  describe('Tier 4: Real-World Scenarios', () => {
    test('T4-AUTH-01: Complete desktop user first launch onboarding and auth lifecycle', async () => {
      // 1. User performs Google OAuth PKCE and app exchanges token with worker
      const exchangeRes = await worker.fetch(new Request('http://localhost/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'mock:{"uid":"desktop_newbie","email":"newbie@gamevault.app","displayName":"Desktop Newbie"}' }),
      }), env);
      assert.equal(exchangeRes.status, 200);
      const session = await exchangeRes.json();

      // 2. Client stores session token and fetches initial profile
      const profRes = await worker.fetch(new Request(`http://localhost/api/users/${session.user.uid}`), env);
      assert.equal(profRes.status, 200);

      // 3. Client configures hardware specs on first settings save
      const hwRes = await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(session.token) },
        body: JSON.stringify({ gpu: 'RTX 4060', cpu: 'Ryzen 5 7500F', ramGb: 16 }),
      }), env);
      assert.equal(hwRes.status, 200);

      // 4. Client submits first game rating
      const reviewRes = await worker.fetch(new Request('http://localhost/api/games/portal/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(session.token) },
        body: JSON.stringify({ gameTitle: 'Portal', score: 10, review: 'Still alive' }),
      }), env);
      assert.equal(reviewRes.status, 200);
    });

    test('T4-AUTH-02: Expired session recovery: client detects 401, re-exchanges token, and replays request', async () => {
      // Old expired session
      const expiredToken = await createTestSessionToken(
        { uid: 'recover_user', email: 'recover@test.com' },
        env.SESSION_SECRET,
        -100
      );

      // Operation with expired session fails with 401
      const failRes = await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(expiredToken) },
        body: JSON.stringify({ gpu: 'RTX 3070' }),
      }), env);
      assert.equal(failRes.status, 401);

      // Desktop client refreshes via Google and re-exchanges
      const refreshRes = await worker.fetch(new Request('http://localhost/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'mock:{"uid":"recover_user","email":"recover@test.com","displayName":"Recover User"}' }),
      }), env);
      assert.equal(refreshRes.status, 200);
      const freshSession = await refreshRes.json();

      // Client replays the request with fresh token
      const retryRes = await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(freshSession.token) },
        body: JSON.stringify({ gpu: 'RTX 3070' }),
      }), env);
      assert.equal(retryRes.status, 200);
      const data = await retryRes.json();
      assert.equal(data.gpu, 'RTX 3070');
    });

    test('T4-AUTH-03: Stateless multi-session concurrency (multiple active devices for single user)', async () => {
      const uid = 'multi_dev_user';
      // Device A issues token
      const sessionA = await createTestSessionToken({ uid, email: 'multi@test.com', device: 'Desktop-PC' }, env.SESSION_SECRET);
      // Device B issues token
      const sessionB = await createTestSessionToken({ uid, email: 'multi@test.com', device: 'Gaming-Laptop' }, env.SESSION_SECRET);

      // Both can concurrently make authorized requests without session invalidation
      const resA = await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(sessionA) },
        body: JSON.stringify({ gpu: 'RTX 4090' }),
      }), env);
      assert.equal(resA.status, 200);

      const resB = await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(sessionB) },
        body: JSON.stringify({ gpu: 'RTX 4090 Mobile' }),
      }), env);
      assert.equal(resB.status, 200);
    });
  });
});
