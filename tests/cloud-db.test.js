import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDb, closeDb, createGame } from '../src/main/db.ts';
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
} from '../src/main/cloud-db.ts';
import { configureAuth, persistSession, clearSession } from '../src/main/auth.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-cloud-${prefix}-`));
}

const CONFIG = {
  oauthClientId: 'cid',
  oauthClientSecret: 'cs',
  firebaseApiKey: 'fkey',
  firebaseProjectId: 'proj',
};

const MY_SESSION = {
  firebase: {
    idToken: 'fb-token',
    refreshToken: 'fb-refresh',
    expiresAt: Date.now() + 3600 * 1000, // valid — no refresh needed
    localId: 'me-uid',
    email: 'me@test.vn',
    displayName: 'Toi',
    photoUrl: 'https://photo/me',
  },
  google: { accessToken: 'g', refreshToken: 'g-r', expiresAt: Date.now() + 3600 * 1000, scope: 'x' },
  updatedAt: new Date().toISOString(),
};

/** Tiny Firestore REST emulator for the shapes cloud-db.ts actually uses. */
function firestoreEmulator({ initialDocs = {} } = {}) {
  const calls = [];
  const docs = { ...initialDocs }; // "projects/proj/.../documents/ratings/x" → {fields}
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const method = (init.method || 'GET').toUpperCase();

    if (url.includes(':runQuery')) {
      const query = JSON.parse(init.body || '{}');
      const collection = query.structuredQuery?.from?.[0]?.collectionId || '';
      const where = query.structuredQuery?.where?.fieldFilter;
      const rows = Object.entries(docs)
        .filter(([key, doc]) => {
          if (!key.startsWith(`${collection}/`)) return false;
          if (!where) return true;
          const field = where.field.fieldPath;
          const expected = where.value.stringValue;
          return String(doc.fields[field]?.stringValue || '') === expected;
        })
        .map(([key, doc]) => ({ document: { name: `projects/proj/databases/(default)/documents/${key}`, fields: doc.fields } }));
      return { ok: true, status: 200, json: async () => rows };
    }

    const m = /documents\/([a-zA-Z]+)\/([^:?]+)/.exec(url);
    const collection = m?.[1];
    const docId = m?.[2];

    const key = `${collection}/${docId}`;
    if (method === 'GET') {
      if (!docs[key]) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ name: key, fields: docs[key].fields }) };
    }
    if (method === 'DELETE') {
      const existed = Boolean(docs[key]);
      delete docs[key];
      return { ok: existed || true, status: 200, json: async () => ({}) };
    }
    if (method === 'PATCH' || method === 'POST') {
      const body = JSON.parse(init.body || '{}');
      if (!docs[key]) docs[key] = { fields: {} };
      const maskMatch = /updateMask\.fieldPaths=([^&]+)/.exec(url);
      if (maskMatch) {
        // Firestore semantics: updateMask.fieldPaths lists LEAF paths — only
        // those leaves are written; sibling leaves survive untouched.
        const leafPath = decodeURIComponent(maskMatch[1]).split('.');
        let leafValue = body.fields;
        for (const part of leafPath) {
          if (!leafValue) break;
          if (leafValue.mapValue) leafValue = leafValue.mapValue.fields?.[part];
          else leafValue = leafValue[part];
        }
        const isDelete = leafValue && 'nullValue' in leafValue;
        let cursor = docs[key].fields;
        for (let i = 0; i < leafPath.length - 1; i++) {
          const part = leafPath[i];
          if (!cursor[part]) cursor[part] = { mapValue: { fields: {} } };
          cursor = cursor[part].mapValue.fields;
        }
        const last = leafPath[leafPath.length - 1];
        if (isDelete) delete cursor[last];
        else cursor[last] = leafValue;
      } else {
        docs[key].fields = body.fields;
      }
      return { ok: true, status: 200, json: async () => ({ name: key, fields: docs[key].fields }) };
    }
    return { ok: false, status: 405, json: async () => ({}) };
  };
  return { impl, calls, docs };
}

