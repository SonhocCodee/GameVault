import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../worker/src/index.ts";
import { createTestWorkerEnv, createMockD1, createTestSessionToken } from "./test-helpers-cloudflare.js";
import { getMonthlyPlayerRankings, getMonthlyRankings, mergedMinutes, sessionTimestamp } from "../worker/src/monthly-rankings.ts";
import { refreshSharedLibrary } from "../worker/src/community-common.ts";
import { currentRankingMonth, FIRST_PLAYER_RANKING_MONTH, rankingMonthBounds, rankingMonths, monthlyRatingScore } from "../src/shared/monthly.ts";

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

test("monthly rankings merge non-Steam title aliases across players and overlapping sources", async () => {
  const f = await fixture();
  for (const uid of ["english", "vietnamese", "duplicate-local-entry"]) f.user(uid);
  f.game("t_leagueoflegends", "online", "League of Legends");
  f.game("t_linminhhuynthoi", "online", "Liên Minh Huyền Thoại");
  f.library("english", "t_leagueoflegends");
  f.library("vietnamese", "t_linminhhuynthoi");
  f.library("duplicate-local-entry", "t_leagueoflegends");
  f.library("duplicate-local-entry", "t_linminhhuynthoi");

  f.session("english", "t_leagueoflegends", "2026-11-04T08:00:00", 60);
  f.session("vietnamese", "t_linminhhuynthoi", "2026-11-04T08:00:00", 90);
  f.session("duplicate-local-entry", "t_leagueoflegends", "2026-11-04T08:00:00", 60, "tracker");
  f.session("duplicate-local-entry", "t_linminhhuynthoi", "2026-11-04T08:00:00", 60, "amd_import");

  const result = await f.board();
  assert.deepEqual(
    result.online.map(g => [g.gameKey, g.title, g.totalMinutes, g.players]),
    [["t_leagueoflegends", "League of Legends", 210, 3]],
  );
});

test("community game rankings merge title aliases in shared libraries", async () => {
  const f = await fixture();
  f.user("english"); f.user("vietnamese");
  f.game("t_leagueoflegends", "online", "League of Legends");
  f.game("t_linminhhuynthoi", "online", "Liên Minh Huyền Thoại");
  f.library("english", "t_leagueoflegends");
  f.library("vietnamese", "t_linminhhuynthoi");
  f.db.prepare("UPDATE community_library SET playtime_minutes=120,recorded_playtime_minutes=120 WHERE uid='english'").run();
  f.db.prepare("UPDATE community_library SET playtime_minutes=90,recorded_playtime_minutes=90 WHERE uid='vietnamese'").run();

  const response = await worker.fetch(new Request("https://example.test/api/community/rankings?sort=hours&limit=50"), f.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  const matches = body.items.filter(g => g.gameKey === "t_leagueoflegends");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "League of Legends");
  assert.equal(matches[0].players, 2);
  assert.equal(matches[0].recordedMinutes, 210);
});

