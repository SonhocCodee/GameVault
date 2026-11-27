import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.ts";
import {
  createTestWorkerEnv,
  createTestSessionToken,
} from "./test-helpers-cloudflare.js";
import {
  configureSteamDiscovery,
  stripSteamHtml,
} from "../worker/src/routes/discovery.ts";

async function fixture() {
  const { env, d1, r2 } = await createTestWorkerEnv();
  const tokens = {};
  for (const uid of ["alice", "bob", "carol", "admin"]) {
    tokens[uid] = await createTestSessionToken({
      uid,
      email: uid === "admin" ? "son6232000@gmail.com" : `${uid}@example.com`,
      displayName: `${uid}@example.com`,
    });
    d1.sqlite
      .prepare("INSERT INTO users(uid,email,display_name) VALUES (?,?,?)")
      .run(uid, `${uid}@example.com`, `${uid}@example.com`);
  }
  const call = async (path, method = "GET", body, uid) =>
    worker.fetch(
      new Request(`https://example.com/api/community${path}`, {
        method,
        headers: { ...(uid ? { Authorization: `Bearer ${tokens[uid]}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  return { env, d1, r2, tokens, call };
}
const post = {
  gameKey: "814380",
  title: "Sekiro",
  steamId: 814380,
  kind: "thought",
  body: "Great combat",
  spoiler: false,
};

test("follow is authenticated, idempotent, searchable and filters the feed", async () => {
  const f = await fixture();
  for (const uid of ["alice", "bob", "carol"]) {
    await f.call("/me", "GET", undefined, uid);
    await f.call("/me", "PUT", { nickname: uid === "bob" ? "Bob Player" : uid, bio: "" }, uid);
  }
  assert.equal((await f.call("/follows/bob", "PUT")).status, 401);
  assert.equal((await f.call("/follows/alice", "PUT", undefined, "alice")).status, 400);
  assert.equal((await f.call("/follows/missing", "PUT", undefined, "alice")).status, 404);
  for (let i = 0; i < 2; i++) {
    const r = await f.call("/follows/bob", "PUT", undefined, "alice");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { isFollowing: true, followersCount: 1, followingCount: 0 });
  }
  const search = await (await f.call("/profiles?q=Bob", "GET", undefined, "alice")).json();
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].uid, "bob");
  assert.equal(search.items[0].isFollowing, true);
  assert.equal(JSON.stringify(search).includes("@example.com"), false);
  assert.equal((await (await f.call("/profiles?q=%25")).json()).items.length, 0);
  assert.equal((await (await f.call("/me", "GET", undefined, "alice")).json()).followingCount, 1);
  assert.equal((await (await f.call("/profiles/bob", "GET", undefined, "alice")).json()).followersCount, 1);
  assert.deepEqual((await (await f.call("/profiles?following=true", "GET", undefined, "alice")).json()).items.map(p => p.uid), ["bob"]);
  assert.equal((await f.call("/profiles?following=true")).status, 401);
  for (const uid of ["bob", "carol"]) await f.call("/posts", "POST", post, uid);
  const feed = await (await f.call("/posts?following=true&q=Sekiro", "GET", undefined, "alice")).json();
  assert.deepEqual(feed.items.map(p => p.uid), ["bob"]);
  assert.equal((await (await f.call("/posts?q=Other")).json()).items.length, 0);
  assert.equal((await f.call("/posts?following=true")).status, 401);
  for (let i = 0; i < 2; i++) {
    const r = await (await f.call("/follows/bob", "DELETE", undefined, "alice")).json();
    assert.equal(r.isFollowing, false);
    assert.equal(r.followersCount, 0);
  }
});

test("blocks remove both follow directions and profile deletion cleans up follows", async () => {
  const f = await fixture();
  for (const uid of ["alice", "bob", "carol"]) await f.call("/me", "GET", undefined, uid);
  await f.call("/follows/bob", "PUT", undefined, "alice");
  await f.call("/follows/alice", "PUT", undefined, "bob");
  await f.call("/blocks/bob", "PUT", undefined, "alice");
  assert.equal(f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM community_follows").get().n, 0);
  assert.equal((await f.call("/follows/bob", "PUT", undefined, "alice")).status, 404);
  assert.equal((await f.call("/follows/alice", "PUT", undefined, "bob")).status, 404);
  assert.equal((await (await f.call("/profiles?q=Player", "GET", undefined, "alice")).json()).items.some(p => p.uid === "bob"), false);
  await f.call("/follows/carol", "PUT", undefined, "alice");
  await f.call("/follows/alice", "PUT", undefined, "carol");
  await f.call("/me", "DELETE", undefined, "alice");
  assert.equal(f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM community_follows").get().n, 0);
  f.d1.sqlite.prepare("UPDATE community_profiles SET suspended=1 WHERE uid='bob'").run();
  assert.equal((await f.call("/follows/bob", "PUT", undefined, "carol")).status, 404);
});
const performance = {
  gameKey: "814380",
  title: "Sekiro",
  completionStatus: "completed",
  cpu: "CPU",
  gpu: "GPU",
  ramGb: 16,
  fpsAverage: 60,
  fpsLow: 40,
  samples: 1000,
  source: "presentmon",
  measuredAt: "2026-11-24T10:00:00Z",
  graphics: {
    width: 1920,
    height: 1080,
    preset: "High",
    upscaling: "Off",
    frameGeneration: "Off",
    rayTracing: "Off",
    source: "manual",
  },
};

test("public feed does not require login, and anonymous mutations fail", async () => {
  const f = await fixture();
  assert.equal((await f.call("/posts")).status, 200);
  assert.equal((await f.call("/posts", "POST", post)).status, 401);
});

test("profile totals include idle apps, zero-hour completed games and games beyond the display limit", async () => {
  const f = await fixture();
  const insert = f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes,is_deleted) VALUES ('alice',?,?,?,?,?)");
  for (let i = 0; i < 205; i++) insert.run(`game-${i}`, `Game ${i}`, "playing", 60, 0);
  insert.run("431960", "Wallpaper Engine", "playing", 6000, 0);
  insert.run("zero-completed", "Completed offline", "completed", 0, 0);
  insert.run("backlog", "Unplayed", "backlog", 0, 0);
  insert.run("deleted", "Deleted", "completed", 9999, 1);
  const me = await (await f.call("/me", "GET", undefined, "alice")).json();
  const profile = await (await f.call("/profiles/alice")).json();
  for (const result of [me, profile]) {
    assert.equal(result.shareLibrary, true);
    assert.equal(result.totalGames, 208);
    assert.equal(result.playedGames, 207);
    assert.equal(result.completedGames, 1);
    assert.equal(result.totalMinutes, 18300);
  }
  assert.equal(profile.games.length, 200);
  assert.equal((await (await f.call("/players?sort=hours")).json()).items[0].totalMinutes, 18300);
});

test("profile presets store only catalogue IDs and propagate across public surfaces", async () => {
  const f = await fixture();
  f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES ('alice','814380','Sekiro','completed',120)").run();
  const before = f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM community_images").get().n;
  for (const [avatar, banner] of [["gamepad", "aurora"], ["dice", "velocity"]]) {
    assert.equal((await f.call("/me", "PUT", { nickname: "Alice", bio: "Hello", avatarPreset: avatar, bannerPreset: banner }, "alice")).status, 200);
    const me = await (await f.call("/me", "GET", undefined, "alice")).json();
    const profile = await (await f.call("/profiles/alice")).json();
    assert.equal(me.avatarPreset, avatar);
    assert.equal(me.bannerPreset, banner);
    assert.equal(me.avatarUrl, `https://example.com/community/profile-presets/avatars/${avatar}.svg`);
    assert.equal(profile.avatarUrl, me.avatarUrl);
    assert.equal(profile.bannerUrl, `/community/profile-presets/banners/${banner}.svg`);
    assert.equal((await (await f.call("/players")).json()).items[0].avatarUrl, me.avatarUrl);
    assert.equal((await (await f.call("/games/814380/players")).json()).items[0].avatarUrl, me.avatarUrl);
  }
  await f.call("/posts", "POST", post, "alice");
  assert.equal((await (await f.call("/posts")).json()).items[0].avatarUrl, "https://example.com/community/profile-presets/avatars/dice.svg");
  await f.call("/uploads", "DELETE", undefined, "alice");
  assert.equal(f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM community_images").get().n, before);
  const saved = f.d1.sqlite.prepare("SELECT avatar_preset,banner_preset FROM community_profiles WHERE uid='alice'").get();
  assert.equal(saved.avatar_preset, "dice");
  assert.equal(saved.banner_preset, "velocity");
  await f.call("/me", "PUT", { nickname: "Alice", bio: "Updated" }, "alice");
  assert.equal((await (await f.call("/me", "GET", undefined, "alice")).json()).avatarPreset, "dice");
  await f.call("/me", "PUT", { nickname: "Alice", avatarPreset: null, bannerPreset: null }, "alice");
  const reset = await (await f.call("/me", "GET", undefined, "alice")).json();
  assert.equal(reset.avatarPreset, null);
  assert.equal(reset.bannerPreset, null);
  assert.equal(reset.avatarUrl, null);
});

test("profile API rejects arbitrary images, upload keys and invalid preset IDs", async () => {
  const f = await fixture();
  for (const invalid of [
    { avatarPreset: "unknown" }, { bannerPreset: "gamepad" }, { avatarPreset: "aurora" },
    { avatarPreset: "https://example.com/image.png" }, { bannerPreset: "data:image/png;base64,AA" },
    { avatarPreset: "../gamepad" }, { avatarPreset: {} }, { bannerPreset: 1 },
    { avatarKey: "owned-image" }, { bannerKey: "owned-image" },
    { avatarUrl: "https://example.com/image.png" }, { bannerUrl: "https://example.com/image.png" },
  ]) {
    assert.equal((await f.call("/me", "PUT", { nickname: "Alice", ...invalid }, "alice")).status, 400);
    // Keep this validation test independent of the per-minute profile rate limit.
    f.d1.sqlite.prepare("DELETE FROM community_rate_limits WHERE actor='alice'").run();
  }
  assert.equal(f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM community_images").get().n, 0);
});

test("game review artwork belongs to the author for guests, owners and other accounts", async () => {
  const f = await fixture();
  f.d1.sqlite.prepare("UPDATE users SET photo_url='https://example.com/alice.jpg' WHERE uid='alice'").run();
  f.d1.sqlite.prepare("INSERT INTO game_covers(game_key,title,steam_id,cover_url,banner_url) VALUES ('814380','Sekiro',814380,'/api/images/sekiro-cover.jpg','/api/images/sekiro-banner.jpg')").run();
  f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,steam_id,status,playtime_minutes) VALUES ('alice','814380','Sekiro',814380,'completed',120)").run();
  await f.call("/me", "GET", undefined, "alice");
  await f.call("/me", "PUT", { nickname: "Bob", avatarPreset: "dice", bannerPreset: "velocity" }, "bob");
  assert.equal((await f.call("/games/814380/reviews", "POST", { title: "Sekiro", score: 9, review: "Public review" }, "alice")).status, 200);

  for (const [avatarPreset, bannerPreset] of [[null, null], ["gamepad", "aurora"]]) {
    await f.call("/me", "PUT", { nickname: "Alice", avatarPreset, bannerPreset }, "alice");
    const author = await (await f.call("/profiles/alice")).json();
    for (const viewer of [undefined, "alice", "bob"]) {
      const response = await f.call("/games/814380/reviews", "GET", undefined, viewer);
      assert.equal(response.status, 200);
      const { items } = await response.json();
      assert.equal(items.length, 1);
      assert.equal(items[0].uid, "alice");
      assert.equal(items[0].avatarUrl, author.avatarUrl);
      assert.equal(items[0].bannerUrl, new URL(author.bannerUrl, "https://example.com").href);
      assert.ok(!JSON.stringify(items).includes("@example.com"));
    }
  }
  assert.equal((await f.call("/games/814380/reviews", "POST", { title: "Sekiro", score: 1, review: "Anonymous edit" })).status, 401);
  assert.equal((await f.call("/games/814380/reviews", "DELETE")).status, 401);
});

test("review default banners use public library artwork and keep visibility filters", async () => {
  const f = await fixture();
  await f.call("/games/814380/reviews", "POST", { title: "Sekiro", score: 9, review: "Public review" }, "alice");
  f.d1.sqlite.prepare("INSERT INTO game_covers(game_key,title,cover_url,banner_url) VALUES ('t_private','Private','/api/images/private-cover.jpg','/api/images/private-banner.jpg'),('431960','Wallpaper Engine',NULL,'/api/images/idle-banner.jpg'),('814380','Sekiro','/api/images/public-cover.jpg',NULL)").run();
  f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES ('alice','t_private','Private','completed',9999)").run();
  f.d1.sqlite.prepare("INSERT INTO community_library(uid,game_key,title,status,playtime_minutes) VALUES ('alice','431960','Wallpaper Engine','playing',9999),('alice','814380','Sekiro','completed',120)").run();
  const reviews = async (viewer) => (await (await f.call("/games/814380/reviews", "GET", undefined, viewer)).json()).items;
  assert.equal((await reviews())[0].bannerUrl, "https://example.com/api/images/public-cover.jpg");
  f.d1.sqlite.prepare("UPDATE community_profiles SET share_library=0 WHERE uid='alice'").run();
  assert.equal((await reviews())[0].bannerUrl, null);
  f.d1.sqlite.prepare("UPDATE community_profiles SET share_library=1 WHERE uid='alice'").run();
  await f.call("/blocks/alice", "PUT", undefined, "bob");
  assert.equal((await reviews("bob")).length, 0);
  assert.equal((await reviews()).length, 1);
  f.d1.sqlite.prepare("UPDATE community_review_meta SET hidden=1 WHERE uid='alice' AND game_key='814380'").run();
  assert.equal((await reviews()).length, 0);
  f.d1.sqlite.prepare("UPDATE community_review_meta SET hidden=0 WHERE uid='alice'").run();
  f.d1.sqlite.prepare("UPDATE community_profiles SET suspended=1 WHERE uid='alice'").run();
  assert.equal((await reviews()).length, 0);
});

test("player rankings include all metrics, sort, paginate and stay public", async () => {
  const f = await fixture();
  for (const [uid, game, status, minutes] of [
    ["alice", "814380", "completed", 120], ["alice", "292030", "completed", 60],
    ["bob", "814380", "playing", 1000], ["carol", "814380", "completed", 9999],
  ]) f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes,recorded_playtime_minutes) VALUES (?,?,?,?,?,?)").run(uid, game, "Game", status, minutes, minutes);
  for (const uid of ["alice", "bob"]) {
    assert.equal((await f.call("/me", "PUT", { nickname: uid, bio: "", shareLibrary: true }, uid)).status, 200);
  }
  const completed = await (await f.call("/players")).json();
  assert.deepEqual(completed.items.map(p => p.uid), ["alice", "bob"]);
  assert.deepEqual(completed.items[0], { uid: "alice", nickname: "alice", totalGames: 2, completedGames: 2, totalMinutes: 180, recordedMinutes: 180 });
  const hours = await (await f.call("/players?sort=hours&limit=1")).json();
  assert.equal(hours.items[0].uid, "bob");
  assert.equal(hours.hasMore, true);
  assert.equal((await (await f.call("/players?sort=hours&limit=1&offset=1")).json()).items[0].uid, "alice");
  assert.equal((await f.call("/players?sort=__proto__")).status, 400);
  assert.equal((await f.call("/players?sort=invalid")).status, 400);
  await f.call("/me", "PUT", { nickname: "alice", bio: "", shareLibrary: false }, "alice");
  assert.deepEqual((await (await f.call("/players")).json()).items.map(p => p.uid), ["alice", "bob"]);
  assert.equal((await (await f.call("/me", "GET", undefined, "alice")).json()).shareLibrary, true);
});

test("game top players include public libraries without FPS and keep hours public", async () => {
  const f = await fixture();
  for (const [uid, status, minutes] of [["alice", "completed", 120], ["bob", "playing", 240], ["carol", "completed", 9999]]) {
    f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes,recorded_playtime_minutes) VALUES (?,'814380','Sekiro',?,?,?)").run(uid, status, minutes, minutes);
  }
  for (const uid of ["alice", "bob"]) await f.call("/me", "PUT", { nickname: uid, bio: "", shareLibrary: true }, uid);
  await f.call("/games/814380/performance", "POST", performance, "alice");
  await f.call("/games/814380/performance", "POST", performance, "carol");
  const all = await (await f.call("/games/814380/players")).json();
  assert.deepEqual(all.items.map(p => p.uid), ["carol", "bob", "alice"]);
  assert.equal(all.items[1].performance, null);
  assert.equal(all.items[2].performance.fpsAverage, 60);
  assert.equal(all.items[0].playtimeMinutes, 9999);
  assert.equal(JSON.stringify(all).includes("@example.com"), false);
  const completed = await (await f.call("/games/814380/players?status=completed")).json();
  assert.deepEqual(completed.items.map(p => p.uid), ["carol", "alice"]);
  assert.equal((await f.call("/games/814380/players?status=wrong")).status, 400);
  f.d1.sqlite.prepare("UPDATE community_performance SET hidden=1 WHERE uid='carol'").run();
  assert.deepEqual((await (await f.call("/games/814380/players?status=completed")).json()).items.map(p => p.uid), ["carol", "alice"]);
  await f.call("/me", "PUT", { nickname: "alice", bio: "", shareLibrary: false }, "alice");
  const stillPublic = (await (await f.call("/games/814380/players?status=completed")).json()).items.find(p => p.uid === "alice");
  assert.equal(stillPublic.playtimeMinutes, 120);
  await f.call("/games/814380/performance", "DELETE", undefined, "alice");
  assert.equal((await (await f.call("/games/814380/players?status=completed")).json()).items.length, 2);
});

test("global and per-game player boards exclude blocked and suspended users", async () => {
  const f = await fixture();
  for (const uid of ["alice", "bob", "carol"]) {
    f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES (?,'814380','Sekiro','completed',100)").run(uid);
    await f.call("/me", "PUT", { nickname: uid, bio: "", shareLibrary: true }, uid);
  }
  await f.call("/blocks/bob", "PUT", undefined, "alice");
  f.d1.sqlite.prepare("UPDATE community_profiles SET suspended=1 WHERE uid='carol'").run();
  for (const path of ["/players", "/games/814380/players"]) {
    const board = await (await f.call(path, "GET", undefined, "alice")).json();
    assert.deepEqual(board.items.map(p => p.uid), ["alice"]);
    assert.equal((await (await f.call(path)).json()).items.length, 2);
  }
});

test("completed games with zero tracked hours still appear in game rankings and player lists", async () => {
  const f = await fixture();
  for (const [game, status] of [["814380", "completed"], ["292030", "backlog"]]) {
    f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES ('alice',?,'Game',?,0)").run(game, status);
  }
  await f.call("/me", "PUT", { nickname: "Alice", bio: "", shareLibrary: true }, "alice");
  const games = await (await f.call("/rankings?sort=completed")).json();
  assert.equal(games.items.length, 2);
  assert.equal(games.items[0].gameKey, "814380");
  assert.equal(games.items[0].players, 1);
  assert.equal(games.items[0].completedPlayers, 1);
  assert.equal(games.items[0].totalMinutes, 0);
  assert.equal((await (await f.call("/games/814380/players?status=completed")).json()).items.length, 1);
  assert.equal((await (await f.call("/games/292030/players")).json()).items.length, 0);
});
test("game catalog includes unplayed games and sorts, searches and paginates database results", async () => {
  const f = await fixture();
  for (const [key, title, steam] of [["814380", "Sekiro", 814380], ["292030", "The Witcher 3", 292030], ["t_test", "100%_Game", null], ["s_814380", "Sekiro", 814380]]) {
    f.d1.sqlite.prepare("INSERT INTO game_covers(game_key,title,steam_id) VALUES (?,?,?)").run(key, title, steam);
  }
  assert.equal((await (await f.call("/rankings?sort=score")).json()).items.length, 0);
  f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES ('alice','814380','Sekiro','completed',600)").run();
  f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES ('bob','t_private','Private title','playing',9999)").run();
  await f.call("/me", "PUT", { nickname: "Alice", bio: "", shareLibrary: true }, "alice");
  await f.call("/games/292030/reviews", "POST", { title: "The Witcher 3", score: 9, review: "Great" }, "alice");
  const hours = await (await f.call("/rankings?sort=hours")).json();
  assert.equal(hours.items.length, 3);
  assert.equal(hours.items[0].gameKey, "814380");
  assert.equal(hours.items[0].totalMinutes, 600);
  assert.ok(!JSON.stringify(hours).includes("Private"));
  const scores = await (await f.call("/rankings?sort=score")).json();
  assert.equal(scores.items[0].gameKey, "292030");
  assert.equal(scores.items[0].averageScore, 9);
  assert.equal(scores.items.length, 1);
  const first = await (await f.call("/rankings?sort=hours&limit=1")).json();
  assert.equal(first.hasMore, true);
  const second = await (await f.call(`/rankings?sort=hours&limit=1&offset=${first.nextOffset}`)).json();
  assert.notEqual(second.items[0].gameKey, first.items[0].gameKey);
  assert.equal((await (await f.call("/rankings?q=witcher")).json()).items[0].gameKey, "292030");
  assert.equal((await (await f.call("/rankings?q=%25_")).json()).items[0].gameKey, "t_test");
  assert.equal((await (await f.call("/rankings?q=missing")).json()).items.length, 0);
  assert.equal((await f.call("/rankings?sort=invalid")).status, 400);
});

test("comment history is personal, paginated and excludes unavailable parent posts and comments", async () => {
  const f = await fixture();
  const { id } = await (await f.call("/posts", "POST", post, "bob")).json();
  const { id: otherPost } = await (await f.call("/posts", "POST", { ...post, spoiler: true }, "carol")).json();
  const { id: firstComment } = await (await f.call(`/posts/${id}/comments`, "POST", { body: "Alice first" }, "alice")).json();
  await f.call(`/posts/${id}/comments`, "POST", { body: "Bob comment" }, "bob");
  const { id: latestComment } = await (await f.call(`/posts/${otherPost}/comments`, "POST", { body: "Alice latest" }, "alice")).json();
  f.d1.sqlite.prepare("UPDATE community_comments SET created_at='2026-11-25 00:00:00' WHERE id=?").run(firstComment);
  f.d1.sqlite.prepare("UPDATE community_comments SET created_at='2026-11-26 00:00:00' WHERE id=?").run(latestComment);
  assert.equal((await f.call("/me/comments")).status, 401);
  const history = await (await f.call("/me/comments?limit=1&uid=bob", "GET", undefined, "alice")).json();
  assert.equal(history.hasMore, true);
  assert.equal(history.items[0].body, "Alice latest");
  assert.equal(history.items[0].gameTitle, "Sekiro");
  assert.equal(history.items[0].spoiler, true);
  const next = await (await f.call(`/me/comments?limit=1&offset=${history.nextOffset}`, "GET", undefined, "alice")).json();
  assert.equal(next.items[0].id, firstComment);
  assert.equal(next.hasMore, false);
  await f.call("/blocks/bob", "PUT", undefined, "alice");
  assert.equal((await (await f.call("/me/comments", "GET", undefined, "alice")).json()).items.length, 1);
  f.d1.sqlite.prepare("UPDATE community_posts SET hidden=1 WHERE id=?").run(otherPost);
  assert.equal((await (await f.call("/me/comments", "GET", undefined, "alice")).json()).items.length, 0);
  await f.call("/blocks/bob", "DELETE", undefined, "alice");
  f.d1.sqlite.prepare("UPDATE community_comments SET hidden=1 WHERE id=?").run(firstComment);
  assert.equal((await (await f.call("/me/comments", "GET", undefined, "alice")).json()).items.length, 0);
});

test("bulk review sync validates ownership, conflicts and moderation while creating one feed entry", async () => {
  const f = await fixture();
  const item = { gameKey: '814380', title: 'Sekiro', score: 8, review: 'Old local review', playtimeMinutes: 30, updatedAt: '2026-11-01T00:00:00Z' };
  assert.equal((await f.call('/me/reviews/sync', 'POST', { items: [item] })).status, 401);
  assert.equal((await f.call('/me/reviews/sync', 'POST', { items: [{ ...item, score: 0 }] }, 'alice')).status, 400);
  assert.equal((await f.call('/me/reviews/sync', 'POST', { items: Array(51).fill(item) }, 'alice')).status, 400);
  assert.equal((await f.call('/me/reviews/sync', 'POST', { items: [item], uid: 'bob' }, 'alice')).status, 200);
  await f.call('/games/814380/reviews', 'POST', { title: 'Sekiro', score: 9, review: 'New web review', spoiler: true }, 'alice');
  await f.call('/me/reviews/sync', 'POST', { items: [item] }, 'alice');
  const reviews = await (await f.call('/games/814380/reviews')).json();
  assert.equal(reviews.items.length, 1);
  assert.equal(reviews.items[0].score, 9);
  assert.equal(reviews.items[0].review, 'New web review');
  const posts = await (await f.call('/posts?uid=alice')).json();
  assert.equal(posts.items.length, 1);
  assert.equal(posts.items[0].spoiler, true);
  assert.equal((await (await f.call('/posts?uid=bob')).json()).items.length, 0);
  f.d1.sqlite.prepare("UPDATE community_review_meta SET hidden=1 WHERE uid='alice'").run();
  await f.call('/me/reviews/sync', 'POST', { items: [{ ...item, updatedAt: '2099-01-01T00:00:00Z' }] }, 'alice');
  assert.equal((await (await f.call('/rankings?sort=score')).json()).items.length, 0);
});

test("authenticated review sync can publish legacy cloud scores without exposing private notes", async () => {
  const f = await fixture();
  f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,steam_id,user_score,user_notes,status,playtime_minutes) VALUES ('alice','s_2147483647','FFVII Rebirth',2147483647,10,'Private local note','playing',999)").run();
  await f.call('/me/reviews/sync', 'POST', { items: [], includeStoredScores: true }, 'alice');
  const ratings = f.d1.sqlite.prepare("SELECT game_key,score,review,playtime_minutes FROM ratings WHERE uid='alice'").all();
  assert.equal(ratings.length, 1);
  assert.equal(ratings[0].game_key, '2147483647');
  assert.equal(ratings[0].score, 10);
  assert.equal(ratings[0].review, '');
  assert.equal(ratings[0].playtime_minutes, 0);
  assert.equal(JSON.stringify(await (await f.call('/posts?uid=alice')).json()).includes('Private local note'), false);
  assert.equal((await (await f.call('/rankings?sort=score')).json()).items.length, 1);
  assert.equal(f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM ratings WHERE uid='alice'").get().n, 1);
});

test("public names and profiles do not leak email or private library notes", async () => {
  const f = await fixture();
  await f.call("/posts", "POST", post, "alice");
  const feed = await (await f.call("/posts")).json();
  assert.equal(feed.items[0].nickname, "Player");
  assert.ok(!JSON.stringify(feed).includes("@example.com"));
  f.d1.sqlite
    .prepare(
      "INSERT INTO user_library(uid,game_key,title,status,playtime_minutes,user_notes) VALUES ('alice','814380','Sekiro','completed',80,'PRIVATE')",
    )
    .run();
  const profile = await (await f.call("/profiles/alice")).json();
  assert.deepEqual(profile.games, []);
  assert.ok(!JSON.stringify(profile).includes("PRIVATE"));
});
test("legacy sharing withdrawal cannot remove library statistics from rankings", async () => {
  const f = await fixture();
  for (const uid of ["alice", "bob"])
    f.d1.sqlite
      .prepare(
        "INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES (?,?,?,?,?)",
      )
      .run(uid, "814380", "Sekiro", "completed", 100);
  assert.equal((await (await f.call("/rankings")).json()).items.length, 0);
  await f.call(
    "/me",
    "PUT",
    { nickname: "Alice", bio: "", shareLibrary: true },
    "alice",
  );
  await f.call(
    "/me",
    "PUT",
    { nickname: "Bob", bio: "", shareLibrary: true },
    "bob",
  );
  let board = await (await f.call("/rankings")).json();
  assert.equal(board.items[0].players, 2);
  assert.equal(board.items[0].totalMinutes, 200);
  await f.call(
    "/me",
    "PUT",
    { nickname: "Alice", bio: "", shareLibrary: false },
    "alice",
  );
  board = await (await f.call("/rankings")).json();
  assert.equal(board.items[0].players, 2);
});
test("post ownership, numeric limits and duplicate likes are enforced", async () => {
  const f = await fixture();
  const { id } = await (await f.call("/posts", "POST", post, "alice")).json();
  assert.equal(
    (await f.call(`/posts/${id}`, "DELETE", undefined, "bob")).status,
    403,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.call(`/posts/${id}/like`, "PUT", undefined, "bob")).status,
      200,
    );
  let p = await (await f.call(`/posts/${id}`)).json();
  assert.equal(p.likes, 1);
  await f.call(`/posts/${id}/like`, "DELETE", undefined, "bob");
  p = await (await f.call(`/posts/${id}`)).json();
  assert.equal(p.likes, 0);
  assert.equal(
    (await f.call("/posts", "POST", { ...post, steamId: -2 }, "alice")).status,
    400,
  );
});
test("comments, notifications and blocking work together", async () => {
  const f = await fixture();
  const { id } = await (await f.call("/posts", "POST", post, "alice")).json();
  assert.equal(
    (await f.call(`/posts/${id}/comments`, "POST", { body: "Nice!" }, "bob"))
      .status,
    201,
  );
  const notes = await (
    await f.call("/notifications", "GET", undefined, "alice")
  ).json();
  assert.equal(notes.items.length, 1);
  assert.equal(notes.items[0].kind, "comment");
  await f.call("/blocks/bob", "PUT", undefined, "alice");
  assert.equal(
    (await (await f.call("/notifications", "GET", undefined, "alice")).json())
      .items.length,
    0,
  );
  assert.equal(
    (
      await (
        await f.call(`/posts/${id}/comments`, "GET", undefined, "alice")
      ).json()
    ).items.length,
    0,
  );
  assert.equal(
    (await f.call(`/posts/${id}/comments`, "POST", { body: "Again" }, "bob"))
      .status,
    404,
  );
});
test("review updates keep one review and one feed entry; score ranking includes early reviews", async () => {
  const f = await fixture();
  for (const uid of ["alice", "bob", "carol"]) {
    assert.equal(
      (
        await f.call(
          "/games/814380/reviews",
          "POST",
          { title: "Sekiro", score: 9, review: "Recommended", spoiler: true },
          uid,
        )
      ).status,
      200,
    );
    const board = await (await f.call("/rankings?sort=score")).json();
    assert.equal(board.items.length, 1);
    assert.equal(board.items[0].reviewCount, ["alice", "bob", "carol"].indexOf(uid) + 1);
  }
  await f.call(
    "/games/814380/reviews",
    "POST",
    { title: "Sekiro", score: 8, review: "Updated review" },
    "alice",
  );
  const reviews = await (await f.call("/games/814380/reviews")).json();
  assert.equal(reviews.items.length, 3);
  const posts = await (await f.call("/posts")).json();
  assert.equal(posts.items.length, 3);
  assert.equal(
    (await (await f.call("/rankings?sort=score")).json()).items[0].reviewCount,
    3,
  );
});
test("malformed bodies and oversized comments do not create content", async () => {
  const f = await fixture();
  const { id } = await (await f.call("/posts", "POST", post, "alice")).json();
  assert.equal(
    (
      await f.call(
        `/posts/${id}/comments`,
        "POST",
        { body: "x".repeat(1501) },
        "bob",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/posts",
        "POST",
        { ...post, body: "x".repeat(17000) },
        "bob",
      )
    ).status,
    413,
  );
  const response = await worker.fetch(
    new Request("https://example.com/api/community/posts", {
      method: "POST",
      headers: { Authorization: `Bearer ${f.tokens.alice}` },
      body: "{broken",
    }),
    f.env,
  );
  assert.equal(response.status, 400);
});
test("community images require ownership, become visible only on a live post, and disappear on deletion", async () => {
  const f = await fixture();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = await worker.fetch(
    new Request("https://example.com/api/community/uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${f.tokens.alice}`,
        "Content-Type": "image/png",
      },
      body: png,
    }),
    f.env,
  );
  const { key } = await upload.json();
  assert.equal(upload.status, 201);
  assert.equal((await f.call(`/images/${key}`)).status, 404);
  assert.equal(
    (await f.call("/posts", "POST", { ...post, imageKeys: [key] }, "bob"))
      .status,
    403,
  );
  const { id } = await (
    await f.call("/posts", "POST", { ...post, imageKeys: [key] }, "alice")
  ).json();
  const image = await f.call(`/images/${key}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  // Private storage keys cannot be reached through the legacy generic image route.
  assert.equal(
    (
      await worker.fetch(
        new Request(`https://example.com/api/images/community%2F${key}`),
        f.env,
      )
    ).status,
    400,
  );
  await f.call(`/posts/${id}`, "DELETE", undefined, "alice");
  assert.equal((await f.call(`/images/${key}`)).status, 404);
  assert.equal(f.r2._store.size, 0);
});
test("community images stored in D1 are served as original bytes, not a comma-separated array", async () => {
  const f = await fixture();
  delete f.env.IMAGES_BUCKET;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = await worker.fetch(
    new Request("https://example.com/api/community/uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${f.tokens.alice}`,
        "Content-Type": "image/png",
      },
      body: png,
    }),
    f.env,
  );
  assert.equal(upload.status, 201);
  const { key } = await upload.json();
  const created = await f.call("/posts", "POST", { ...post, imageKeys: [key] }, "alice");
  assert.equal(created.status, 201);

  // Production D1 serializes BLOBs as number[], unlike node:sqlite's Uint8Array.
  const db = f.env.DB;
  f.env.DB = {
    ...db,
    prepare(query) {
      const statement = db.prepare(query);
      if (!query.includes("SELECT i.* FROM community_images")) return statement;
      return {
        bind: (...values) => ({
          async first() {
            const row = await statement.bind(...values).first();
            return row ? { ...row, data: Array.from(row.data) } : null;
          },
        }),
      };
    },
  };

  const image = await f.call(`/images/${key}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.equal(image.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
});

test("reports are admin-only and hidden content is unavailable", async () => {
  const f = await fixture();
  const { id } = await (await f.call("/posts", "POST", post, "alice")).json();
  await f.call(
    "/reports",
    "POST",
    { targetType: "post", targetId: id, reason: "Spam" },
    "bob",
  );
  assert.equal(
    (await f.call("/admin/reports", "GET", undefined, "bob")).status,
    403,
  );
  const reports = await (
    await f.call("/admin/reports", "GET", undefined, "admin")
  ).json();
  assert.equal(reports.items[0].targetBody, post.body);
  await f.call(
    `/admin/reports/${reports.items[0].id}`,
    "PUT",
    { action: "hide" },
    "admin",
  );
  assert.equal((await f.call(`/posts/${id}`)).status, 404);
});
test("completed performance reports require actual context and reject non-finite or invalid values", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.call(
        "/games/814380/performance",
        "POST",
        { ...performance, completionStatus: "playing" },
        "alice",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/games/814380/performance",
        "POST",
        { ...performance, graphics: { ...performance.graphics, width: null } },
        "alice",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/games/814380/performance",
        "POST",
        { ...performance, fpsAverage: null },
        "alice",
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.call("/games/814380/performance", "POST", performance, "alice"))
      .status,
    200,
  );
  const report = (
    await (await f.call("/games/814380/performance?width=1920&gpu=GPU")).json()
  ).items[0];
  assert.equal(report.graphics.height, 1080);
  assert.equal(report.source, "presentmon");
  assert.ok(!("email" in report));
  assert.equal(
    (await (await f.call("/games/814380/performance?width=2560")).json()).items
      .length,
    0,
  );
});
test("Steam requirements are safe text, retain source, and handle missing recommended data", async () => {
  const f = await fixture();
  configureSteamDiscovery(
    async () =>
      new Response(
        JSON.stringify({
          814380: {
            success: true,
            data: {
              name: "Sekiro",
              pc_requirements: {
                minimum:
                  "<b>OS:</b> Windows<br><script>bad()</script>&amp; RAM",
              },
            },
          },
        }),
      ),
  );
  try {
    const result = await (await f.call("/games/814380/requirements")).json();
    assert.equal(result.minimum, "OS: Windows\n& RAM");
    assert.equal(result.recommended, null);
    assert.ok(result.sourceUrl.includes("/814380/"));
  } finally {
    configureSteamDiscovery();
  }
  assert.equal(stripSteamHtml("<li>GPU &lt;test&gt;</li>"), "GPU <test>");
});
test("Steam search validates IDs and does not search private library data", async () => {
  const f = await fixture();
  f.d1.sqlite
    .prepare(
      "INSERT INTO user_library(uid,game_key,title,status) VALUES ('alice','t_private','Secret title','backlog')",
    )
    .run();
  configureSteamDiscovery(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              type: "app",
              id: 814380,
              name: "Sekiro",
              tiny_image: "https://example.com/image.jpg",
            },
          ],
        }),
      ),
  );
  try {
    const response = await f.call("/search?q=Sekiro");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.items[0].steamId, 814380);
    assert.ok(!JSON.stringify(result).includes("Secret"));
  } finally {
    configureSteamDiscovery();
  }
});
test("post rate limit is enforced on the server", async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++)
    assert.equal((await f.call("/posts", "POST", post, "alice")).status, 201);
  assert.equal((await f.call("/posts", "POST", post, "alice")).status, 429);
});
test("public data removal leaves the private cloud library intact", async () => {
  const f = await fixture();
  await f.call("/posts", "POST", post, "alice");
  f.d1.sqlite
    .prepare(
      "INSERT INTO user_library(uid,game_key,title,status) VALUES ('alice','814380','Sekiro','completed')",
    )
    .run();
  await f.call("/me", "DELETE", undefined, "alice");
  assert.equal((await (await f.call("/posts")).json()).items.length, 0);
  assert.equal(
    f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM user_library").get().n,
    1,
  );
});

test("a suspended account cannot erase its restriction through public data removal", async () => {
  const f = await fixture();
  const { id } = await (await f.call("/posts", "POST", post, "alice")).json();
  await f.call(
    "/reports",
    "POST",
    { targetType: "post", targetId: id, reason: "Spam" },
    "bob",
  );
  const reports = await (
    await f.call("/admin/reports", "GET", undefined, "admin")
  ).json();
  await f.call(
    `/admin/reports/${reports.items[0].id}`,
    "PUT",
    { action: "suspend" },
    "admin",
  );
  assert.equal((await f.call("/me", "DELETE", undefined, "alice")).status, 200);
  assert.equal((await f.call("/posts", "POST", post, "alice")).status, 403);
  const profile = await (await f.call("/me", "GET", undefined, "alice")).json();
  assert.equal(profile.suspended, true);
});

test("hiding a review feed post also hides its game review and ranking contribution", async () => {
  const f = await fixture();
  for (const uid of ["alice", "bob", "carol"])
    await f.call(
      "/games/814380/reviews",
      "POST",
      { title: "Sekiro", score: 9, review: "A review" },
      uid,
    );
  const posts = await (await f.call("/posts")).json();
  const mine = posts.items.find((p) => p.uid === "alice");
  await f.call(
    "/reports",
    "POST",
    { targetType: "post", targetId: mine.id, reason: "Spam" },
    "bob",
  );
  const reports = await (
    await f.call("/admin/reports", "GET", undefined, "admin")
  ).json();
  await f.call(
    `/admin/reports/${reports.items[0].id}`,
    "PUT",
    { action: "hide" },
    "admin",
  );
  assert.equal(
    (await (await f.call("/games/814380/reviews")).json()).items.length,
    2,
  );
  const board = await (await f.call("/rankings?sort=score")).json();
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0].reviewCount, 2);
  const old = await worker.fetch(
    new Request("https://example.com/api/games/814380/reviews"),
    f.env,
  );
  assert.equal((await old.json()).reviews.length, 2);
});

test("Steam-key aliases do not double count one player in public statistics", async () => {
  const f = await fixture();
  for (const [gameKey, minutes] of [
    ["s_814380", 100],
    ["814380", 120],
  ])
    f.d1.sqlite
      .prepare(
        "INSERT INTO user_library(uid,game_key,title,steam_id,status,playtime_minutes) VALUES (?,?,?,?,?,?)",
      )
      .run("alice", gameKey, "Sekiro", 814380, "completed", minutes);
  await f.call(
    "/me",
    "PUT",
    { nickname: "Alice", bio: "", shareLibrary: true },
    "alice",
  );
  const board = await (await f.call("/rankings")).json();
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0].gameKey, "814380");
  assert.equal(board.items[0].players, 1);
  assert.equal(board.items[0].totalMinutes, 120);
});

test("concurrent attachment of an upload fails atomically instead of creating an image-less success", async () => {
  const f = await fixture();
  await f.call("/me", "GET", undefined, "alice");
  f.d1.sqlite
    .prepare(
      "INSERT INTO community_images(key,uid,mime,size) VALUES ('owned-image','alice','image/png',100)",
    )
    .run();
  const originalBatch = f.env.DB.batch;
  f.env.DB.batch = async (statements) => {
    f.d1.sqlite
      .prepare(
        "INSERT INTO community_posts(id,uid,game_key,game_title,kind,body) VALUES ('other-post','alice','814380','Sekiro','thought','Other post')",
      )
      .run();
    f.d1.sqlite
      .prepare(
        "UPDATE community_images SET post_id='other-post' WHERE key='owned-image'",
      )
      .run();
    return originalBatch(statements);
  };
  const response = await f.call(
    "/posts",
    "POST",
    { ...post, imageKeys: ["owned-image"] },
    "alice",
  );
  assert.equal(response.status, 409);
  assert.equal(
    f.d1.sqlite.prepare("SELECT COUNT(*) AS n FROM community_posts").get().n,
    1,
  );
  assert.equal(
    f.d1.sqlite
      .prepare("SELECT post_id FROM community_images WHERE key='owned-image'")
      .get().post_id,
    "other-post",
  );
});

test("feed excludeKind=review hides review posts while keeping social posts, and rankings deduplicates legacy t_ covers", async () => {
  const f = await fixture();
  await f.call("/posts", "POST", post, "alice");
  await f.call("/games/814380/reviews", "POST", { title: "Sekiro", score: 9, review: "Great combat" }, "alice");

  const socialFeed = await (await f.call("/posts?excludeKind=review")).json();
  assert.equal(socialFeed.items.length, 1);
  assert.equal(socialFeed.items[0].kind, "thought");

  f.d1.sqlite
    .prepare("INSERT INTO game_covers(game_key,title,steam_id,cover_url) VALUES ('108710','Alan Wake 2',108710,'/api/images/a.jpg'),('t_alanwake2','Alan Wake 2',NULL,'/api/images/b.jpg')")
    .run();
  const board = await (await f.call("/rankings?q=Alan+Wake+2")).json();
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0].gameKey, "108710");
});
