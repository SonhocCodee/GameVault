import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../worker/src/index.ts";
import { createTestWorkerEnv, createMockD1, createTestSessionToken } from "./test-helpers-cloudflare.js";
import { getMonthlyRankings, mergedMinutes, sessionTimestamp } from "../worker/src/monthly-rankings.ts";
import { currentRankingMonth, rankingMonthBounds, rankingMonths, monthlyRatingScore } from "../src/shared/monthly.ts";

const now = new Date("2026-12-15T12:00:00Z");
async function fixture() {
  const { env, d1 } = await createTestWorkerEnv();
  const db = d1.sqlite;
  const user = (uid, share = 1, suspended = 0) => {
    db.prepare("INSERT INTO users(uid) VALUES (?)").run(uid);
    db.prepare("INSERT INTO community_profiles(uid,nickname,share_library,suspended) VALUES (?,?,?,?)").run(uid, uid, share, suspended);
  };
  const game = (gameKey, classification, title = gameKey) => {
    const steamId = /^\d+$/.test(gameKey) ? Number(gameKey) : null;
    db.prepare("INSERT INTO game_covers(game_key,title,steam_id) VALUES (?,?,?)").run(gameKey, title, steamId);
    db.prepare("INSERT INTO game_metadata(game_key,title,classification,source,confidence) VALUES (?,?,?,'manual',1)").run(gameKey, title, classification);
  };
  const library = (uid, key) => {
    db.prepare("INSERT INTO community_library(uid,game_key,title,status,playtime_minutes) VALUES (?,?,?,'playing',999999)").run(uid, key, key);
  };
  const session = (uid, key, start, duration, source = "tracker", end = null) => {
    db.prepare("INSERT INTO user_sessions(uid,game_key,source,start_time,end_time,duration_minutes) VALUES (?,?,?,?,?,?)").run(uid, key, source, start, end, duration);
  };
  const rating = (uid, key, score, at = "2026-11-10 12:00:00") => {
    db.prepare("INSERT INTO ratings(id,uid,game_key,game_title,score,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(`${uid}_${key}`, uid, key, key, score, at, at);
  };
  return { env, db, user, game, library, session, rating, board: (month = "2026-11") => getMonthlyRankings(env, month, 20, now) };
}

test("months start in November 2026 and use Vietnam boundaries including New Year", () => {
  assert.equal(currentRankingMonth(new Date("2026-11-30T17:00:00Z")), "2026-12");
  assert.equal(currentRankingMonth(new Date("2026-12-31T16:59:59Z")), "2026-12");
  assert.deepEqual(rankingMonths("2027-02"), ["2027-02", "2027-01", "2026-12", "2026-11"]);
  const bounds = rankingMonthBounds("2026-11");
  assert.equal(new Date(bounds.start).toISOString(), "2026-10-31T17:00:00.000Z");
  assert.equal(new Date(bounds.end).toISOString(), "2026-11-30T17:00:00.000Z");
  assert.equal(rankingMonthBounds("2026-13"), null);
  assert.equal(sessionTimestamp("2026-11-01 00:00:00"), Date.parse("2026-10-31T17:00:00Z"));
});

test("online ranks only the selected month's recorded hours, never lifetime or manual totals", async () => {
  const f = await fixture();
  f.user("a");
  for (const key of ["10", "20"]) { f.game(key, "online"); f.library("a", key); }
  f.session("a", "10", "2026-11-04T08:00:00", 120);
  f.session("a", "10", "2026-10-04T08:00:00", 9000);
  f.session("a", "20", "2026-11-05T08:00:00", 60);
  f.session("a", "20", "2026-11-06T08:00:00", 9000, "manual");
  f.rating("a", "20", 10);
  const result = await f.board();
  assert.deepEqual(result.online.map(g => [g.gameKey, g.totalMinutes, g.players]), [["10", 120, 1], ["20", 60, 1]]);
  assert.equal(result.singlePlayer.length, 0);
});

test("cross-month sessions split at GMT+7 and overlapping sources and aliases count once", async () => {
  const f = await fixture();
  f.user("a"); f.game("10", "online"); f.library("a", "10");
  f.session("a", "10", "2026-11-30T23:30:00", 60, "tracker", "2026-12-01T00:30:00");
  f.session("a", "s_10", "2026-11-30T16:30:00Z", 60, "amd_import", "2026-11-30T17:30:00Z");
  f.session("a", "10", "2026-11-30T23:45:00", 15, "amd_import");
  assert.equal((await f.board("2026-11")).online[0].totalMinutes, 30);
  assert.equal((await f.board("2026-12")).online[0].totalMinutes, 30);
  assert.equal(mergedMinutes([[0, 60000], [30000, 90000], [120000, 180000]]), 2.5);
});

test("single-player ratings ignore hours and include one valid review", async () => {
  const f = await fixture();
  f.user("a");
  for (const key of ["10", "20", "30"]) { f.game(key, "offline"); f.library("a", key); }
  f.rating("a", "10", 8); f.rating("a", "20", 10);
  f.session("a", "10", "2026-11-02T00:00:00", 4800);
  f.session("a", "20", "2026-11-02T00:00:00", 1200);
  f.session("a", "30", "2026-11-02T00:00:00", 12000);
  const result = await f.board();
  assert.deepEqual(result.singlePlayer.map(g => g.gameKey), ["20", "10"]);
  assert.equal(result.singlePlayer[0].rankingScore, 7.5);
  assert.equal(result.singlePlayer[0].reviewCount, 1);
  assert.equal(result.singlePlayer[0].averageScore, 10);
});

test("review confidence balances a lone perfect score against many strong ratings", async () => {
  const f = await fixture();
  f.game("10", "offline"); f.game("20", "hybrid");
  f.user("solo"); f.rating("solo", "10", 10);
  for (let i = 0; i < 30; i++) { f.user(`p${i}`); f.rating(`p${i}`, "20", 9.3); }
  const result = await f.board();
  assert.deepEqual(result.singlePlayer.map(g => g.gameKey), ["20", "10"]);
  assert.equal(result.singlePlayer[0].reviewCount, 30);
  assert.ok(Math.abs(result.singlePlayer[0].rankingScore - monthlyRatingScore(9.3, 30)) < 1e-9);
});

test("one player has one vote across Steam aliases and hidden alias reviews cannot leak", async () => {
  const f = await fixture();
  f.user("a"); f.game("10", "offline");
  f.rating("a", "10", 8, "2026-11-10 12:00:00");
  f.rating("a", "s_10", 9, "2026-11-11 12:00:00");
  let result = await f.board();
  assert.equal(result.singlePlayer[0].reviewCount, 1);
  assert.equal(result.singlePlayer[0].averageScore, 9);
  f.db.prepare("INSERT INTO community_review_meta(uid,game_key,hidden) VALUES ('a','10',1)").run();
  result = await f.board();
  assert.equal(result.singlePlayer.length, 0);
});

test("historical months use the rating before month end, including late synced activity", async () => {
  const f = await fixture();
  f.user("a"); f.game("10", "offline"); f.library("a", "10");
  f.rating("a", "10", 9, "2026-10-10 12:00:00");
  assert.equal((await f.board()).singlePlayer.length, 0);
  f.session("a", "10", "2026-11-12T08:00:00", 120);
  f.db.prepare("INSERT INTO community_rating_history(uid,game_key,game_title,score,effective_at) VALUES ('a','10','10',2,'2026-12-05 12:00:00')").run();
  assert.equal((await f.board("2026-11")).singlePlayer[0].averageScore, 9);
  assert.equal((await f.board("2026-12")).singlePlayer[0].averageScore, 2);
});

test("private sessions, suspended users, manual-only activity and unknown classification stay out of boards", async () => {
  const f = await fixture();
  f.user("private", 0); f.user("suspended", 1, 1); f.user("public");
  f.game("10", "online"); f.game("20", "unknown"); f.game("30", "offline");
  for (const uid of ["private", "suspended"]) { f.library(uid, "10"); f.session(uid, "10", "2026-11-12T08:00:00", 9999); }
  f.rating("suspended", "30", 10);
  f.library("public", "20"); f.session("public", "20", "2026-11-12T08:00:00", 120);
  f.library("public", "30"); f.session("public", "30", "2026-11-12T08:00:00", 120, "manual");
  f.rating("public", "30", 9, "2026-10-10 12:00:00");
  const result = await f.board();
  assert.equal(result.online.length, 0);
  assert.equal(result.singlePlayer.length, 0);
  assert.equal(result.unclassifiedCount, 1);
});

test("rating history migration seeds existing data and records changes/deletions without duplicate sync votes", async () => {
  const d1 = createMockD1();
  const schema = fs.readFileSync("worker/schema.sql", "utf8").split("-- Keep score changes")[0];
  await d1.exec(schema);
  d1.sqlite.prepare("INSERT INTO users(uid) VALUES ('a')").run();
  d1.sqlite.prepare("INSERT INTO ratings(id,uid,game_key,game_title,score,updated_at) VALUES ('a_10','a','10','Game',8,'2026-11-10 12:00:00')").run();
  const migration = fs.readFileSync("worker/migrations/0009_monthly_rankings.sql", "utf8");
  await d1.exec(migration);
  await d1.exec(migration);
  d1.sqlite.prepare("UPDATE ratings SET updated_at=datetime('now') WHERE id='a_10'").run();
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS n FROM community_rating_history").get().n, 1);
  d1.sqlite.prepare("UPDATE ratings SET score=9 WHERE id='a_10'").run();
  d1.sqlite.prepare("DELETE FROM ratings WHERE id='a_10'").run();
  assert.deepEqual(d1.sqlite.prepare("SELECT score FROM community_rating_history ORDER BY id").all().map(r => r.score), [8, 9, null]);
});

test("monthly endpoint is public, validates dates/limits and never returns player identities", async () => {
  const f = await fixture();
  f.user("a"); f.game("10", "offline"); f.rating("a", "10", 10);
  const request = path => worker.fetch(new Request(`https://example.test/api/community/rankings/monthly${path}`), f.env);
  const response = await request("?month=2026-11");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.firstMonth, "2026-11");
  assert.equal(JSON.stringify(body).includes('"uid"'), false);
  for (const query of ["?month=2026-10", "?month=2026-13", "?month=2099-01", "?month=bad", "?month=2026-11&limit=0", "?month=2026-11&limit=51"])
    assert.equal((await request(query)).status, 400, query);
});

