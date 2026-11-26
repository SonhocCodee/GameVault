import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../worker/src/index.ts';
import { refreshSharedLibrary } from '../worker/src/community-common.ts';
import { createMockD1, createTestWorkerEnv, createTestSessionToken } from './test-helpers-cloudflare.js';

async function fixture() {
  const { env, d1 } = await createTestWorkerEnv();
  const tokens = {};
  for (const uid of ['alice', 'bob']) {
    tokens[uid] = await createTestSessionToken({ uid, email: `${uid}@example.com`, displayName: uid }, env.SESSION_SECRET);
    d1.sqlite.prepare('INSERT INTO users(uid,email,display_name) VALUES (?,?,?)').run(uid, `${uid}@example.com`, uid);
  }
  const api = (path, method = 'GET', body, uid) => worker.fetch(new Request(`https://example.com/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${tokens[uid]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const sync = async (items, uid = 'alice', extra = {}) => {
    const response = await api('/library/sync', 'POST', { items, ...extra }, uid);
    assert.equal(response.status, 200);
    return response.json();
  };
  const changes = () => Number(d1.sqlite.prepare('SELECT total_changes() AS n').get().n);
  return { env, d1, api, sync, changes };
}

const game = {
  gameKey: '814380', steamId: 814380, title: 'Sekiro', status: 'completed',
  playtimeMinutes: 100, recordedPlaytimeMinutes: 20, clientUpdatedAt: '2026-11-01T00:00:00Z',
};

test('provenance migration preserves every existing baseline, total, completion date and session', async () => {
  const d1 = createMockD1();
  const schema = fs.readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8')
    .replace(/^\s*recorded_playtime_minutes INTEGER NOT NULL DEFAULT 0,\r?\n/gm, '');
  await d1.exec(schema);
  d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes,completed_at,is_deleted) VALUES ('alice','old','Old','completed',123,'2020-01-02',0),('alice','deleted','Deleted','completed',456,NULL,1)").run();
  d1.sqlite.prepare("INSERT INTO community_library(uid,game_key,title,status,playtime_minutes) VALUES ('alice','old','Old','completed',123)").run();
  d1.sqlite.prepare("INSERT INTO user_sessions(uid,game_key,source,start_time,duration_minutes) VALUES ('alice','old','tracker','2020-01-01',23)").run();
  await d1.exec(fs.readFileSync(new URL('../worker/migrations/0008_playtime_provenance.sql', import.meta.url), 'utf8'));
  const rows = d1.sqlite.prepare('SELECT playtime_minutes,recorded_playtime_minutes,completed_at,is_deleted FROM user_library ORDER BY game_key').all();
  assert.deepEqual(rows.map(r => [r.playtime_minutes, r.recorded_playtime_minutes, r.completed_at, r.is_deleted]), [[456, 456, null, 1], [123, 123, '2020-01-02', 0]]);
  assert.equal(d1.sqlite.prepare('SELECT recorded_playtime_minutes FROM community_library').get().recorded_playtime_minutes, 123);
  assert.equal(d1.sqlite.prepare('SELECT duration_minutes FROM user_sessions').get().duration_minutes, 23);
});

test('display totals include manual time while all hour rankings use only recorded time', async () => {
  const f = await fixture();
  const data = await f.sync([game]);
  assert.equal(data.games[0].playtimeMinutes, 100);
  assert.equal(data.games[0].recordedPlaytimeMinutes, 20);
  assert.equal(data.games[0].completedAt, null, 'Self-declared completion must not invent a date');
  assert.equal(data.stats.totalPlaytimeMinutes, 100);
  assert.equal(data.stats.recordedMinutes, 20);
  await f.sync([{ ...game, title: 'Sekiro', status: 'playing', playtimeMinutes: 30, recordedPlaytimeMinutes: 30 }], 'bob');
  await f.sync([{ ...game, gameKey: '292030', steamId: 292030, title: 'The Witcher 3', playtimeMinutes: 60, recordedPlaytimeMinutes: 60 }], 'bob');

  const beforeReads = f.changes();
  const me = await (await f.api('/community/me', 'GET', undefined, 'alice')).json();
  const profile = await (await f.api('/community/profiles/alice')).json();
  for (const p of [me, profile]) {
    assert.equal(p.totalMinutes, 100);
    assert.equal(p.recordedMinutes, 20);
    assert.equal(p.completedGames, 1);
  }
  assert.equal(profile.games[0].recordedPlaytimeMinutes, 20);
  const players = await (await f.api('/community/players?sort=hours&includeTopGames=1')).json();
  assert.deepEqual(players.items.map(p => p.uid), ['bob', 'alice']);
  assert.equal(players.items[1].totalMinutes, 100);
  assert.equal(players.items[1].recordedMinutes, 20);
  assert.equal(players.items[1].topGames[0].recordedPlaytimeMinutes, 20);
  const gamePlayers = await (await f.api('/community/games/814380/players')).json();
  assert.deepEqual(gamePlayers.items.map(p => p.uid), ['bob', 'alice']);
  assert.equal(gamePlayers.items[1].playtimeMinutes, 100);
  assert.equal(gamePlayers.items[1].recordedPlaytimeMinutes, 20);
  const games = await (await f.api('/community/rankings?sort=hours')).json();
  assert.equal(games.items[0].gameKey, '292030', 'More recorded time outranks a larger manual-inclusive total');
  const sekiro = games.items.find(g => g.gameKey === '814380');
  assert.equal(sekiro.totalMinutes, 130);
  assert.equal(sekiro.recordedMinutes, 50);
  assert.equal(f.changes(), beforeReads, 'Reading profiles and rankings must not write provenance');

  await f.sync([{ ...game, playtimeMinutes: 9999, clientUpdatedAt: '2026-11-02T00:00:00Z' }]);
  const afterManual = await (await f.api('/community/players?sort=hours')).json();
  assert.deepEqual(afterManual.items.map(p => p.uid), ['bob', 'alice']);
  assert.equal(afterManual.items[1].totalMinutes, 9999);
  assert.equal(afterManual.items[1].recordedMinutes, 20);
});

test('legacy clients retain their accepted baseline without making new manual increases eligible', async () => {
  const f = await fixture();
  f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes,recorded_playtime_minutes,client_updated_at) VALUES ('alice','814380','Sekiro','completed',100,100,'2026-10-01T00:00:00Z')").run();
  const { recordedPlaytimeMinutes, ...legacy } = game;
  let data = await f.sync([{ ...legacy, playtimeMinutes: 9999 }]);
  assert.equal(data.games[0].playtimeMinutes, 9999);
  assert.equal(data.games[0].recordedPlaytimeMinutes, 100);
  data = await f.sync([{ ...legacy, gameKey: 'new', steamId: null, playtimeMinutes: 500 }]);
  assert.equal(data.games.find(g => g.gameKey === 'new').recordedPlaytimeMinutes, 0);
  data = await f.sync([{ ...legacy, playtimeMinutes: 9999 }], 'alice', { mode: 'overwrite' });
  assert.equal(data.games[0].recordedPlaytimeMinutes, 100, 'A legacy overwrite must retain the accepted baseline');
});

test('new provenance is finite and clamped; recorded progress merges independently of the latest manual adjustment', async () => {
  const f = await fixture();
  for (const [index, value, expected] of [[0, 500, 100], [1, -10, 0], [2, null, 0], [3, '20', 0]]) {
    const data = await f.sync([{ ...game, gameKey: `clamp-${index}`, steamId: null, recordedPlaytimeMinutes: value }]);
    assert.equal(data.games.find(g => g.gameKey === `clamp-${index}`).recordedPlaytimeMinutes, expected);
  }
  await f.sync([game]);
  let data = await f.sync([{ ...game, playtimeMinutes: 90, recordedPlaytimeMinutes: 30, clientUpdatedAt: '2026-11-03T00:00:00Z' }]);
  assert.equal(data.games.find(g => g.gameKey === game.gameKey).playtimeMinutes, 90, 'A newer manual correction may reduce only the manual portion');
  const stale = { ...game, playtimeMinutes: 50, recordedPlaytimeMinutes: 40, clientUpdatedAt: '2026-11-02T00:00:00Z' };
  data = await f.sync([stale]);
  const merged = data.games.find(g => g.gameKey === game.gameKey);
  assert.equal(merged.recordedPlaytimeMinutes, 40);
  assert.equal(merged.playtimeMinutes, 100, 'New recorded progress preserves the newer 60-minute manual portion');
  const before = f.changes();
  await f.sync([stale]);
  assert.equal(f.changes(), before, 'A repeated stale payload must also be a no-op');
});

test('repeated sync and shared-library publication do not rewrite unchanged rows or sessions', async () => {
  const f = await fixture();
  const extra = { sessions: [{ gameKey: game.gameKey, source: 'tracker', startTime: '2026-11-01T00:00:00Z', endTime: '2026-11-01T00:20:00Z', durationMinutes: 20 }] };
  await f.sync([game], 'alice', extra);
  const before = f.changes();
  await f.sync([game], 'alice', extra);
  await refreshSharedLibrary(f.env, 'alice');
  assert.equal(f.changes(), before);
  assert.equal(f.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 1);
  await f.sync([{ ...game, recordedPlaytimeMinutes: 25 }]);
  assert.equal(f.d1.sqlite.prepare("SELECT recorded_playtime_minutes FROM community_library WHERE uid='alice'").get().recorded_playtime_minutes, 25, 'A provenance-only change is not skipped');
});