describe('Cloud DB (Firestore REST + leaderboard + taste-match)', () => {
  let tmpDirs = [];
  let emulator;

  const newTmp = (prefix) => {
    const dir = makeTempDir(prefix);
    tmpDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    initDb(':memory:');
    tmpDirs = [];
    clearSession();
    const userDataDir = newTmp('ud');
    emulator = firestoreEmulator();
    configureAuth({ config: CONFIG, userDataDir, fetchImpl: emulator.impl });
    configureCloudDb({ projectId: 'proj', fetchImpl: emulator.impl, userDataDir });
    persistSession(MY_SESSION, { userDataDir });
  });

  afterEach(() => {
    closeDb();
    clearSession();
    configureCloudDb({ fetchImpl: undefined, projectId: undefined, userDataDir: undefined });
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

  test('submitReview stores denormalized doc; getGameReviews reads it back', async () => {
    const game = createGame({
      title: 'Elden Ring',
      steam_id: 1245620,
      playtime_minutes: 900,
      cover_url: 'https://cover/er.jpg',
    });
    // Seed my user doc (hw profile) so the review embeds it
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
    assert.equal(review.playtimeMinutes, 900);

    const docKey = 'ratings/me-uid_1245620';
    assert.ok(emulator.docs[docKey], 'doc id = uid_gameKey');
    assert.equal(emulator.docs[docKey].fields.gameKey.stringValue, '1245620');

    const list = await getGameReviews('1245620');
    assert.equal(list.length, 1);
    assert.equal(list[0].authorName, 'Toi');
    assert.equal(list[0].score, 9.5);
  });

  test('deleteMyReview removes the doc', async () => {
    const game = createGame({ title: 'Delete Target', steam_id: 42 });
    await submitReview(game.id, { score: 7, review: 'ok', dropped: false });
    assert.ok(emulator.docs['ratings/me-uid_42']);

    const removed = await deleteMyReview(game.id);
    assert.equal(removed, true);
    assert.equal(emulator.docs['ratings/me-uid_42'], undefined);
  });

  test('getLeaderboard aggregates avg/dropRate and computes taste-match', async () => {
    // Three games, three reviewers (me + 2 others); me and other1 co-rate 3
    // games so taste-match is meaningful (≥3 shared)
    const g1 = createGame({ title: 'Game One', steam_id: 11, playtime_minutes: 600 });
    const g2 = createGame({ title: 'Game Two', steam_id: 22, playtime_minutes: 120 });
    const g3 = createGame({ title: 'Game Three', steam_id: 33, playtime_minutes: 60 });

    await setMyHardwareProfile({ gpu: 'RTX 3050', cpu: 'R5', ramGb: 16 });
    await submitReview(g1.id, { score: 9, review: 'hay', dropped: false });
    await submitReview(g2.id, { score: 5, review: 'tệ', dropped: true, dropReason: 'bị lag' });
    await submitReview(g3.id, { score: 7, review: 'tạm', dropped: false });

    const mk = (uid, name, gameKey, score, extra = {}) => ({
      fields: {
        uid: { stringValue: uid },
        gameKey: { stringValue: String(gameKey) },
        gameTitle: { stringValue: `Game ${gameKey}` },
        score: { integerValue: String(score) },
        review: { stringValue: '' },
        dropped: { booleanValue: false },
        playtimeMinutes: { integerValue: '100' },
        updatedAt: { stringValue: new Date().toISOString() },
        authorName: { stringValue: name },
        authorPhoto: { stringValue: '' },
        ...extra,
      },
    });

    // other1 tracks my taste closely (and does NOT drop game 22); other2 diverges
    emulator.docs['ratings/other1_11'] = mk('other1', 'Ban 1', 11, 8);
    emulator.docs['ratings/other1_22'] = mk('other1', 'Ban 1', 22, 4);
    emulator.docs['ratings/other1_33'] = mk('other1', 'Ban 1', 33, 6);
    emulator.docs['ratings/other2_11'] = mk('other2', 'Ban 2', 11, 10);

    const entries = await getLeaderboard();
    assert.equal(entries.length, 3);

    const gameOne = entries.find((e) => e.gameKey === '11');
    assert.equal(gameOne.reviewCount, 3);
    assert.equal(gameOne.avgScore, 9); // (9+8+10)/3
    assert.equal(gameOne.dropRate, 0);
    assert.equal(gameOne.myScore, 9);
    assert.ok(gameOne.guMatchScore !== null && gameOne.guMatchScore >= 80, `taste-match should be high, got ${gameOne.guMatchScore}`);

    const gameTwo = entries.find((e) => e.gameKey === '22');
    assert.equal(gameTwo.reviewCount, 2);
    assert.equal(gameTwo.dropRate, 0.5); // me + other1 both dropped
  });

  test('votePick merges only my field; concurrent votes survive', async () => {
    const game = createGame({ title: 'Club Game', steam_id: 77 });
    emulator.docs['picks/2099-01'] = {
      fields: {
        month: { stringValue: '2099-01' },
        gameKey: { stringValue: '88' },
        gameTitle: { stringValue: 'Other Game' },
        state: { stringValue: 'voting' },
        votes: { mapValue: { fields: { otherUid: { stringValue: '88' } } } },
      },
    };

    // Note: votePick uses current month — seed that key dynamically
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    emulator.docs[`picks/${month}`] = {
      fields: {
        month: { stringValue: month },
        gameKey: { stringValue: '88' },
        gameTitle: { stringValue: 'Other Game' },
        state: { stringValue: 'voting' },
        votes: { mapValue: { fields: { otherUid: { stringValue: '88' } } } },
      },
    };

    const result = await votePick(game);
    assert.equal(result.votes['me-uid'], '77');
    assert.equal(result.votes['otherUid'], '88', 'other user\'s vote must survive the merge');

    const merged = await getCurrentPick();
    assert.equal(merged.votes['me-uid'], '77');

    await unvotePick();
    const after = await getCurrentPick();
    assert.equal(after.votes['me-uid'], undefined, 'my vote removed');
    assert.equal(after.votes['otherUid'], '88');
  });

  test('votePick creates the pick doc when nobody voted yet', async () => {
    const game = createGame({ title: 'First Pick', steam_id: 99 });
    const result = await votePick(game);
    assert.equal(result.votes['me-uid'], '99');
    assert.equal(result.state, 'voting');
  });

  test('getMyHardwareProfile returns null when unset, object after set', async () => {
    assert.equal(await getMyHardwareProfile(), null);
    const saved = await setMyHardwareProfile({ gpu: 'GTX 1050', cpu: 'i5', ramGb: 8 });
    assert.equal(saved.gpu, 'GTX 1050');
    const loaded = await getMyHardwareProfile();
    assert.equal(loaded.ramGb, 8);
  });
});
