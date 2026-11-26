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

test("player rankings include all metrics, sort, paginate and respect sharing withdrawal", async () => {
  const f = await fixture();
  for (const [uid, game, status, minutes] of [
    ["alice", "814380", "completed", 120], ["alice", "292030", "completed", 60],
    ["bob", "814380", "playing", 1000], ["carol", "814380", "completed", 9999],
  ]) f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES (?,?,?,?,?)").run(uid, game, "Game", status, minutes);
  for (const uid of ["alice", "bob"]) {
    assert.equal((await f.call("/me", "PUT", { nickname: uid, bio: "", shareLibrary: true }, uid)).status, 200);
  }
  const completed = await (await f.call("/players")).json();
  assert.deepEqual(completed.items.map(p => p.uid), ["alice", "bob"]);
  assert.deepEqual(completed.items[0], { uid: "alice", nickname: "alice", totalGames: 2, completedGames: 2, totalMinutes: 180 });
  const hours = await (await f.call("/players?sort=hours&limit=1")).json();
  assert.equal(hours.items[0].uid, "bob");
  assert.equal(hours.hasMore, true);
  assert.equal((await (await f.call("/players?sort=hours&limit=1&offset=1")).json()).items[0].uid, "alice");
  assert.equal((await f.call("/players?sort=__proto__")).status, 400);
  assert.equal((await f.call("/players?sort=invalid")).status, 400);
  await f.call("/me", "PUT", { nickname: "alice", bio: "", shareLibrary: false }, "alice");
  assert.deepEqual((await (await f.call("/players")).json()).items.map(p => p.uid), ["bob"]);
});

test("game top players include completed libraries without FPS and report-only players without private hours", async () => {
  const f = await fixture();
  for (const [uid, status, minutes] of [["alice", "completed", 120], ["bob", "playing", 240], ["carol", "completed", 9999]]) {
    f.d1.sqlite.prepare("INSERT INTO user_library(uid,game_key,title,status,playtime_minutes) VALUES (?,'814380','Sekiro',?,?)").run(uid, status, minutes);
  }
  for (const uid of ["alice", "bob"]) await f.call("/me", "PUT", { nickname: uid, bio: "", shareLibrary: true }, uid);
  await f.call("/games/814380/performance", "POST", performance, "alice");
  await f.call("/games/814380/performance", "POST", performance, "carol");
  const all = await (await f.call("/games/814380/players")).json();
  assert.deepEqual(all.items.map(p => p.uid), ["bob", "alice", "carol"]);
  assert.equal(all.items[0].performance, null);
  assert.equal(all.items[1].performance.fpsAverage, 60);
  assert.equal(all.items[2].playtimeMinutes, null);
  assert.equal(JSON.stringify(all).includes("9999"), false);
  assert.equal(JSON.stringify(all).includes("@example.com"), false);
  const completed = await (await f.call("/games/814380/players?status=completed")).json();
  assert.deepEqual(completed.items.map(p => p.uid), ["alice", "carol"]);
  assert.equal((await f.call("/games/814380/players?status=wrong")).status, 400);
  f.d1.sqlite.prepare("UPDATE community_performance SET hidden=1 WHERE uid='carol'").run();
  assert.deepEqual((await (await f.call("/games/814380/players?status=completed")).json()).items.map(p => p.uid), ["alice"]);
  await f.call("/me", "PUT", { nickname: "alice", bio: "", shareLibrary: false }, "alice");
  const reportOnly = (await (await f.call("/games/814380/players?status=completed")).json()).items[0];
  assert.equal(reportOnly.uid, "alice");
  assert.equal(reportOnly.playtimeMinutes, null);
  await f.call("/games/814380/performance", "DELETE", undefined, "alice");
  assert.equal((await (await f.call("/games/814380/players?status=completed")).json()).items.length, 0);
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
test("sharing and withdrawal control lifetime rankings independently of reviews", async () => {
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
  assert.equal(board.items[0].players, 1);
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
  assert.equal((await f.call(`/images/${key}`)).status, 200);
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