test("future events cannot affect the live board and tied single-player scores never use hours", async () => {
  const f = await fixture();
  f.user("a");
  f.game("10", "offline", "Alpha"); f.game("20", "offline", "Zeta");
  for (const key of ["10", "20"]) { f.library("a", key); f.rating("a", key, 9); }
  f.session("a", "10", "2026-11-02T00:00:00", 60);
  f.session("a", "20", "2026-11-02T00:00:00", 4800);
  f.db.prepare("INSERT INTO community_rating_history(uid,game_key,game_title,score,effective_at) VALUES ('a','20','Zeta',10,'2026-11-29 12:00:00')").run();
  const result = await getMonthlyRankings(f.env, "2026-11", 20, new Date("2026-11-20T12:00:00Z"));
  assert.deepEqual(result.singlePlayer.map(g => g.gameKey), ["10", "20"]);
});

test("monthly online data excludes background apps, invalid intervals and future time", async () => {
  const f = await fixture();
  f.user("a"); f.game("431960", "online", "Wallpaper Engine"); f.game("10", "online");
  f.library("a", "431960"); f.library("a", "10");
  f.session("a", "431960", "2026-11-10T00:00:00", 9999);
  f.session("a", "10", "not-a-date", 9999);
  f.session("a", "10", "2026-11-20T19:00:00", 120, "tracker", "2026-11-20T21:00:00");
  f.session("a", "10", "2026-11-21T00:00:00", 9999);
  const result = await getMonthlyRankings(f.env, "2026-11", 20, new Date("2026-11-20T12:30:00Z"));
  assert.deepEqual(result.online.map(g => [g.gameKey, g.totalMinutes]), [["10", 30]]);
});

test("removing public community data also removes rating history while preserving the private library", async () => {
  const f = await fixture();
  f.user("a"); f.game("10", "offline"); f.rating("a", "10", 9);
  f.db.prepare("INSERT INTO user_library(uid,game_key,title) VALUES ('a','10','Private game')").run();
  const token = await createTestSessionToken({ uid: "a", email: "a@example.test", displayName: "A" });
  const response = await worker.fetch(new Request("https://example.test/api/community/me", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }), f.env);
  assert.equal(response.status, 200);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM community_rating_history WHERE uid='a'").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM user_library WHERE uid='a'").get().n, 1);
});

test("an immediate edit of a millisecond ISO rating remains the latest score", async () => {
  const f = await fixture();
  f.user("a"); f.game("10", "offline");
  f.rating("a", "10", 8, new Date().toISOString());
  f.db.prepare("UPDATE ratings SET score=9 WHERE uid='a' AND game_key='10'").run();
  const latest = f.db.prepare("SELECT score,effective_at FROM community_rating_history ORDER BY julianday(effective_at) DESC,id DESC LIMIT 1").get();
  assert.equal(latest.score, 9);
  assert.match(latest.effective_at, /\.\d{3}Z$/);
});