test("library refresh stores non-Steam aliases under one canonical shared key", async () => {
  const f = await fixture();
  f.user("alias-owner");
  f.db.prepare(`INSERT INTO user_library(uid,game_key,title,status,playtime_minutes,recorded_playtime_minutes)
    VALUES ('alias-owner','t_leagueoflegends','League of Legends','playing',90,90),
      ('alias-owner','t_linminhhuynthoi','Liên Minh Huyền Thoại','playing',120,120)`).run();

  await refreshSharedLibrary(f.env, "alias-owner");
  const rows = f.db.prepare("SELECT game_key,title,recorded_playtime_minutes FROM community_library WHERE uid='alias-owner'").all();
  assert.deepEqual(rows.map(row => [row.game_key, row.title, row.recorded_playtime_minutes]), [
    ["t_leagueoflegends", "League of Legends", 120],
  ]);
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

test("single-player ranks by average score first then review count, and requires monthly playtime", async () => {
  const f = await fixture();
  f.game("10", "offline"); f.game("20", "hybrid"); f.game("30", "offline");
  f.user("solo"); f.library("solo", "10"); f.session("solo", "10", "2026-11-05T08:00:00", 60); f.rating("solo", "10", 10);
  f.library("solo", "30"); f.rating("solo", "30", 10); // no session in month -> excluded
  for (let i = 0; i < 3; i++) {
    f.user(`p${i}`); f.library(`p${i}`, "20"); f.session(`p${i}`, "20", "2026-11-05T08:00:00", 60); f.rating(`p${i}`, "20", 9.3);
  }
  const result = await f.board();
  assert.deepEqual(result.singlePlayer.map(g => g.gameKey), ["10", "20"]);
  assert.equal(result.singlePlayer[0].averageScore, 10);
  assert.equal(result.singlePlayer[1].reviewCount, 3);
});

test("one player has one vote across Steam aliases and hidden alias reviews cannot leak", async () => {
  const f = await fixture();
  f.user("a"); f.game("10", "offline"); f.library("a", "10");
  f.session("a", "10", "2026-11-05T08:00:00", 60);
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
  f.session("a", "10", "2026-12-05T08:00:00", 60);
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

test("monthly player rankings start in December 2026 and rank by recorded hours", async () => {
  assert.deepEqual(rankingMonths("2026-11", FIRST_PLAYER_RANKING_MONTH), []);
  assert.deepEqual(rankingMonths("2026-12", FIRST_PLAYER_RANKING_MONTH), ["2026-12"]);
  assert.deepEqual(rankingMonths("2027-02", FIRST_PLAYER_RANKING_MONTH), ["2027-02", "2027-01", "2026-12"]);

  const f = await fixture();
  f.user("a"); f.user("b"); f.user("hidden", 0);
  f.game("10", "online", "Game 10"); f.game("20", "offline", "Game 20");
  f.library("a", "10"); f.library("a", "20");
  f.library("b", "10"); f.library("hidden", "10");

  // November sessions must not count toward December; manual sessions must not count
  f.session("a", "10", "2026-11-15T10:00:00", 600);
  f.session("a", "10", "2026-12-02T10:00:00", 90);
  f.session("a", "20", "2026-12-03T10:00:00", 30);
  f.session("a", "20", "2026-12-04T10:00:00", 9999, "manual");
  f.session("b", "10", "2026-12-02T10:00:00", 180);
  f.session("hidden", "10", "2026-12-02T10:00:00", 500);

  await assert.rejects(() => getMonthlyPlayerRankings(f.env, "2026-11", {}, now), /December 2026/);

  const res = await getMonthlyPlayerRankings(f.env, "2026-12", { includeTopGames: true }, now);
  assert.equal(res.firstMonth, "2026-12");
  assert.equal(res.state, "live");
  assert.deepEqual(res.items.map(p => [p.uid, p.recordedMinutes, p.totalGames]), [
    ["b", 180, 1],
    ["a", 120, 2],
  ]);
  assert.deepEqual(res.items[1].topGames.map(g => [g.gameKey, g.playtimeMinutes]), [
    ["10", 90],
    ["20", 30],
  ]);

  const httpBeforeStart = await worker.fetch(new Request("https://example.test/api/community/players/monthly?month=2026-11"), f.env);
  assert.equal(httpBeforeStart.status, 400);
});

test("monthly player top games merge non-Steam aliases and overlapping session sources", async () => {
  const f = await fixture();
  f.user("alias-player");
  f.game("t_leagueoflegends", "online", "League of Legends");
  f.game("t_linminhhuynthoi", "online", "Liên Minh Huyền Thoại");
  f.library("alias-player", "t_leagueoflegends");
  f.library("alias-player", "t_linminhhuynthoi");
  f.session("alias-player", "t_leagueoflegends", "2026-12-02T10:00:00", 60, "tracker");
  f.session("alias-player", "t_linminhhuynthoi", "2026-12-02T10:00:00", 60, "amd_import");

  const result = await getMonthlyPlayerRankings(f.env, "2026-12", { includeTopGames: true }, now);
  assert.equal(result.items[0].totalMinutes, 60);
  assert.deepEqual(result.items[0].topGames.map(g => [g.gameKey, g.title, g.playtimeMinutes]), [
    ["t_leagueoflegends", "League of Legends", 60],
  ]);
});
