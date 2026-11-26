import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDb, closeDb, createGame, getGameById } from '../src/main/db.ts';
import {
  configureCloudDb,
  computeGameKey,
  computeGuMatch,
  submitReview,
  deleteMyReview,
  getGameReviews,
  getLeaderboard,
  getMyHardwareProfile,
  setMyHardwareProfile,
  getCurrentPick,
  votePick,
  unvotePick,
  getUserDoc,
  syncLocalReviews,
  updateGameAndSyncReview,
  communityRequest,
} from '../src/main/cloud-db.ts';
import { configureAuth, persistSession, clearSession } from '../src/main/auth.ts';
import { createTestWorkerEnv, createTestSessionToken } from './test-helpers-cloudflare.js';
import worker from '../worker/src/index.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-cloud-${prefix}-`));
}

describe('Cloud DB (Cloudflare Worker REST + D1 SQL leaderboard & picks)', () => {
  let tmpDirs = [];
  let env;
  let d1;
  let r2;
  let calls;
  let sessionToken;
  let userDataDir;

  const newTmp = (prefix) => {
    const dir = makeTempDir(prefix);
    tmpDirs.push(dir);
    return dir;
  };

  beforeEach(async () => {
    initDb(':memory:');
    tmpDirs = [];
    calls = [];
    userDataDir = newTmp('ud');

    const testEnv = await createTestWorkerEnv();
    env = testEnv.env;
    d1 = testEnv.d1;
    r2 = testEnv.r2;

    sessionToken = await createTestSessionToken(
      { uid: 'me-uid', email: 'me@test.vn', displayName: 'Toi' },
      env.SESSION_SECRET
    );

    // Seed my user in D1
    await d1
      .prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`)
      .bind('me-uid', 'me@test.vn', 'Toi')
      .run();

    const fetchImpl = async (url, init = {}) => {
      const recordedHeaders = {};
      if (init.headers) {
        if (typeof init.headers.forEach === 'function') {
          init.headers.forEach((val, key) => {
            recordedHeaders[key.toLowerCase()] = val;
          });
        } else {
          for (const [k, v] of Object.entries(init.headers)) {
            recordedHeaders[k.toLowerCase()] = v;
          }
        }
      }
      calls.push({
        url: String(url),
        method: (init.method || 'GET').toUpperCase(),
        headers: recordedHeaders,
        body: init.body,
      });
      const req = new Request(url, init);
      return worker.fetch(req, env);
    };

    const config = {
      oauthClientId: 'cid',
      oauthClientSecret: 'cs',
      workerApiUrl: 'http://localhost',
    };

    configureAuth({ config, userDataDir, fetchImpl });
    configureCloudDb({ workerApiUrl: 'http://localhost', fetchImpl, userDataDir });

    persistSession(
      {
        sessionToken,
        expiresAt: Date.now() + 3600 * 1000,
        user: {
          uid: 'me-uid',
          email: 'me@test.vn',
          displayName: 'Toi',
          photoUrl: 'https://photo/me',
        },
        google: { accessToken: 'g', refreshToken: 'g-r', expiresAt: Date.now() + 3600 * 1000, scope: 'x' },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );
  });

  afterEach(() => {
    closeDb();
    clearSession({ userDataDir });
    configureCloudDb({ fetchImpl: undefined, workerApiUrl: undefined, projectId: undefined, userDataDir: undefined });
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  test('computeGameKey: steam_id wins, else title slug', () => {
    assert.equal(computeGameKey({ title: 'Elden Ring', steam_id: 1245620 }), '1245620');
    assert.equal(computeGameKey({ title: 'Elden Ring!', steam_id: -1 }), 't_eldenring');
    assert.equal(computeGameKey({ title: 'Hollow Knight', steam_id: null }), 't_hollowknight');
  });

  test('computeGuMatch: Pearson → 0-100, requires min co-rated', () => {
    const mine = new Map([['a', 9], ['b', 7], ['c', 10]]);
    const sameTaste = new Map([['a', 10], ['b', 8], ['c', 10], ['d', 5]]);
    const opposite = new Map([['a', 2], ['b', 3], ['c', 1], ['d', 9]]);
    const fewShared = new Map([['a', 9]]);

    const same = computeGuMatch(mine, sameTaste);
    assert.ok(same !== null && same >= 80, `same taste should be high, got ${same}`);
    const opp = computeGuMatch(mine, opposite);
    assert.ok(opp !== null && opp <= 30, `opposite taste should be low, got ${opp}`);
    assert.equal(computeGuMatch(mine, fewShared), null, '< 3 co-rated → null');
  });

  test('submitReview stores review in D1; getGameReviews reads it back', async () => {
    const game = createGame({
      title: 'Elden Ring',
      steam_id: 1245620,
      playtime_minutes: 900,
      cover_url: 'https://cover/er.jpg',
    });

    // Seed my hardware profile so the review join includes it
    await setMyHardwareProfile({ gpu: 'RTX 3050', cpu: 'Ryzen 5 5600', ramGb: 16 });

    const review = await submitReview(game.id, {
      score: 9.5,
      review: 'Chơi rất đã, tối ưu tốt.',
      dropped: false,
      fps: 60,
    });

    assert.equal(review.uid, 'me-uid');
    assert.equal(review.gameKey, '1245620');
    assert.equal(review.score, 9.5);
    assert.equal(review.fps, 60);
    assert.equal(review.authorHw?.gpu, 'RTX 3050');
    assert.equal(review.authorHw?.cpu, 'Ryzen 5 5600');
    assert.equal(review.authorHw?.ramGb, 16);
    assert.equal(review.playtimeMinutes, 900);

    // Verify Worker HTTP call
    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/games/1245620/reviews'));
    assert.ok(postCall, 'POST /api/games/:gameKey/reviews called');
    assert.equal(postCall.headers['authorization'], `Bearer ${sessionToken}`);
    assert.equal(postCall.headers['content-type'], 'application/json');

    const list = await getGameReviews('1245620');
    assert.equal(list.length, 1);
    assert.equal(list[0].authorName, 'Toi');
    assert.equal(list[0].score, 9.5);
    assert.equal(list[0].fps, 60);
    assert.equal(list[0].authorHw?.gpu, 'RTX 3050');
  });

  test('deleteMyReview removes the review from D1', async () => {
    const game = createGame({ title: 'Delete Target', steam_id: 42 });
    await submitReview(game.id, { score: 7, review: 'ok', dropped: false });

    const beforeReviews = await getGameReviews('42');
    assert.equal(beforeReviews.length, 1);

    const removed = await deleteMyReview(game.id);
    assert.equal(removed, true);

    const deleteCall = calls.find((c) => c.method === 'DELETE' && c.url.includes('/api/games/42/reviews'));
    assert.ok(deleteCall, 'DELETE /api/games/:gameKey/reviews called');
    assert.equal(deleteCall.headers['authorization'], `Bearer ${sessionToken}`);

    const afterReviews = await getGameReviews('42');
    assert.equal(afterReviews.length, 0);
  });

  test('getLeaderboard aggregates avg/dropRate/playtime via SQL in D1', async () => {
    const g1 = createGame({ title: 'Game One', steam_id: 11, playtime_minutes: 600 });
    const g2 = createGame({ title: 'Game Two', steam_id: 22, playtime_minutes: 120 });
    const g3 = createGame({ title: 'Game Three', steam_id: 33, playtime_minutes: 60 });

    await submitReview(g1.id, { score: 9, review: 'hay', dropped: false });
    await submitReview(g2.id, { score: 5, review: 'tệ', dropped: true, dropReason: 'bị lag' });
    await submitReview(g3.id, { score: 7, review: 'tạm', dropped: false });

    // Seed other users and ratings directly into D1
    await d1.prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`).bind('other1', 'o1@test.vn', 'Ban 1').run();
    await d1.prepare(`INSERT INTO users (uid, email, display_name) VALUES (?, ?, ?)`).bind('other2', 'o2@test.vn', 'Ban 2').run();

    await d1.prepare(`
      INSERT INTO ratings (id, uid, game_key, game_title, score, review, dropped, playtime_minutes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind('other1_11', 'other1', '11', 'Game One', 8, '', 0, 100, new Date().toISOString()).run();

    await d1.prepare(`
      INSERT INTO ratings (id, uid, game_key, game_title, score, review, dropped, playtime_minutes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind('other1_22', 'other1', '22', 'Game Two', 4, '', 0, 100, new Date().toISOString()).run();

    await d1.prepare(`
      INSERT INTO ratings (id, uid, game_key, game_title, score, review, dropped, playtime_minutes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind('other2_11', 'other2', '11', 'Game One', 10, '', 0, 100, new Date().toISOString()).run();

    const entries = await getLeaderboard();
    assert.equal(entries.length, 3);

    const gameOne = entries.find((e) => e.gameKey === '11');
    assert.ok(gameOne);
    assert.equal(gameOne.reviewCount, 3);
    assert.equal(gameOne.avgScore, 9); // (9 + 8 + 10) / 3
    assert.equal(gameOne.dropRate, 0);
    assert.equal(gameOne.myScore, 9);

    const gameTwo = entries.find((e) => e.gameKey === '22');
    assert.ok(gameTwo);
    assert.equal(gameTwo.reviewCount, 2);
    assert.equal(gameTwo.dropRate, 0.5); // 1 dropped out of 2
  });

  test('votePick casts vote in D1, unvotePick removes vote', async () => {
    const game = createGame({ title: 'Club Game', steam_id: 77 });

    // Seed another user's vote directly in D1
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await d1.prepare(`
      INSERT INTO community_votes (id, month, uid, game_key, game_title, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`${month}_otherUid`, month, 'otherUid', '88', 'Other Game', now.toISOString()).run();

    const result = await votePick(game);
    assert.equal(result.votes['me-uid'], '77');
    assert.equal(result.votes['otherUid'], '88', "other user's vote survives concurrently");

    const voteCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/picks/vote'));
    assert.ok(voteCall);
    assert.equal(voteCall.headers['authorization'], `Bearer ${sessionToken}`);

    const current = await getCurrentPick();
    assert.ok(current);
    assert.equal(current.votes['me-uid'], '77');

    const unvoteResult = await unvotePick();
    assert.equal(unvoteResult.votes['me-uid'], undefined, 'my vote removed');
    assert.equal(unvoteResult.votes['otherUid'], '88');

    const afterUnvote = await getCurrentPick();
    assert.equal(afterUnvote.votes['me-uid'], undefined);
    assert.equal(afterUnvote.votes['otherUid'], '88');
  });

  test('getMyHardwareProfile returns null when unset, object after set', async () => {
    assert.equal(await getMyHardwareProfile(), null);

    const saved = await setMyHardwareProfile({ gpu: 'GTX 1050', cpu: 'i5', ramGb: 8 });
    assert.equal(saved.gpu, 'GTX 1050');
    assert.equal(saved.cpu, 'i5');
    assert.equal(saved.ramGb, 8);

    const putCall = calls.find((c) => c.method === 'PUT' && c.url.includes('/api/users/me/hardware'));
    assert.ok(putCall);
    assert.equal(putCall.headers['authorization'], `Bearer ${sessionToken}`);

    const loaded = await getMyHardwareProfile();
    assert.ok(loaded);
    assert.equal(loaded.gpu, 'GTX 1050');
    assert.equal(loaded.ramGb, 8);
  });

  test('getUserDoc returns user profile with .hw compatibility object', async () => {
    await setMyHardwareProfile({ gpu: 'RTX 4090', cpu: 'i9-14900K', ramGb: 64 });

    const doc = await getUserDoc('me-uid');
    assert.ok(doc);
    assert.equal(doc.uid, 'me-uid');
    assert.equal(doc.gpu, 'RTX 4090');
    assert.equal(doc.hw?.gpu, 'RTX 4090');
    assert.equal(doc.hw?.cpu, 'i9-14900K');
    assert.equal(doc.hw?.ramGb, 64);
  });

  test('local scores and notes are uploaded to rankings and post history without duplicate reviews', async () => {
    const game = createGame({ title: 'Local Review', steam_id: 777, user_rating: 8.5, notes: 'Saved local review', playtime_minutes: 60 });
    const first = await syncLocalReviews();
    assert.equal(first.state, 'synced');
    assert.equal(first.synced, 1);
    const rankings = await communityRequest('/api/community/rankings?sort=score');
    assert.equal(rankings.items[0].averageScore, 8.5);
    const posts = await communityRequest('/api/community/posts?uid=me-uid');
    assert.equal(posts.items[0].body, 'Saved local review');
    assert.equal((await syncLocalReviews()).synced, 0);
    const updated = await updateGameAndSyncReview(game.id, { notes: 'Updated', user_rating: 9 });
    assert.equal(updated.reviewSync.state, 'synced');
    assert.equal((await getGameReviews('777'))[0].review, 'Updated');
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM ratings').get().n, 1);
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM community_posts').get().n, 1);
    await updateGameAndSyncReview(game.id, { user_rating: null });
    assert.equal((await getGameReviews('777')).length, 0);
    assert.equal(d1.sqlite.prepare("SELECT user_score FROM user_library WHERE uid='me-uid' AND game_key='777'").get().user_score, null);
    assert.equal((await syncLocalReviews()).synced, 0);
  });

  test('unscored notes save privately to the server without creating a ranking', async () => {
    const game = createGame({ title: 'Notes Only', steam_id: 780 });
    await updateGameAndSyncReview(game.id, { notes: 'Private until scored' });
    assert.equal(d1.sqlite.prepare("SELECT user_notes FROM user_library WHERE uid='me-uid' AND game_key='780'").get().user_notes, 'Private until scored');
    assert.equal((await communityRequest('/api/community/rankings?sort=score')).items.length, 0);
  });

  test('failed cloud saves retain local changes and retry after connection returns', async () => {
    const game = createGame({ title: 'Retry Review', steam_id: 778 });
    configureCloudDb({ fetchImpl: async () => { throw new Error('offline'); } });
    const saved = await updateGameAndSyncReview(game.id, { user_rating: 7, notes: 'Keep this' });
    assert.equal(saved.reviewSync.state, 'pending');
    assert.equal(getGameById(game.id).notes, 'Keep this');
    configureCloudDb({ fetchImpl: async (url, init) => worker.fetch(new Request(url, init), env) });
    assert.equal((await syncLocalReviews()).state, 'synced');
    assert.equal((await getGameReviews('778'))[0].review, 'Keep this');
  });

  test('bulk review sync handles more than the individual review rate limit', async () => {
    for (let i = 0; i < 60; i++) createGame({ title: `Rated ${i}`, steam_id: 1000 + i, user_rating: 8 });
    const result = await syncLocalReviews();
    assert.equal(result.synced, 60);
    assert.equal(result.state, 'synced');
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM ratings').get().n, 60);
  });

  test('signed-out edits remain local and public review edits update the same local game', async () => {
    const game = createGame({ title: 'Same Game', steam_id: 779 });
    await communityRequest('/api/community/games/779/reviews', 'POST', { title: game.title, score: 9, review: 'Public edit' });
    assert.equal(getGameById(game.id).user_rating, 9);
    assert.equal(getGameById(game.id).notes, 'Public edit');
    await communityRequest('/api/community/games/779/reviews', 'DELETE');
    assert.equal(getGameById(game.id).user_rating, null);
    clearSession({ userDataDir });
    const saved = await updateGameAndSyncReview(game.id, { user_rating: 7 });
    assert.equal(saved.reviewSync.state, 'signed_out');
    assert.equal(getGameById(game.id).user_rating, 7);
  });

  test('unauthenticated mutations reject with error', async () => {
    clearSession({ userDataDir });
    const game = createGame({ title: 'Auth Required Game', steam_id: 101 });

    await assert.rejects(
      () => submitReview(game.id, { score: 8, review: 'hay', dropped: false }),
      /Chưa đăng nhập/
    );

    await assert.rejects(
      () => votePick(game),
      /Chưa đăng nhập/
    );

    await assert.rejects(
      () => setMyHardwareProfile({ gpu: 'g', cpu: 'c', ramGb: 16 }),
      /Chưa đăng nhập/
    );
  });
});
