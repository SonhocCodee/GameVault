import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.ts";
import {
  classifySteam,
  classifyIgdb,
  configureGameMetadata,
  ensureGameMetadata,
} from "../worker/src/game-metadata.ts";
import {
  createTestWorkerEnv,
  createTestSessionToken,
} from "./test-helpers-cloudflare.js";

async function fixture(extraEnv = {}) {
  const { env, d1 } = await createTestWorkerEnv();
  Object.assign(env, extraEnv);
  const tokens = {};
  for (const uid of ["alice", "admin"]) {
    tokens[uid] = await createTestSessionToken({
      uid,
      email: uid === "admin" ? "son6232000@gmail.com" : `${uid}@example.com`,
      displayName: `${uid}@example.com`,
    });
    d1.sqlite
      .prepare("INSERT INTO users(uid,email,display_name) VALUES (?,?,?)")
      .run(uid, `${uid}@example.com`, `${uid}@example.com`);
  }
  const call = async (path, method = "GET", body, uid, ctx) =>
    worker.fetch(
      new Request(`https://example.com/api/community${path}`, {
        method,
        headers: { ...(uid ? { Authorization: `Bearer ${tokens[uid]}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      ctx,
    );
  return { env, d1, tokens, call };
}

test("classifySteam and classifyIgdb handle online, offline, and unknown", () => {
  assert.equal(classifySteam({ categories: [{ id: 36 }, { id: 1 }] }).classification, "online");
  assert.equal(classifySteam({ categories: [{ id: 38 }] }).classification, "online");
  assert.equal(classifySteam({ categories: [{ id: 1 }] }).classification, "online");
  assert.equal(classifySteam({ categories: [{ id: 2 }, { id: 38 }] }).classification, "offline");
  assert.equal(classifySteam({ categories: [{ id: 2 }, { id: 36 }] }).classification, "offline");
  assert.equal(classifySteam({ categories: [{ id: 2 }] }).classification, "offline");
  assert.equal(classifySteam({}).classification, "unknown");

  assert.equal(classifyIgdb({ id: 1, game_modes: [5] }).classification, "online");
  assert.equal(classifyIgdb({ id: 2, game_modes: [1, 6] }).classification, "offline");
  assert.equal(classifyIgdb({ id: 3, game_modes: [1, 3], multiplayer_modes: [{ onlinecoop: true }] }).classification, "offline");
  assert.equal(classifyIgdb({ id: 4, game_modes: [3], multiplayer_modes: [{ onlinecoop: true }] }).classification, "online");
  assert.equal(classifyIgdb({ id: 5, game_modes: [1, 3], multiplayer_modes: [{ offlinecoop: true }] }).classification, "offline");
  assert.equal(classifyIgdb({ id: 6, game_modes: [1] }).classification, "offline");
  assert.equal(classifyIgdb({ id: 7, game_modes: [] }).classification, "unknown");
});

test("ensureGameMetadata resolves Steam, IGDB fallback, ambiguous matches, missing creds, outages, TTL, manual overrides, and aliases", async (t) => {
  t.after(() => configureGameMetadata(undefined));
  const f = await fixture({
    TWITCH_CLIENT_ID: "cid",
    TWITCH_CLIENT_SECRET: "csec",
  });

  // 1. Steam resolution + s_ key alias canonicalization
  configureGameMetadata(async (url) => {
    if (String(url).includes("store.steampowered.com")) {
      return new Response(JSON.stringify({
        "814380": { success: true, data: { categories: [{ id: 2 }] } },
      }), { status: 200 });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  const sekiro = await ensureGameMetadata(f.env, { gameKey: "s_814380", title: "Sekiro" });
  assert.equal(sekiro.classification, "offline");
  assert.equal(sekiro.source, "steam");
  const row = f.d1.sqlite.prepare("SELECT game_key, steam_id, classification FROM game_metadata WHERE game_key='814380'").get();
  assert.equal(row.steam_id, 814380);
  assert.equal(row.classification, "offline");

  // 2. IGDB-only non-Steam game (e.g. Valorant)
  configureGameMetadata(async (url) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    if (String(url).includes("api.igdb.com/v4/games")) {
      return new Response(JSON.stringify([
        { id: 126459, name: "VALORANT", game_modes: [2, 5], multiplayer_modes: [{ onlinemax: 10 }] },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  const val = await ensureGameMetadata(f.env, { gameKey: "t_valorant", title: "Valorant" });
  assert.equal(val.classification, "online");
  assert.equal(val.source, "igdb");

  // 3. Ambiguous IGDB title match remains unknown (not offline!)
  configureGameMetadata(async (url) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    if (String(url).includes("api.igdb.com/v4/games")) {
      return new Response(JSON.stringify([
        { id: 1, name: "Doom", game_modes: [1] },
        { id: 2, name: "DOOM", game_modes: [1, 2] },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  const ambig = await ensureGameMetadata(f.env, { gameKey: "t_doom", title: "Doom" });
  assert.equal(ambig.classification, "unknown");

  // 4. Missing credentials leaves unknown game as unknown (never silently offline)
  const noCreds = await fixture();
  configureGameMetadata(async () => new Response("fail", { status: 500 }));
  const missingCreds = await ensureGameMetadata(noCreds.env, { gameKey: "t_lol", title: "League of Legends" });
  assert.equal(missingCreds.classification, "unknown");

  // 5. Outage preserves existing known classification even when TTL expired
  f.d1.sqlite
    .prepare("UPDATE game_metadata SET fetched_at=datetime('now','-31 days') WHERE game_key='814380'")
    .run();
  configureGameMetadata(async () => new Response("err", { status: 503 }));
  const preserved = await ensureGameMetadata(f.env, { gameKey: "814380", title: "Sekiro" });
  assert.equal(preserved.classification, "offline");
  assert.equal(preserved.source, "steam");

  // 6. Unknown TTL is 1 day; retry after 2 days resolves when provider recovers
  f.d1.sqlite
    .prepare("UPDATE game_metadata SET fetched_at=datetime('now','-2 days') WHERE game_key='t_doom'")
    .run();
  configureGameMetadata(async (url) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify([{ id: 1, name: "Doom", game_modes: [1] }]), { status: 200 });
  });
  const retried = await ensureGameMetadata(f.env, { gameKey: "t_doom", title: "Doom" });
  assert.equal(retried.classification, "offline");

  // 7. Manual override is protected from force refresh
  f.d1.sqlite
    .prepare("INSERT INTO game_covers(game_key,title,steam_id,cover_url) VALUES ('814380','Sekiro',814380,'/c.jpg')")
    .run();
  const putRes = await f.call("/admin/game-metadata/s_814380", "PUT", { classification: "hybrid" }, "admin");
  assert.equal(putRes.status, 200);
  const manual = await ensureGameMetadata(f.env, { gameKey: "814380", title: "Sekiro" }, true);
  assert.equal(manual.classification, "hybrid");
  assert.equal(manual.source, "manual");
});

test("rankings filter by classification, validate invalid values, enforce score eligibility, paginate, and do not await backfill", async (t) => {
  t.after(() => configureGameMetadata(undefined));
  const f = await fixture();

  // Seed accepted historical playtime across classifications. The provenance
  // migration preserves these totals as recorded time for ranking tie-breaks.
  const games = [
    ["10", "Valorant", null, "online", 600, 9],
    ["1245620", "Elden Ring", 1245620, "hybrid", 300, 10],
    ["814380", "Sekiro", 814380, "offline", 200, null],
    ["40", "Unknown Indie", null, null, 150, 8],
  ];
  for (const [key, title, steamId, cls, mins, score] of games) {
    f.d1.sqlite
      .prepare("INSERT INTO game_covers(game_key,title,steam_id,cover_url) VALUES (?,?,?,?)")
      .run(key, title, steamId, "/c.jpg");
    f.d1.sqlite
      .prepare("INSERT INTO user_library(uid,game_key,title,steam_id,status,playtime_minutes,recorded_playtime_minutes) VALUES (?,?,?,?,?,?,?)")
      .run("alice", key, title, steamId, "playing", mins, mins);
    if (cls) {
      f.d1.sqlite
        .prepare("INSERT INTO game_metadata(game_key,title,steam_id,classification,source,confidence) VALUES (?,?,?,?,?,?)")
        .run(key, title, steamId, cls, "steam", 0.9);
    }
    if (score !== null) {
      await f.call(`/games/${key}/reviews`, "POST", { title, score, review: "Solid" }, "alice");
    }
  }
  await f.call("/me", "PUT", { nickname: "Alice", bio: "", shareLibrary: true }, "alice");

  // Invalid classification -> 400
  assert.equal((await f.call("/rankings?classification=invalid")).status, 400);

  // Filter checks (offline includes legacy hybrid rows)
  for (const [cls, expected] of [
    ["all", ["10", "1245620", "814380", "40"]],
    ["online", ["10"]],
    ["offline", ["1245620", "814380"]],
    ["unknown", ["40"]],
  ]) {
    const res = await (await f.call(`/rankings?classification=${cls}`)).json();
    assert.deepEqual(res.items.map((x) => x.gameKey), expected);
    assert.ok(res.items.every((x) => x.recordedMinutes === x.totalMinutes));
  }

  // Score eligibility within filter: Sekiro (offline, 0 reviews) is excluded under sort=score, Elden Ring (1 review) is included
  const offlineScore = await (await f.call("/rankings?sort=score&classification=offline")).json();
  assert.deepEqual(offlineScore.items.map((x) => x.gameKey), ["1245620"]);

  // Pagination with classification=all
  const p1 = await (await f.call("/rankings?classification=all&limit=2&offset=0")).json();
  assert.equal(p1.items.length, 2);
  assert.equal(p1.hasMore, true);
  const p2 = await (await f.call("/rankings?classification=all&limit=2&offset=2")).json();
  assert.equal(p2.items.length, 2);
  assert.equal(p2.hasMore, false);

  // Backfill runs in waitUntil and does not block GET /rankings
  let resolveFetch;
  configureGameMetadata(() => new Promise((resolve) => { resolveFetch = resolve; }));
  const waited = [];
  const res = await f.call("/rankings?classification=all", "GET", undefined, undefined, {
    waitUntil(p) { waited.push(p); },
  });
  assert.equal(res.status, 200);
  assert.equal(waited.length, 1);
  if (resolveFetch) resolveFetch(new Response("{}", { status: 200 }));
  await Promise.allSettled(waited);
});
