import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkerEnv, createTestSessionToken, authHeader, createMockD1 } from './test-helpers-cloudflare.js';
import worker from '../worker/src/index.ts';

describe('Worker Backend & D1 Database Test Suite', () => {
  let env;
  let d1;
  let r2;
  let aliceToken;
  let bobToken;
  const aliceUid = 'user_alice';
  const bobUid = 'user_bob';

  beforeEach(async () => {
    const testEnv = await createTestWorkerEnv();
    env = testEnv.env;
    d1 = testEnv.d1;
    r2 = testEnv.r2;

    aliceToken = await createTestSessionToken({ uid: aliceUid, email: 'alice@gamevault.test', displayName: 'Alice' }, env.SESSION_SECRET);
    bobToken = await createTestSessionToken({ uid: bobUid, email: 'bob@gamevault.test', displayName: 'Bob' }, env.SESSION_SECRET);

    // Seed users in D1
    await d1.prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`).bind(aliceUid, 'alice@gamevault.test', 'Alice').run();
    await d1.prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`).bind(bobUid, 'bob@gamevault.test', 'Bob').run();
  });

  // ==========================================================================
  // Tier 1 — Feature Coverage (Isolated Happy Path)
  // ==========================================================================
  describe('Tier 1: Feature Coverage', () => {
    // Feature 1: D1 Schema & CRUD
    test('T1-CRUD-01: Insert and retrieve user profile', async () => {
      const res = await worker.fetch(new Request('http://localhost/api/users/' + aliceUid), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.uid, aliceUid);
      assert.equal(data.email, 'alice@gamevault.test');
      assert.equal(data.displayName, 'Alice');
    });

    test('T1-CRUD-02: Submit new game review', async () => {
      const reviewPayload = {
        gameTitle: 'Hollow Knight',
        score: 9.5,
        review: 'Incredible atmospheric metroidvania',
        dropped: false,
        playtimeMinutes: 2400,
        fps: 144,
      };

      const res = await worker.fetch(
        new Request('http://localhost/api/games/hollow-knight/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify(reviewPayload),
        }),
        env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.gameKey, 'hollow-knight');
      assert.equal(data.score, 9.5);
      assert.equal(data.authorName, 'Alice');
      assert.equal(data.dropped, false);

      // Verify directly in D1
      const dbRow = await d1.prepare('SELECT score, review FROM ratings WHERE uid = ? AND game_key = ?').bind(aliceUid, 'hollow-knight').first();
      assert.ok(dbRow);
      assert.equal(dbRow.score, 9.5);
    });

    test('T1-CRUD-03: Retrieve game reviews with author info', async () => {
      // Alice submits review
      await worker.fetch(
        new Request('http://localhost/api/games/celeste/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify({ gameTitle: 'Celeste', score: 10, review: 'Peak platformer' }),
        }),
        env
      );

      const res = await worker.fetch(new Request('http://localhost/api/games/celeste/reviews'), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.total, 1);
      assert.equal(data.reviews.length, 1);
      assert.equal(data.reviews[0].gameTitle, 'Celeste');
      assert.equal(data.reviews[0].score, 10);
      assert.equal(data.reviews[0].authorName, 'Alice');
    });

    test('T1-CRUD-04: Update existing game review (upsert)', async () => {
      // Initial review
      await worker.fetch(
        new Request('http://localhost/api/games/elden-ring/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify({ gameTitle: 'Elden Ring', score: 8.0, review: 'Good but hard' }),
        }),
        env
      );

      // Updated review
      const res = await worker.fetch(
        new Request('http://localhost/api/games/elden-ring/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify({ gameTitle: 'Elden Ring', score: 10.0, review: 'Masterpiece once clicked' }),
        }),
        env
      );

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.score, 10.0);
      assert.equal(data.review, 'Masterpiece once clicked');

      // Verify single row exists in D1
      const countRes = await d1.prepare('SELECT COUNT(*) AS cnt FROM ratings WHERE game_key = ?').bind('elden-ring').first();
      assert.equal(countRes.cnt, 1);
    });

    test('T1-CRUD-05: Delete my game review', async () => {
      await worker.fetch(
        new Request('http://localhost/api/games/cyberpunk/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify({ gameTitle: 'Cyberpunk 2077', score: 9.0, review: 'Great RPG' }),
        }),
        env
      );

      const delRes = await worker.fetch(
        new Request('http://localhost/api/games/cyberpunk/reviews', {
          method: 'DELETE',
          headers: authHeader(aliceToken),
        }),
        env
      );

      assert.equal(delRes.status, 200);
      const delData = await delRes.json();
      assert.equal(delData.success, true);

      // Verify no reviews remain
      const listRes = await worker.fetch(new Request('http://localhost/api/games/cyberpunk/reviews'), env);
      const listData = await listRes.json();
      assert.equal(listData.total, 0);
      assert.equal(listData.reviews.length, 0);
    });

    test('T1-CRUD-06: Cast community pick vote', async () => {
      const month = '2026-11';
      const voteRes = await worker.fetch(
        new Request('http://localhost/api/picks/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
          body: JSON.stringify({ gameKey: 'silksong', gameTitle: 'Hollow Knight: Silksong', month }),
        }),
        env
      );

      assert.equal(voteRes.status, 200);
      const pick = await voteRes.json();
      assert.equal(pick.month, month);
      assert.equal(pick.gameKey, 'silksong');
      assert.equal(pick.votes[aliceUid], 'silksong');
    });

    // Feature 2: SQL Aggregate Leaderboard
    test('T1-LEAD-01: Calculate average rating accurately (AVG)', async () => {
      // 3 reviews for Hades: scores 8, 9, 10 -> average 9.0
      const charlieUid = 'user_charlie';
      const charlieToken = await createTestSessionToken({ uid: charlieUid, email: 'c@test.com' }, env.SESSION_SECRET);
      await d1.prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`).bind(charlieUid, 'c@test.com', 'Charlie').run();

      await worker.fetch(new Request('http://localhost/api/games/hades/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Hades', score: 8.0 })
      }), env);
      await worker.fetch(new Request('http://localhost/api/games/hades/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameTitle: 'Hades', score: 9.0 })
      }), env);
      await worker.fetch(new Request('http://localhost/api/games/hades/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(charlieToken) },
        body: JSON.stringify({ gameTitle: 'Hades', score: 10.0 })
      }), env);

      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.total, 1);
      assert.equal(data.entries[0].gameKey, 'hades');
      assert.equal(data.entries[0].avgScore, 9.0);
    });

    test('T1-LEAD-02: Calculate review count accurately (COUNT)', async () => {
      // Seed 2 reviews for Portal 2
      await worker.fetch(new Request('http://localhost/api/games/portal2/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Portal 2', score: 10 })
      }), env);
      await worker.fetch(new Request('http://localhost/api/games/portal2/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameTitle: 'Portal 2', score: 10 })
      }), env);

      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      const data = await res.json();
      const portal = data.entries.find(e => e.gameKey === 'portal2');
      assert.ok(portal);
      assert.equal(portal.reviewCount, 2);
    });

    test('T1-LEAD-03: Calculate drop rate percentage accurately', async () => {
      // 4 reviews: 1 dropped, 3 not dropped -> dropRate 0.25
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score, dropped) VALUES
        ('r1', 'u1', 'game-x', 'Game X', 7.0, 1),
        ('r2', 'u2', 'game-x', 'Game X', 8.0, 0),
        ('r3', 'u3', 'game-x', 'Game X', 9.0, 0),
        ('r4', 'u4', 'game-x', 'Game X', 6.0, 0)
      `).run();

      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      const data = await res.json();
      const gameX = data.entries.find(e => e.gameKey === 'game-x');
      assert.ok(gameX);
      assert.equal(gameX.dropRate, 0.25);
    });

    test('T1-LEAD-04: Calculate total playtime sum', async () => {
      // 3 reviews: 60, 120, 180 minutes -> total 360
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score, playtime_minutes) VALUES
        ('r1', 'u1', 'game-y', 'Game Y', 8.0, 60),
        ('r2', 'u2', 'game-y', 'Game Y', 9.0, 120),
        ('r3', 'u3', 'game-y', 'Game Y', 7.0, 180)
      `).run();

      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      const data = await res.json();
      const gameY = data.entries.find(e => e.gameKey === 'game-y');
      assert.ok(gameY);
      assert.equal(gameY.totalPlaytimeMinutes, 360);
    });

    test('T1-LEAD-05: Retrieve myScore for authenticated user', async () => {
      await worker.fetch(new Request('http://localhost/api/games/game-z/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Game Z', score: 8.5 })
      }), env);
      await worker.fetch(new Request('http://localhost/api/games/game-z/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameTitle: 'Game Z', score: 7.0 })
      }), env);

      // Query with Alice auth header
      const aliceRes = await worker.fetch(new Request('http://localhost/api/leaderboard', {
        headers: authHeader(aliceToken)
      }), env);
      const aliceData = await aliceRes.json();
      const aliceEntry = aliceData.entries.find(e => e.gameKey === 'game-z');
      assert.equal(aliceEntry.myScore, 8.5);

      // Query with Bob auth header
      const bobRes = await worker.fetch(new Request('http://localhost/api/leaderboard', {
        headers: authHeader(bobToken)
      }), env);
      const bobData = await bobRes.json();
      const bobEntry = bobData.entries.find(e => e.gameKey === 'game-z');
      assert.equal(bobEntry.myScore, 7.0);
    });

    test('T1-LEAD-06: Verify pagination limit and offset slices', async () => {
      // Seed 6 distinct games
      for (let i = 1; i <= 6; i++) {
        await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score) VALUES (?, ?, ?, ?, ?)`).bind(
          `id_${i}`, `u_${i}`, `game_${i}`, `Game ${i}`, i + 4
        ).run();
      }

      const page1 = await (await worker.fetch(new Request('http://localhost/api/leaderboard?limit=3&offset=0'), env)).json();
      assert.equal(page1.entries.length, 3);
      assert.equal(page1.total, 6);

      const page2 = await (await worker.fetch(new Request('http://localhost/api/leaderboard?limit=3&offset=3'), env)).json();
      assert.equal(page2.entries.length, 3);
      assert.equal(page2.total, 6);

      // Verify no overlap in game keys between page 1 and page 2
      const keys1 = new Set(page1.entries.map(e => e.gameKey));
      for (const e of page2.entries) {
        assert.ok(!keys1.has(e.gameKey), `Key ${e.gameKey} should not be on page 1`);
      }
    });

    // Feature 4: Cloudflare R2 Image Storage
    test('T1-R2-01: Upload binary PNG image to shared R2', async () => {
      const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
      const res = await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'image/png',
            'X-Image-Kind': 'screenshot',
            ...authHeader(aliceToken),
          },
          body: pngBytes,
        }),
        env
      );

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.key.endsWith('.png'));
      assert.equal(data.url, `/api/images/${data.key}`);
    });

    test('T1-R2-02: Stream back uploaded image with correct Content-Type', async () => {
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const uploadRes = await (await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', ...authHeader(aliceToken) },
          body: jpegBytes,
        }),
        env
      )).json();

      const getRes = await worker.fetch(new Request(`http://localhost${uploadRes.url}`), env);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.headers.get('Content-Type'), 'image/jpeg');

      const returnedBytes = Buffer.from(await getRes.arrayBuffer());
      assert.deepEqual(returnedBytes, jpegBytes);
    });

    test('T1-R2-03: Upload WebP image', async () => {
      const webpBytes = Buffer.from('RIFF....WEBPVP8 ');
      const res = await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'image/webp', ...authHeader(aliceToken) },
          body: webpBytes,
        }),
        env
      );

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.key.endsWith('.webp'));
    });

    test('T1-R2-04: Retrieve image caching headers and ETag', async () => {
      const body = Buffer.from('image-test-bytes');
      const uploadRes = await (await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(aliceToken) },
          body,
        }),
        env
      )).json();

      const getRes = await worker.fetch(new Request(`http://localhost${uploadRes.url}`), env);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
      assert.ok(getRes.headers.get('ETag'));
    });

    test('T1-R2-05: Direct R2 head and delete verification', async () => {
      const body = Buffer.from('direct-r2-test');
      const uploadRes = await (await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(aliceToken) },
          body,
        }),
        env
      )).json();

      const head = await r2.head(uploadRes.key);
      assert.ok(head);
      assert.equal(head.size, body.length);

      await r2.delete(uploadRes.key);
      const getRes = await worker.fetch(new Request(`http://localhost${uploadRes.url}`), env);
      assert.equal(getRes.status, 404);
    });
  });

  // ==========================================================================
  // Tier 2 — Boundary & Corner Cases
  // ==========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    // Feature 1 Boundaries
    test('T2-CRUD-01: Review score boundary values (exact 1.0 and exact 10.0)', async () => {
      const resMin = await worker.fetch(new Request('http://localhost/api/games/min-game/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Min Game', score: 1.0 })
      }), env);
      assert.equal(resMin.status, 200);

      const resMax = await worker.fetch(new Request('http://localhost/api/games/max-game/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Max Game', score: 10.0 })
      }), env);
      assert.equal(resMax.status, 200);
    });

    test('T2-CRUD-02: Reject invalid scores (<1, >10, NaN)', async () => {
      const res0 = await worker.fetch(new Request('http://localhost/api/games/bad/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Bad', score: 0 })
      }), env);
      assert.equal(res0.status, 400);

      const res11 = await worker.fetch(new Request('http://localhost/api/games/bad/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Bad', score: 10.5 })
      }), env);
      assert.equal(res11.status, 400);

      const resNaN = await worker.fetch(new Request('http://localhost/api/games/bad/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Bad', score: 'not-a-number' })
      }), env);
      assert.equal(resNaN.status, 400);
    });

    test('T2-CRUD-03: Empty and whitespace-only review comment', async () => {
      const resEmpty = await worker.fetch(new Request('http://localhost/api/games/empty-rev/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Empty Rev', score: 8, review: '' })
      }), env);
      assert.equal(resEmpty.status, 200);

      const resSpace = await worker.fetch(new Request('http://localhost/api/games/space-rev/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Space Rev', score: 8, review: '   ' })
      }), env);
      assert.equal(resSpace.status, 200);
    });

    test('T2-CRUD-04: Massive review text payload boundary (10KB)', async () => {
      const largeText = 'A'.repeat(10000);
      const res = await worker.fetch(new Request('http://localhost/api/games/large-rev/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Large Rev', score: 9, review: largeText })
      }), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.review.length, 10000);
    });

    test('T2-CRUD-05: Query non-existent gameKey reviews returns empty list', async () => {
      const res = await worker.fetch(new Request('http://localhost/api/games/non-existent-9999/reviews'), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.total, 0);
      assert.deepEqual(data.reviews, []);
    });

    test('T2-CRUD-06: Atomic vote change and retract on community picks', async () => {
      const month = '2026-11';
      // Vote for game 1
      await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameKey: 'game1', gameTitle: 'Game 1', month })
      }), env);

      // Change vote to game 2
      const vote2 = await (await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameKey: 'game2', gameTitle: 'Game 2', month })
      }), env)).json();
      assert.equal(vote2.votes[aliceUid], 'game2');

      // Retract vote
      const retract = await (await worker.fetch(new Request(`http://localhost/api/picks/vote?month=${month}`, {
        method: 'DELETE', headers: authHeader(aliceToken)
      }), env)).json();
      assert.equal(retract.votes[aliceUid], undefined);
    });

    // Feature 2 Boundaries
    test('T2-LEAD-01: Zero ratings in database (empty state)', async () => {
      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.total, 0);
      assert.deepEqual(data.entries, []);
    });

    test('T2-LEAD-02: Zero division avoidance on 100% dropped game', async () => {
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score, dropped) VALUES
        ('r1', 'u1', 'dropped-game', 'Dropped Game', 5.0, 1),
        ('r2', 'u2', 'dropped-game', 'Dropped Game', 4.0, 1)
      `).run();

      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      const data = await res.json();
      const entry = data.entries.find(e => e.gameKey === 'dropped-game');
      assert.ok(entry);
      assert.equal(entry.dropRate, 1.0);
    });

    test('T2-LEAD-03: Game with 0% dropped reviews', async () => {
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score, dropped) VALUES
        ('r1', 'u1', 'clean-game', 'Clean Game', 8.0, 0),
        ('r2', 'u2', 'clean-game', 'Clean Game', 9.0, 0)
      `).run();

      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      const data = await res.json();
      const entry = data.entries.find(e => e.gameKey === 'clean-game');
      assert.ok(entry);
      assert.equal(entry.dropRate, 0.0);
    });

    test('T2-LEAD-04: Pagination limit 0 or negative limit handling', async () => {
      const res0 = await worker.fetch(new Request('http://localhost/api/leaderboard?limit=0'), env);
      assert.equal(res0.status, 200);
      const data0 = await res0.json();
      assert.ok(data0.limit > 0);

      const resNeg = await worker.fetch(new Request('http://localhost/api/leaderboard?limit=-10'), env);
      assert.equal(resNeg.status, 200);
      const dataNeg = await resNeg.json();
      assert.ok(dataNeg.limit > 0);
    });

    test('T2-LEAD-05: Pagination offset exceeding total count', async () => {
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score) VALUES ('r1', 'u1', 'g1', 'Game 1', 8.0)`).run();
      const res = await worker.fetch(new Request('http://localhost/api/leaderboard?offset=100'), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.total, 1);
      assert.deepEqual(data.entries, []);
    });

    test('T2-LEAD-06: Equal score tie-breaking ordered by reviewCount', async () => {
      // Game A: 2 reviews averaging 9.0
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score) VALUES
        ('r1', 'u1', 'game-a', 'Game A', 9.0),
        ('r2', 'u2', 'game-a', 'Game A', 9.0)
      `).run();

      // Game B: 1 review averaging 9.0
      await d1.prepare(`INSERT INTO ratings (id, uid, game_key, game_title, score) VALUES
        ('r3', 'u3', 'game-b', 'Game B', 9.0)
      `).run();

      const res = await worker.fetch(new Request('http://localhost/api/leaderboard'), env);
      const data = await res.json();
      assert.equal(data.entries[0].gameKey, 'game-a'); // Game A has 2 reviews vs 1
      assert.equal(data.entries[1].gameKey, 'game-b');
    });

    // Feature 4 Boundaries
    test('T2-R2-01: Zero-byte image upload rejection', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', ...authHeader(aliceToken) },
          body: new ArrayBuffer(0),
        }),
        env
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /empty/i);
    });

    test('T2-R2-02: Exceeding max upload size (>10MB) returns 413', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '11000000',
            ...authHeader(aliceToken),
          },
          body: Buffer.alloc(10), // mock headers check
        }),
        env
      );
      assert.equal(res.status, 413);
    });

    test('T2-R2-03: Unsupported MIME type rejection', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf', ...authHeader(aliceToken) },
          body: Buffer.from('%PDF-1.4'),
        }),
        env
      );
      assert.equal(res.status, 415);
    });

    test('T2-R2-04: Non-existent image key retrieval returns 404', async () => {
      const res = await worker.fetch(new Request('http://localhost/api/images/missing-uuid.png'), env);
      assert.equal(res.status, 404);
    });

    test('T2-R2-05: Path traversal attack in image key rejected', async () => {
      const resTraversal = await worker.fetch(new Request('http://localhost/api/images/..%2F..%2Fetc%2Fpasswd'), env);
      assert.equal(resTraversal.status, 400);
    });

    test('T2-R2-06: Unauthenticated image upload rejected with 401', async () => {
      const res = await worker.fetch(
        new Request('http://localhost/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: Buffer.from('png-bytes'),
        }),
        env
      );
      assert.equal(res.status, 401);
    });
  });

  // ==========================================================================
  // Tier 3 — Cross-Feature Combinations
  // ==========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    test('T3-COMB-01: Auth + Review Submission + SQL Leaderboard Aggregation', async () => {
      // Alice reviews Hades with 9
      await worker.fetch(new Request('http://localhost/api/games/hades/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Hades', score: 9.0 })
      }), env);

      // Bob reviews Hades with 10
      await worker.fetch(new Request('http://localhost/api/games/hades/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameTitle: 'Hades', score: 10.0 })
      }), env);

      // Leaderboard reflects AVG=9.5 and Alice's myScore=9.0
      const lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard', {
        headers: authHeader(aliceToken)
      }), env)).json();

      assert.equal(lb.total, 1);
      assert.equal(lb.entries[0].avgScore, 9.5);
      assert.equal(lb.entries[0].reviewCount, 2);
      assert.equal(lb.entries[0].myScore, 9.0);
    });

    test('T3-COMB-02: Auth + R2 Image Upload + Review Screenshot Attachment', async () => {
      // Alice uploads screenshot to R2
      const imgUpload = await (await worker.fetch(new Request('http://localhost/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'X-Image-Kind': 'screenshot', ...authHeader(aliceToken) },
        body: Buffer.from('victory-screenshot-data'),
      }), env)).json();

      // Alice attaches image URL to review
      const revRes = await (await worker.fetch(new Request('http://localhost/api/games/boss-fight/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({
          gameTitle: 'Boss Fight',
          score: 10,
          coverUrl: imgUpload.url,
          review: 'Beat the boss!',
        }),
      }), env)).json();

      assert.equal(revRes.coverUrl, imgUpload.url);

      // Retrieve image stream to confirm accessibility
      const streamRes = await worker.fetch(new Request(`http://localhost${imgUpload.url}`), env);
      assert.equal(streamRes.status, 200);
      assert.equal(streamRes.headers.get('Content-Type'), 'image/png');
    });

    test('T3-COMB-03: User Profile & Hardware Update + Review Author Enrichment', async () => {
      // Alice updates hardware
      await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gpu: 'RTX 4090', cpu: 'Ryzen 7 7800X3D', ramGb: 64 }),
      }), env);

      // Alice submits review with FPS
      await worker.fetch(new Request('http://localhost/api/games/cyberpunk/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Cyberpunk', score: 9.5, fps: 120 }),
      }), env);

      // Anonymous user queries reviews
      const revList = await (await worker.fetch(new Request('http://localhost/api/games/cyberpunk/reviews'), env)).json();
      assert.equal(revList.total, 1);
      const review = revList.reviews[0];
      assert.equal(review.authorName, 'Alice');
      assert.deepEqual(review.authorHw, { gpu: 'RTX 4090', cpu: 'Ryzen 7 7800X3D', ramGb: 64 });
      assert.equal(review.fps, 120);
    });

    test('T3-COMB-04: Multi-User Community Pick Voting + Real-time Aggregate Tally', async () => {
      const month = '2026-12';
      // Alice votes for Silksong
      await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameKey: 'silksong', gameTitle: 'Silksong', month }),
      }), env);

      // Bob votes for Hades 2
      const bobVote = await (await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameKey: 'hades2', gameTitle: 'Hades 2', month }),
      }), env)).json();

      assert.equal(bobVote.votes[aliceUid], 'silksong');
      assert.equal(bobVote.votes[bobUid], 'hades2');
    });

    test('T3-COMB-05: Review Deletion + Instant Leaderboard Recalculation', async () => {
      // Alice gives 10, Bob gives 6 -> avg = 8.0
      await worker.fetch(new Request('http://localhost/api/games/zelda/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'Zelda', score: 10.0 }),
      }), env);
      await worker.fetch(new Request('http://localhost/api/games/zelda/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameTitle: 'Zelda', score: 6.0 }),
      }), env);

      let lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard'), env)).json();
      assert.equal(lb.entries[0].avgScore, 8.0);
      assert.equal(lb.entries[0].reviewCount, 2);

      // Bob deletes review
      await worker.fetch(new Request('http://localhost/api/games/zelda/reviews', {
        method: 'DELETE', headers: authHeader(bobToken)
      }), env);

      lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard'), env)).json();
      assert.equal(lb.entries[0].avgScore, 10.0);
      assert.equal(lb.entries[0].reviewCount, 1);
    });
  });

  // ==========================================================================
  // Tier 4 — Real-World Application Scenarios
  // ==========================================================================
  describe('Tier 4: Real-World Scenarios', () => {
    test('T4-SCEN-01: Fresh Gamer Journey — Onboarding, First Review & Leaderboard Impact', async () => {
      // New gamer Dan arrives
      const danUid = 'user_dan';
      const danToken = await createTestSessionToken({ uid: danUid, email: 'dan@gamevault.test', displayName: 'Dan Gamer' }, env.SESSION_SECRET);
      await d1.prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`).bind(danUid, 'dan@gamevault.test', 'Dan Gamer').run();

      // Dan sets PC hardware profile
      await worker.fetch(new Request('http://localhost/api/users/me/hardware', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader(danToken) },
        body: JSON.stringify({ gpu: 'RTX 3070', cpu: 'i5-12600K', ramGb: 16 }),
      }), env);

      // Dan completes Balatro and leaves a glowing review
      await worker.fetch(new Request('http://localhost/api/games/balatro/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(danToken) },
        body: JSON.stringify({
          gameTitle: 'Balatro',
          score: 9.8,
          review: 'One more run syndrome perfected',
          dropped: false,
          playtimeMinutes: 2100,
          fps: 144,
        }),
      }), env);

      // Dan checks leaderboard
      const lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard', {
        headers: authHeader(danToken)
      }), env)).json();

      assert.equal(lb.entries[0].gameKey, 'balatro');
      assert.equal(lb.entries[0].myScore, 9.8);
      assert.equal(lb.entries[0].totalPlaytimeMinutes, 2100);
    });

    test('T4-SCEN-02: Community Monthly Pick Race & Winning Selection', async () => {
      const month = '2027-01';
      // Alice and Bob both vote for Silksong
      await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameKey: 'silksong', gameTitle: 'Silksong', month }),
      }), env);
      await worker.fetch(new Request('http://localhost/api/picks/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(bobToken) },
        body: JSON.stringify({ gameKey: 'silksong', gameTitle: 'Silksong', month }),
      }), env);

      const pick = await (await worker.fetch(new Request(`http://localhost/api/picks/current?month=${month}`), env)).json();
      assert.equal(pick.gameKey, 'silksong');
      assert.equal(Object.keys(pick.votes).length, 2);
    });

    test('T4-SCEN-03: High-Res Screenshot Vault Upload & Review Showcase', async () => {
      const highResPayload = Buffer.alloc(1024 * 50, 0x7f); // 50KB image
      const upRes = await (await worker.fetch(new Request('http://localhost/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'X-Image-Kind': 'screenshot', ...authHeader(aliceToken) },
        body: highResPayload,
      }), env)).json();

      const fetchImg = await worker.fetch(new Request(`http://localhost${upRes.url}`), env);
      assert.equal(fetchImg.status, 200);
      assert.equal(fetchImg.headers.get('Content-Length'), String(highResPayload.length));
    });

    test('T4-SCEN-04: Review Revision — Changing Dropped Status & Re-scoring', async () => {
      // Initially dropped after 2 hours
      await worker.fetch(new Request('http://localhost/api/games/no-mans-sky/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: "No Man's Sky", score: 4.0, dropped: true, dropReason: 'Empty worlds', playtimeMinutes: 120 }),
      }), env);

      let lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard'), env)).json();
      assert.equal(lb.entries[0].dropRate, 1.0);
      assert.equal(lb.entries[0].avgScore, 4.0);

      // Months later, patches rolled out, completed and loved it
      await worker.fetch(new Request('http://localhost/api/games/no-mans-sky/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: "No Man's Sky", score: 9.0, dropped: false, dropReason: null, playtimeMinutes: 4800 }),
      }), env);

      lb = await (await worker.fetch(new Request('http://localhost/api/leaderboard'), env)).json();
      assert.equal(lb.entries[0].dropRate, 0.0);
      assert.equal(lb.entries[0].avgScore, 9.0);
      assert.equal(lb.entries[0].reviewCount, 1);
    });

    test('T4-SCEN-05: Public Anonymous Browsing vs Authenticated Personalization', async () => {
      await worker.fetch(new Request('http://localhost/api/games/witcher3/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(aliceToken) },
        body: JSON.stringify({ gameTitle: 'The Witcher 3', score: 10 }),
      }), env);

      // Public anonymous visitor
      const anonLb = await (await worker.fetch(new Request('http://localhost/api/leaderboard'), env)).json();
      assert.equal(anonLb.entries[0].myScore, null);

      // Authenticated Alice
      const authLb = await (await worker.fetch(new Request('http://localhost/api/leaderboard', {
        headers: authHeader(aliceToken)
      }), env)).json();
      assert.equal(authLb.entries[0].myScore, 10);
    });
  });

  // ==========================================================================
  // Tier 5 — D1 Mock Fidelity & Statement Execution (Challenger 1 Fixes)
  // ==========================================================================
  describe('Tier 5: D1 Mock Fidelity & Statement Execution', () => {
    test('T5-MOCK-01: Statement immutability and reuse across batch operations', async () => {
      const mockDb = createMockD1(':memory:');
      await mockDb.exec('CREATE TABLE items (id TEXT PRIMARY KEY, val TEXT, ord INT)');
      const insertStmt = mockDb.prepare('INSERT INTO items (id, val, ord) VALUES (?, ?, ?)');

      // Reusing the same prepared statement across multiple bind() calls in batch
      await mockDb.batch([
        insertStmt.bind('item-1', 'alpha', 1),
        insertStmt.bind('item-2', 'beta', 2),
        insertStmt.bind('item-3', 'gamma', 3),
      ]);

      const res = await mockDb.prepare('SELECT id, val, ord FROM items ORDER BY ord ASC').all();
      assert.equal(res.results.length, 3);
      assert.deepEqual(res.results.map((r) => r.val), ['alpha', 'beta', 'gamma']);
      assert.deepEqual(res.results.map((r) => r.id), ['item-1', 'item-2', 'item-3']);

      // Ensure original prepared statement can still be bound again independently
      await insertStmt.bind('item-4', 'delta', 4).run();
      const deltaRow = await mockDb.prepare('SELECT val FROM items WHERE id = ?').bind('item-4').first();
      assert.equal(deltaRow.val, 'delta');
    });

    test('T5-MOCK-02: Parameter binding sanitization (boolean and undefined)', async () => {
      const mockDb = createMockD1(':memory:');
      await mockDb.exec('CREATE TABLE test_types (id TEXT PRIMARY KEY, flag_true INT, flag_false INT, opt_undef TEXT, opt_null TEXT)');

      // Bind booleans (true, false) and undefined, ensuring no ERR_INVALID_ARG_TYPE is thrown
      await mockDb
        .prepare('INSERT INTO test_types (id, flag_true, flag_false, opt_undef, opt_null) VALUES (?, ?, ?, ?, ?)')
        .bind('row-1', true, false, undefined, null)
        .run();

      const row = await mockDb.prepare('SELECT * FROM test_types WHERE id = ?').bind('row-1').first();
      assert.ok(row);
      assert.equal(row.id, 'row-1');
      assert.equal(row.flag_true, 1);
      assert.equal(row.flag_false, 0);
      assert.equal(row.opt_undef, null);
      assert.equal(row.opt_null, null);

      // Verify sanitization also works when querying with booleans / undefined
      const queried = await mockDb
        .prepare('SELECT id FROM test_types WHERE flag_true = ? AND opt_undef IS ?')
        .bind(true, undefined)
        .first();
      assert.ok(queried);
      assert.equal(queried.id, 'row-1');
    });

    test('T5-MOCK-03: D1 PreparedStatement .raw() output format', async () => {
      const mockDb = createMockD1(':memory:');
      await mockDb.exec('CREATE TABLE test_raw (id INT, name TEXT, score REAL)');
      await mockDb.exec(`INSERT INTO test_raw VALUES (1, 'Alice', 9.5), (2, 'Bob', 8.0), (3, 'Charlie', 10.0)`);

      // Default raw() returns array of value arrays
      const rawValues = await mockDb.prepare('SELECT id, name, score FROM test_raw ORDER BY id ASC').raw();
      assert.deepEqual(rawValues, [
        [1, 'Alice', 9.5],
        [2, 'Bob', 8.0],
        [3, 'Charlie', 10.0],
      ]);

      // raw({ columnNames: true }) includes column header row
      const rawWithHeaders = await mockDb.prepare('SELECT id, name, score FROM test_raw ORDER BY id ASC').raw({ columnNames: true });
      assert.deepEqual(rawWithHeaders, [
        ['id', 'name', 'score'],
        [1, 'Alice', 9.5],
        [2, 'Bob', 8.0],
        [3, 'Charlie', 10.0],
      ]);

      // Empty query returns empty array
      const rawEmpty = await mockDb.prepare('SELECT * FROM test_raw WHERE id = 9999').raw();
      assert.deepEqual(rawEmpty, []);
    });

    test('T5-MOCK-04: Batch statement reuse on worker schema tables', async () => {
      // Test batch statement reuse on the actual ratings table initialized in test env
      const insertRatingStmt = d1.prepare(
        'INSERT INTO ratings (id, uid, game_key, game_title, score, dropped, drop_reason) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      await d1.batch([
        insertRatingStmt.bind('rev_batch_1', aliceUid, 'game-batch-1', 'Game Batch 1', 7.5, false, undefined),
        insertRatingStmt.bind('rev_batch_2', aliceUid, 'game-batch-2', 'Game Batch 2', 8.5, true, 'Too difficult'),
        insertRatingStmt.bind('rev_batch_3', aliceUid, 'game-batch-3', 'Game Batch 3', 9.5, false, undefined),
      ]);

      const r1 = await d1.prepare('SELECT score, dropped, drop_reason FROM ratings WHERE id = ?').bind('rev_batch_1').first();
      assert.equal(r1.score, 7.5);
      assert.equal(r1.dropped, 0);
      assert.equal(r1.drop_reason, null);

      const r2 = await d1.prepare('SELECT score, dropped, drop_reason FROM ratings WHERE id = ?').bind('rev_batch_2').first();
      assert.equal(r2.score, 8.5);
      assert.equal(r2.dropped, 1);
      assert.equal(r2.drop_reason, 'Too difficult');

      const r3 = await d1.prepare('SELECT score, dropped, drop_reason FROM ratings WHERE id = ?').bind('rev_batch_3').first();
      assert.equal(r3.score, 9.5);
      assert.equal(r3.dropped, 0);
      assert.equal(r3.drop_reason, null);
    });
  });
});
