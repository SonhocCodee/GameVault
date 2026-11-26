import type { Env, RouteHandler } from "../types.ts";
import { authenticate, isAdminUser } from "../auth.ts";
import { jsonResponse } from "../utils.ts";
import type { Router } from "../router.ts";
import { handleSubmitReview } from "./reviews.ts";
import {
  boundedBody,
  communityFailure,
  CommunityError,
  ensureProfile,
  jsonBody,
  key,
  number,
  page,
  paging,
  publicUrl,
  rateLimit,
  refreshSharedLibrary,
  requireAdmin,
  requireUser,
  safeName,
  text,
  visibleTo,
} from "../community-common.ts";
async function viewer(request: Request, env: Env) {
  return (await authenticate(request, env))?.uid || "";
}
async function postFor(env: Env, id: string, uid: string) {
  const post = await env.DB.prepare(
    `SELECT p.* FROM community_posts p LEFT JOIN community_profiles cp ON cp.uid=p.uid
    WHERE p.id=? AND p.hidden=0 AND COALESCE(cp.suspended,0)=0 AND ${visibleTo("p")}`,
  )
    .bind(id, uid, uid)
    .first<any>();
  if (!post) throw new CommunityError("Post not found", 404);
  return post;
}
async function notify(
  env: Env,
  uid: string,
  actor: string,
  postId: string,
  kind: string,
) {
  if (uid === actor) return;
  const blocked = await env.DB.prepare(
    "SELECT 1 FROM community_blocks WHERE (uid=? AND blocked_uid=?) OR (uid=? AND blocked_uid=?)",
  )
    .bind(uid, actor, actor, uid)
    .first();
  if (blocked) return;
  await env.DB.prepare(
    `INSERT INTO community_notifications(id,uid,actor_uid,post_id,kind) VALUES (?,?,?,?,?)
    ON CONFLICT(uid,actor_uid,post_id,kind) DO UPDATE SET is_read=0,created_at=datetime('now')`,
  )
    .bind(crypto.randomUUID(), uid, actor, postId, kind)
    .run();
}
async function deletePost(env: Env, id: string) {
  const images =
    (
      await env.DB.prepare("SELECT key FROM community_images WHERE post_id=?")
        .bind(id)
        .all<any>()
    ).results || [];
  await env.DB.batch(
    [
      "community_likes",
      "community_saved",
      "community_comments",
      "community_notifications",
      "community_images",
    ]
      .map((table) =>
        env.DB.prepare(`DELETE FROM ${table} WHERE post_id=?`).bind(id),
      )
      .concat([
        env.DB.prepare("DELETE FROM community_posts WHERE id=?").bind(id),
      ]),
  );
  if (env.IMAGES_BUCKET && images.length)
    await env.IMAGES_BUCKET.delete(images.map((i) => `community/${i.key}`));
}
async function listPosts(request: Request, env: Env, url: URL, id?: string) {
  const uid = await viewer(request, env);
  const { limit, offset } = paging(url);
  const where = [
    "p.hidden=0",
    "COALESCE(cp.suspended,0)=0",
    "NOT (p.kind='review' AND TRIM(p.body)='')",
    visibleTo("p"),
  ];
  const binds: any[] = [uid, uid, uid, uid];
  if (id) {
    where.push("p.id=?");
    binds.push(id);
  }
  for (const [param, column] of [
    ["gameKey", "game_key"],
    ["uid", "uid"],
    ["kind", "kind"],
  ]) {
    const value = url.searchParams.get(param);
    if (value) {
      where.push(`p.${column}=?`);
      binds.push(text(value, 160));
    }
  }
  if (url.searchParams.get("saved") === "true") {
    if (!uid) throw new CommunityError("Sign in to view saved posts", 401);
    where.push(
      "EXISTS(SELECT 1 FROM community_saved s WHERE s.post_id=p.id AND s.uid=?)",
    );
    binds.push(uid);
  }
  const rows =
    (
      await env.DB.prepare(
        `SELECT p.*,cp.nickname,u.photo_url AS avatar_url,
    rt.score AS review_score,rt.dropped AS review_dropped,rt.playtime_minutes AS review_playtime,
    (SELECT COUNT(*) FROM community_likes l WHERE l.post_id=p.id) AS likes,
    (SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id AND c.hidden=0 AND ${visibleTo("c")}) AS comments,
    EXISTS(SELECT 1 FROM community_likes l WHERE l.post_id=p.id AND l.uid=?) AS liked,
    EXISTS(SELECT 1 FROM community_saved s WHERE s.post_id=p.id AND s.uid=?) AS saved
    FROM community_posts p
    LEFT JOIN community_profiles cp ON cp.uid=p.uid
    LEFT JOIN users u ON u.uid=p.uid
    LEFT JOIN ratings rt ON rt.uid=p.uid AND rt.game_key=p.game_key AND p.kind='review'
    WHERE ${where.join(" AND ")}
    ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`,
      )
        .bind(uid, uid, ...binds, limit + 1, offset)
        .all<any>()
    ).results || [];
  // Each page is bounded to at most 51 posts and three images per post.
  const images = rows.length
    ? (
        await env.DB.prepare(
          `SELECT post_id,key FROM community_images WHERE post_id IN (${rows.map(() => "?").join(",")}) ORDER BY key`,
        )
          .bind(...rows.map((r) => r.id))
          .all<any>()
      ).results || []
    : [];
  const items = rows.map((r) => {
    const avatar = publicUrl(r.avatar_url);
    return {
      id: r.id,
      uid: r.uid,
      nickname: safeName(r.nickname),
      ...(avatar ? { avatarUrl: avatar } : {}),
      gameKey: r.game_key,
      title: r.game_title,
      steamId: r.steam_id,
      coverUrl: publicUrl(r.cover_url),
      kind: r.kind,
      body: r.body,
      spoiler: !!r.spoiler,
      edited: !!r.edited,
      createdAt: r.created_at,
      likes: Number(r.likes),
      comments: Number(r.comments),
      liked: !!r.liked,
      saved: !!r.saved,
      ...(r.review_score != null ? { reviewScore: Number(r.review_score) } : {}),
      ...(r.review_dropped != null ? { reviewDropped: !!r.review_dropped } : {}),
      ...(r.review_playtime != null ? { playtimeMinutes: Number(r.review_playtime) } : {}),
      images: images
        .filter((i) => i.post_id === r.id)
        .map((i) => `/api/community/images/${i.key}`),
    };
  });
  if (id) {
    if (!items.length) throw new CommunityError("Post not found", 404);
    return jsonResponse(items[0]);
  }
  return jsonResponse(page(items, limit, offset));
}
export function registerCommunityRoutes(router: Router) {
  const add = (method: string, path: string, handler: RouteHandler) =>
    router.add(method as any, `/api/community${path}`, async (r, e, c) => {
      try {
        return await handler(r, e, c);
      } catch (error) {
        return communityFailure(error);
      }
    });
  add("GET", "/config", async (_request, env) =>
    jsonResponse({
      googleClientId: env.WEB_GOOGLE_CLIENT_ID?.split(",")[0]?.trim() || null,
    }),
  );
  add("GET", "/me", async (request, env) => {
    const user = await requireUser(request, env, true);
    await ensureProfile(env, user);
    const p = await env.DB.prepare(
      "SELECT cp.*,u.photo_url AS avatar_url FROM community_profiles cp LEFT JOIN users u ON u.uid=cp.uid WHERE cp.uid=?",
    )
      .bind(user.uid)
      .first<any>();
    return jsonResponse({
      uid: user.uid,
      nickname: safeName(p.nickname),
      bio: p.bio,
      avatarUrl: publicUrl(p.avatar_url || user.photoUrl),
      shareLibrary: !!p.share_library,
      suspended: !!p.suspended,
      isAdmin: isAdminUser(user, env),
    });
  });
  add("PUT", "/me", async (request, env) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "profile", 10);
    const b = await jsonBody(request);
    const nickname = text(b.nickname, 60, true);
    if (nickname.includes("@"))
      throw new CommunityError("Use a nickname instead of an email address");
    if (typeof b.shareLibrary !== "boolean")
      throw new CommunityError("Sharing preference is required");
    await env.DB.prepare(
      `INSERT INTO community_profiles(uid,nickname,bio,share_library) VALUES (?,?,?,?)
      ON CONFLICT(uid) DO UPDATE SET nickname=excluded.nickname,bio=excluded.bio,share_library=excluded.share_library,updated_at=datetime('now')`,
    )
      .bind(user.uid, nickname, text(b.bio, 300), b.shareLibrary ? 1 : 0)
      .run();
    await refreshSharedLibrary(env, user.uid);
    return jsonResponse({
      success: true,
    });
  });
  add("DELETE", "/me", async (request, env) => {
    const user = await requireUser(request, env, true);
    const posts =
      (
        await env.DB.prepare("SELECT id FROM community_posts WHERE uid=?")
          .bind(user.uid)
          .all<any>()
      ).results || [];
    for (const p of posts) await deletePost(env, p.id);
    const pending =
      (
        await env.DB.prepare("SELECT key FROM community_images WHERE uid=?")
          .bind(user.uid)
          .all<any>()
      ).results || [];
    if (env.IMAGES_BUCKET && pending.length)
      await env.IMAGES_BUCKET.delete(pending.map((i) => `community/${i.key}`));
    await env.DB.batch(
      [
        "community_library",
        "community_likes",
        "community_saved",
        "community_comments",
        "community_review_meta",
        "community_performance",
        "community_images",
        "ratings",
      ]
        .map((t) =>
          env.DB.prepare(`DELETE FROM ${t} WHERE uid=?`).bind(user.uid),
        )
        .concat([
          env.DB.prepare(
            "DELETE FROM community_profiles WHERE uid=? AND suspended=0",
          ).bind(user.uid),
          env.DB.prepare(
            "UPDATE community_profiles SET nickname='Player',bio='',share_library=0 WHERE uid=? AND suspended=1",
          ).bind(user.uid),
          env.DB.prepare(
            "DELETE FROM community_notifications WHERE uid=? OR actor_uid=?",
          ).bind(user.uid, user.uid),
          env.DB.prepare(
            "DELETE FROM community_blocks WHERE uid=? OR blocked_uid=?",
          ).bind(user.uid, user.uid),
          env.DB.prepare(
            "DELETE FROM community_reports WHERE reporter_uid=?",
          ).bind(user.uid),
        ]),
    );
    return jsonResponse({
      success: true,
    });
  });
  add("GET", "/profiles/:uid", async (request, env, ctx) => {
    const uid = text(ctx.params?.uid, 160, true);
    const who = await viewer(request, env);
    const p = await env.DB.prepare(
      `SELECT p.*,u.photo_url AS avatar_url FROM community_profiles p LEFT JOIN users u ON u.uid=p.uid WHERE p.uid=? AND p.suspended=0 AND ${visibleTo("p")}`,
    )
      .bind(uid, who, who)
      .first<any>();
    if (!p) throw new CommunityError("Profile not found", 404);
    const games = p.share_library
      ? (
          await env.DB.prepare(
            "SELECT * FROM community_library WHERE uid=? ORDER BY playtime_minutes DESC LIMIT 200",
          )
            .bind(uid)
            .all<any>()
        ).results || []
      : [];
    return jsonResponse({
      uid,
      nickname: safeName(p.nickname),
      bio: p.bio,
      avatarUrl: publicUrl(p.avatar_url),
      shareLibrary: !!p.share_library,
      games: games.map((g) => ({
        gameKey: g.game_key,
        title: g.title,
        steamId: g.steam_id,
        coverUrl: publicUrl(g.cover_url),
        status: g.status,
        playtimeMinutes: g.playtime_minutes,
      })),
    });
  });
  add("GET", "/me/comments", async (request, env, ctx) => {
    const user = await requireUser(request, env, true);
    const { limit, offset } = paging(ctx.url);
    const rows = (await env.DB.prepare(
      `SELECT c.id,c.post_id,c.body,c.created_at,p.game_title,p.spoiler
      FROM community_comments c JOIN community_posts p ON p.id=c.post_id
      LEFT JOIN community_profiles cp ON cp.uid=p.uid
      WHERE c.uid=? AND c.hidden=0 AND p.hidden=0 AND COALESCE(cp.suspended,0)=0 AND ${visibleTo("p")}
      ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`,
    ).bind(user.uid, user.uid, user.uid, limit + 1, offset).all<any>()).results || [];
    return jsonResponse(page(rows.map(c => ({
      id: c.id, postId: c.post_id, body: c.body, createdAt: c.created_at,
      gameTitle: c.game_title, spoiler: !!c.spoiler,
    })), limit, offset));
  });
  add("POST", "/me/reviews/sync", async (request, env) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "review-sync", 30, 300);
    const bytes = await boundedBody(request, 512 * 1024);
    let body;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new CommunityError("Invalid JSON body"); }
    if (!Array.isArray(body?.items) || body.items.length > 50)
      throw new CommunityError("Expected at most 50 reviews");
    const items = body.items.map((r: any) => ({
      gameKey: key(r.gameKey), title: text(r.title, 160, true),
      coverUrl: publicUrl(r.coverUrl), score: number(r.score, 1, 10),
      review: text(r.review, 4000), dropped: r.dropped === true ? 1 : 0,
      playtime: number(r.playtimeMinutes ?? 0, 0, 10000000, true),
      updatedAt: text(r.updatedAt, 40, true),
    }));
    if (items.some((r: any) => !Number.isFinite(Date.parse(r.updatedAt))))
      throw new CommunityError("Invalid review timestamp");
    await ensureProfile(env, user);
    const statements = items.flatMap((r: any) => [
      env.DB.prepare(`INSERT INTO ratings(id,uid,game_key,game_title,cover_url,score,review,dropped,playtime_minutes,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(uid,game_key) DO UPDATE SET
        game_title=excluded.game_title,cover_url=COALESCE(excluded.cover_url,ratings.cover_url),
        score=excluded.score,review=excluded.review,dropped=excluded.dropped,
        playtime_minutes=excluded.playtime_minutes,updated_at=excluded.updated_at
        WHERE julianday(excluded.updated_at)>=julianday(ratings.updated_at)`)
        .bind(`${user.uid}_${r.gameKey}`, user.uid, r.gameKey, r.title, r.coverUrl, r.score, r.review, r.dropped, r.playtime, new Date(r.updatedAt).toISOString()),
      env.DB.prepare(`INSERT INTO community_posts(id,uid,game_key,game_title,cover_url,kind,body,created_at,updated_at)
        SELECT ?,uid,game_key,game_title,cover_url,'review',review,created_at,updated_at
        FROM ratings WHERE uid=? AND game_key=?
        ON CONFLICT(uid,game_key) WHERE kind='review' DO UPDATE SET
          game_title=excluded.game_title,cover_url=COALESCE(excluded.cover_url,community_posts.cover_url),
          body=excluded.body,edited=1,updated_at=excluded.updated_at`)
        .bind(crypto.randomUUID(), user.uid, r.gameKey),
    ]);
    let migrated = 0;
    if (body.includeStoredScores === true) {
      const stored = (await env.DB.prepare(`SELECT l.game_key,l.title,l.cover_url,l.steam_id,l.user_score
        FROM user_library l WHERE l.uid=? AND l.is_deleted=0 AND l.user_score BETWEEN 1 AND 10
        AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.uid=l.uid AND r.game_key=
          CASE WHEN l.steam_id>0 THEN CAST(l.steam_id AS TEXT)
            WHEN l.game_key GLOB 's_[0-9]*' THEN SUBSTR(l.game_key,3) ELSE l.game_key END)`)
        .bind(user.uid).all<any>()).results || [];
      for (const row of stored) {
        const gameKey = key(row.steam_id && row.steam_id > 0 ? String(row.steam_id) : row.game_key);
        statements.push(env.DB.prepare(`INSERT INTO ratings(id,uid,game_key,game_title,cover_url,score,review,dropped,playtime_minutes,updated_at)
          VALUES (?,?,?,?,?,?, '',0,0,datetime('now')) ON CONFLICT(uid,game_key) DO NOTHING`)
          .bind(`${user.uid}_${gameKey}`, user.uid, gameKey, text(row.title,160,true), publicUrl(row.cover_url), Number(row.user_score)));
        statements.push(env.DB.prepare(`INSERT INTO community_posts(id,uid,game_key,game_title,cover_url,kind,body)
          SELECT ?,uid,game_key,game_title,cover_url,'review',review FROM ratings WHERE uid=? AND game_key=?
          ON CONFLICT(uid,game_key) WHERE kind='review' DO NOTHING`)
          .bind(crypto.randomUUID(), user.uid, gameKey));
      }
      migrated = stored.length;
    }
    if (statements.length) await env.DB.batch(statements);
    return jsonResponse({ success: true, synced: items.length, migrated });
  });
  add("GET", "/players", async (request, env, ctx) => {
    const uid = await viewer(request, env);
    const { limit, offset } = paging(ctx.url);
    const sort = ctx.url.searchParams.get("sort") || "completed";
    const orders: Record<string, string> = {
      completed: "completedGames DESC,totalMinutes DESC",
      hours: "totalMinutes DESC,completedGames DESC",
      games: "totalGames DESC,completedGames DESC",
    };
    const order = Object.hasOwn(orders, sort) ? orders[sort] : undefined;
    if (!order) throw new CommunityError("Invalid player sort");
    const rows = (await env.DB.prepare(`
      SELECT p.uid,p.nickname,u.photo_url AS avatar_url,COUNT(*) AS totalGames,
        SUM(CASE WHEN l.status='completed' THEN 1 ELSE 0 END) AS completedGames,
        SUM(l.playtime_minutes) AS totalMinutes
      FROM community_profiles p JOIN community_library l ON l.uid=p.uid
      LEFT JOIN users u ON u.uid=p.uid
      WHERE p.share_library=1 AND p.suspended=0 AND ${visibleTo("p")}
      GROUP BY p.uid ORDER BY ${order},p.uid ASC LIMIT ? OFFSET ?
    `).bind(uid, uid, limit + 1, offset).all<any>()).results || [];
    return jsonResponse(page(rows.map(r => {
      const avatar = publicUrl(r.avatar_url);
      return {
        uid: r.uid, nickname: safeName(r.nickname),
        ...(avatar ? { avatarUrl: avatar } : {}),
        totalGames: Number(r.totalGames),
        completedGames: Number(r.completedGames), totalMinutes: Number(r.totalMinutes),
      };
    }), limit, offset));
  });
  add("GET", "/posts", async (r, e, c) => listPosts(r, e, c.url));
  add("GET", "/posts/:id", async (r, e, c) =>
    listPosts(r, e, c.url, text(c.params?.id, 100, true)),
  );
  add("POST", "/posts", async (request, env) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "post", 5, 300);
    await ensureProfile(env, user);
    const b = await jsonBody(request);
    const gameKey = key(b.gameKey),
      title = text(b.title, 160, true),
      body = text(b.body, 4000, true);
    if (!["photo", "thought", "question", "completed"].includes(b.kind))
      throw new CommunityError("Invalid post kind");
    if (b.imageKeys != null && !Array.isArray(b.imageKeys))
      throw new CommunityError("Image keys must be an array");
    const imageKeys: string[] = Array.isArray(b.imageKeys)
      ? b.imageKeys.map((value: unknown) => text(value, 100, true))
      : [];
    if (imageKeys.length > 3 || new Set(imageKeys).size !== imageKeys.length)
      throw new CommunityError("Select at most three distinct images");
    const id = crypto.randomUUID();
    const stmts = [
      env.DB.prepare(
        `INSERT INTO community_posts(id,uid,game_key,game_title,steam_id,cover_url,kind,body,spoiler)
         SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM community_images WHERE uid=? AND post_id IS NULL AND key IN (${imageKeys.map(() => "?").join(",") || "NULL"}))=?`,
      ).bind(
        id,
        user.uid,
        gameKey,
        title,
        b.steamId == null ? null : number(b.steamId, 1, 2147483647, true),
        publicUrl(b.coverUrl),
        b.kind,
        body,
        b.spoiler === true ? 1 : 0,
        user.uid,
        ...imageKeys,
        imageKeys.length,
      ),
    ];
    for (const imageKey of imageKeys) {
      const image = await env.DB.prepare(
        "SELECT uid,post_id FROM community_images WHERE key=?",
      )
        .bind(text(imageKey, 100, true))
        .first<any>();
      if (!image || image.uid !== user.uid || image.post_id)
        throw new CommunityError(
          "Image is not an unattached upload owned by you",
          403,
        );
      stmts.push(
        env.DB.prepare(
          "UPDATE community_images SET post_id=? WHERE key=? AND uid=? AND post_id IS NULL AND EXISTS(SELECT 1 FROM community_posts WHERE id=?)",
        ).bind(id, imageKey, user.uid, id),
      );
    }
    const result = await env.DB.batch(stmts);
    if (result[0].meta?.changes !== 1)
      throw new CommunityError(
        "Selected uploads changed. Please retry the post.",
        409,
      );
    return jsonResponse(
      {
        id,
      },
      201,
    );
  });
  add("PUT", "/posts/:id", async (request, env, ctx) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "edit", 20);
    const b = await jsonBody(request);
    const p = await postFor(env, text(ctx.params?.id, 100, true), user.uid);
    if (p.uid !== user.uid)
      throw new CommunityError("Only the author can edit this post", 403);
    if (p.kind === "review")
      throw new CommunityError("Edit this review on its game page");
    await env.DB.prepare(
      "UPDATE community_posts SET body=?,spoiler=?,edited=1,updated_at=datetime('now') WHERE id=? AND uid=?",
    )
      .bind(
        text(b.body, 4000, true),
        b.spoiler === true ? 1 : 0,
        p.id,
        user.uid,
      )
      .run();
    return jsonResponse({
      success: true,
    });
  });
  add("DELETE", "/posts/:id", async (request, env, ctx) => {
    const user = await requireUser(request, env, true);
    const id = text(ctx.params?.id, 100, true);
    const p = await env.DB.prepare(
      "SELECT uid,kind,game_key FROM community_posts WHERE id=?",
    )
      .bind(id)
      .first<any>();
    if (!p) throw new CommunityError("Post not found", 404);
    if (p.uid !== user.uid)
      throw new CommunityError("Only the author can delete this post", 403);
    if (p.kind === "review")
      await env.DB.batch([
        env.DB.prepare("DELETE FROM ratings WHERE uid=? AND game_key=?").bind(
          user.uid,
          p.game_key,
        ),
        env.DB.prepare(
          "DELETE FROM community_review_meta WHERE uid=? AND game_key=?",
        ).bind(user.uid, p.game_key),
      ]);
    await deletePost(env, id);
    return jsonResponse({
      success: true,
    });
  });
  for (const action of ["like", "save"])
    for (const method of ["PUT", "DELETE"])
      add(method, `/posts/:id/${action}`, async (request, env, ctx) => {
        const user = await requireUser(request, env);
        await rateLimit(env, user.uid, "interaction", 60);
        const id = text(ctx.params?.id, 100, true);
        const p = await postFor(env, id, user.uid);
        const table = action === "like" ? "community_likes" : "community_saved";
        if (method === "PUT") {
          const result = await env.DB.prepare(
            `INSERT OR IGNORE INTO ${table}(uid,post_id) VALUES (?,?)`,
          )
            .bind(user.uid, id)
            .run();
          if (action === "like" && (result.meta?.changes || 0) > 0)
            await notify(env, p.uid, user.uid, id, "like");
        } else
          await env.DB.prepare(`DELETE FROM ${table} WHERE uid=? AND post_id=?`)
            .bind(user.uid, id)
            .run();
        return jsonResponse({
          success: true,
        });
      });
  add("GET", "/posts/:id/comments", async (request, env, ctx) => {
    const uid = await viewer(request, env),
      id = text(ctx.params?.id, 100, true);
    await postFor(env, id, uid);
    const { limit, offset } = paging(ctx.url);
    const rows =
      (
        await env.DB.prepare(
          `SELECT c.*,p.nickname,u.photo_url AS avatar_url FROM community_comments c LEFT JOIN community_profiles p ON p.uid=c.uid LEFT JOIN users u ON u.uid=c.uid
      WHERE c.post_id=? AND c.hidden=0 AND COALESCE(p.suspended,0)=0 AND ${visibleTo("c")}
      ORDER BY c.created_at,c.id LIMIT ? OFFSET ?`,
        )
          .bind(id, uid, uid, limit + 1, offset)
          .all<any>()
      ).results || [];
    return jsonResponse(
      page(
        rows.map((c) => ({
          id: c.id,
          postId: c.post_id,
          uid: c.uid,
          nickname: safeName(c.nickname),
          avatarUrl: publicUrl(c.avatar_url),
          body: c.body,
          createdAt: c.created_at,
        })),
        limit,
        offset,
      ),
    );
  });
  add("POST", "/posts/:id/comments", async (request, env, ctx) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "comment", 10);
    await ensureProfile(env, user);
    const p = await postFor(env, text(ctx.params?.id, 100, true), user.uid);
    const b = await jsonBody(request),
      id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO community_comments(id,uid,post_id,body) VALUES (?,?,?,?)",
    )
      .bind(id, user.uid, p.id, text(b.body, 1500, true))
      .run();
    await notify(env, p.uid, user.uid, p.id, "comment");
    return jsonResponse(
      {
        id,
      },
      201,
    );
  });
  add("DELETE", "/comments/:id", async (request, env, ctx) => {
    const user = await requireUser(request, env, true);
    const id = text(ctx.params?.id, 100, true);
    const c = await env.DB.prepare(
      "SELECT uid FROM community_comments WHERE id=?",
    )
      .bind(id)
      .first<any>();
    if (!c) throw new CommunityError("Comment not found", 404);
    if (c.uid !== user.uid)
      throw new CommunityError("Only the author can delete this comment", 403);
    await env.DB.prepare("DELETE FROM community_comments WHERE id=?")
      .bind(id)
      .run();
    return jsonResponse({
      success: true,
    });
  });
  add("POST", "/uploads", async (request, env) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "upload", 20, 86400);
    const expired =
      (
        await env.DB.prepare(
          "SELECT key FROM community_images WHERE uid=? AND post_id IS NULL AND created_at<datetime('now','-1 day') LIMIT 50",
        )
          .bind(user.uid)
          .all<any>()
      ).results || [];
    if (expired.length) {
      await env.DB.prepare(
        `DELETE FROM community_images WHERE key IN (${expired.map(() => "?").join(",")})`,
      )
        .bind(...expired.map((i) => i.key))
        .run();
      if (env.IMAGES_BUCKET)
        await env.IMAGES_BUCKET.delete(
          expired.map((i) => `community/${i.key}`),
        );
    }
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM community_images WHERE uid=? AND post_id IS NULL",
    )
      .bind(user.uid)
      .first<any>();
    if (Number(pending?.n) >= 6)
      throw new CommunityError(
        "Remove unused uploads before uploading more images",
      );
    const bytes = await boundedBody(request, 1024 * 1024);
    const mime = (request.headers.get("Content-Type") || "").split(";")[0];
    const ascii = (start: number, end: number) =>
      String.fromCharCode(...bytes.slice(start, end));
    const valid =
      (mime === "image/jpeg" &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255) ||
      (mime === "image/png" &&
        bytes[0] === 137 &&
        ascii(1, 4) === "PNG" &&
        bytes[4] === 13 &&
        bytes[5] === 10 &&
        bytes[6] === 26 &&
        bytes[7] === 10) ||
      (mime === "image/webp" &&
        ascii(0, 4) === "RIFF" &&
        ascii(8, 12) === "WEBP");
    if (!valid || bytes.length < 16)
      throw new CommunityError("Upload a valid JPEG, PNG or WebP image", 415);
    const imageKey = crypto.randomUUID();
    if (env.IMAGES_BUCKET)
      await env.IMAGES_BUCKET.put(`community/${imageKey}`, bytes, {
        httpMetadata: {
          contentType: mime,
        },
      });
    try {
      await env.DB.prepare(
        "INSERT INTO community_images(key,uid,mime,data,size) VALUES (?,?,?,?,?)",
      )
        .bind(
          imageKey,
          user.uid,
          mime,
          env.IMAGES_BUCKET ? null : bytes,
          bytes.length,
        )
        .run();
    } catch (error) {
      if (env.IMAGES_BUCKET)
        await env.IMAGES_BUCKET.delete(`community/${imageKey}`);
      throw error;
    }
    return jsonResponse(
      {
        key: imageKey,
      },
      201,
    );
  });
  add("DELETE", "/uploads/:key", async (request, env, ctx) => {
    const user = await requireUser(request, env, true),
      id = text(ctx.params?.key, 100, true);
    const image = await env.DB.prepare(
      "SELECT uid,post_id FROM community_images WHERE key=?",
    )
      .bind(id)
      .first<any>();
    if (!image || image.uid !== user.uid || image.post_id)
      throw new CommunityError("Unattached upload not found", 404);
    await env.DB.prepare(
      "DELETE FROM community_images WHERE key=? AND uid=? AND post_id IS NULL",
    )
      .bind(id, user.uid)
      .run();
    if (env.IMAGES_BUCKET) await env.IMAGES_BUCKET.delete(`community/${id}`);
    return jsonResponse({
      success: true,
    });
  });
  add("DELETE", "/uploads", async (request, env) => {
    const user = await requireUser(request, env, true);
    const unused =
      (
        await env.DB.prepare(
          "SELECT key FROM community_images WHERE uid=? AND post_id IS NULL",
        )
          .bind(user.uid)
          .all<any>()
      ).results || [];
    await env.DB.prepare(
      "DELETE FROM community_images WHERE uid=? AND post_id IS NULL",
    )
      .bind(user.uid)
      .run();
    if (env.IMAGES_BUCKET && unused.length)
      await env.IMAGES_BUCKET.delete(unused.map((i) => `community/${i.key}`));
    return jsonResponse({
      success: true,
    });
  });
  add("GET", "/images/:key", async (request, env, ctx) => {
    const uid = await viewer(request, env);
    const image = await env.DB.prepare(
      `SELECT i.* FROM community_images i JOIN community_posts p ON p.id=i.post_id
      LEFT JOIN community_profiles cp ON cp.uid=p.uid WHERE i.key=? AND p.hidden=0 AND COALESCE(cp.suspended,0)=0 AND ${visibleTo("p")}`,
    )
      .bind(text(ctx.params?.key, 100, true), uid, uid)
      .first<any>();
    if (!image) throw new CommunityError("Image not found", 404);
    const object = env.IMAGES_BUCKET
      ? await env.IMAGES_BUCKET.get(`community/${image.key}`)
      : null;
    const data = object?.body || image.data;
    if (!data) throw new CommunityError("Image not found", 404);
    return new Response(data, {
      headers: {
        "Content-Type": image.mime,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  add("GET", "/games/:gameKey/reviews", async (request, env, ctx) => {
    const gameKey = key(ctx.params?.gameKey),
      uid = await viewer(request, env);
    const { limit, offset } = paging(ctx.url);
    const rows =
      (
        await env.DB.prepare(
          `SELECT r.*,cp.nickname,u.photo_url AS avatar_url,COALESCE(m.spoiler,0) AS spoiler FROM ratings r
      LEFT JOIN community_profiles cp ON cp.uid=r.uid LEFT JOIN users u ON u.uid=r.uid LEFT JOIN community_review_meta m ON m.uid=r.uid AND m.game_key=r.game_key
      WHERE r.game_key=? AND COALESCE(cp.suspended,0)=0 AND COALESCE(m.hidden,0)=0 AND ${visibleTo("r")}
      ORDER BY r.updated_at DESC,r.id DESC LIMIT ? OFFSET ?`,
        )
          .bind(gameKey, uid, uid, limit + 1, offset)
          .all<any>()
      ).results || [];
    return jsonResponse(
      page(
        rows.map((r) => ({
          id: r.id,
          uid: r.uid,
          nickname: safeName(r.nickname),
          avatarUrl: publicUrl(r.avatar_url),
          gameKey: r.game_key,
          score: Number(r.score),
          review: r.review,
          spoiler: !!r.spoiler,
          playtimeMinutes: Number(r.playtime_minutes),
          dropped: !!r.dropped,
          updatedAt: r.updated_at,
        })),
        limit,
        offset,
      ),
    );
  });
  add("POST", "/games/:gameKey/reviews", async (request, env, ctx) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "review", 5, 300);
    await ensureProfile(env, user);
    const gameKey = key(ctx.params?.gameKey),
      b = await jsonBody(request);
    const safe = {
      gameTitle: text(b.title, 160, true),
      coverUrl: publicUrl(b.coverUrl),
      score: number(b.score, 1, 10),
      review: text(b.review, 4000, true),
      dropped: b.dropped === true,
      dropReason: text(b.dropReason, 300),
      playtimeMinutes:
        b.playtimeMinutes == null
          ? 0
          : number(b.playtimeMinutes, 0, 10000000, true),
    };
    const result = await handleSubmitReview(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(safe),
      }),
      env,
      ctx,
    );
    if (!result.ok) return result;
    await env.DB.prepare(
      `INSERT INTO community_review_meta(uid,game_key,spoiler) VALUES (?,?,?)
      ON CONFLICT(uid,game_key) DO UPDATE SET spoiler=excluded.spoiler`,
    )
      .bind(user.uid, gameKey, b.spoiler === true ? 1 : 0)
      .run();
    // Review edits update their feed entry rather than generating duplicate posts.
    const old = await env.DB.prepare(
      "SELECT id FROM community_posts WHERE uid=? AND game_key=? AND kind='review'",
    )
      .bind(user.uid, gameKey)
      .first<any>();
    if (old)
      await env.DB.prepare(
        "UPDATE community_posts SET body=?,spoiler=?,edited=1,updated_at=datetime('now') WHERE id=?",
      )
        .bind(safe.review, b.spoiler === true ? 1 : 0, old.id)
        .run();
    else
      await env.DB.prepare(
        "INSERT INTO community_posts(id,uid,game_key,game_title,cover_url,kind,body,spoiler) VALUES (?,?,?,?,?,'review',?,?)",
      )
        .bind(
          crypto.randomUUID(),
          user.uid,
          gameKey,
          safe.gameTitle,
          safe.coverUrl,
          safe.review,
          b.spoiler === true ? 1 : 0,
        )
        .run();
    return jsonResponse({
      success: true,
    });
  });
  add("DELETE", "/games/:gameKey/reviews", async (request, env, ctx) => {
    const user = await requireUser(request, env, true),
      gameKey = key(ctx.params?.gameKey);
    const old = await env.DB.prepare(
      "SELECT id FROM community_posts WHERE uid=? AND game_key=? AND kind='review'",
    )
      .bind(user.uid, gameKey)
      .first<any>();
    if (old) await deletePost(env, old.id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM ratings WHERE uid=? AND game_key=?").bind(
        user.uid,
        gameKey,
      ),
      env.DB.prepare(
        "DELETE FROM community_review_meta WHERE uid=? AND game_key=?",
      ).bind(user.uid, gameKey),
    ]);
    return jsonResponse({
      success: true,
    });
  });
  add("GET", "/rankings", async (request, env, ctx) => {
    const uid = await viewer(request, env),
      sort = ctx.url.searchParams.get("sort") || "players";
    const { limit, offset } = paging(ctx.url);
    const query = text(ctx.url.searchParams.get("q"), 80);
    const search = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    if (!["players", "hours", "completed", "score"].includes(sort))
      throw new CommunityError("Invalid ranking sort");
    const order =
      sort === "hours"
        ? "totalMinutes DESC,players DESC"
        : sort === "completed"
          ? "completedPlayers DESC,totalMinutes DESC"
        : sort === "score"
          ? "averageScore DESC,reviewCount DESC"
          : "players DESC,totalMinutes DESC";
    const rows =
      (
        await env.DB.prepare(
          `WITH catalog AS (
      SELECT CASE WHEN steam_id>0 THEN CAST(steam_id AS TEXT)
        WHEN game_key GLOB 's_[0-9]*' THEN SUBSTR(game_key,3) ELSE game_key END AS game_key,
        MAX(title) AS title,MAX(steam_id) AS steamId,MAX(cover_url) AS coverUrl
      FROM game_covers GROUP BY 1
    ), libraries AS (
      SELECT l.game_key,MAX(l.title) AS title,MAX(l.steam_id) AS steamId,MAX(l.cover_url) AS coverUrl,
      COUNT(DISTINCT CASE WHEN l.playtime_minutes>0 OR l.status IN ('completed','playing') THEN l.uid END) AS players,
      COUNT(DISTINCT CASE WHEN l.status='completed' THEN l.uid END) AS completedPlayers,SUM(l.playtime_minutes) AS totalMinutes
      FROM community_library l JOIN community_profiles cp ON cp.uid=l.uid WHERE cp.share_library=1 AND cp.suspended=0 AND ${visibleTo("l")} GROUP BY l.game_key
    ), reviews AS (
      SELECT r.game_key,MAX(r.game_title) AS title,MAX(r.cover_url) AS coverUrl,AVG(r.score) AS averageScore,COUNT(DISTINCT r.uid) AS reviewCount
      FROM ratings r LEFT JOIN community_profiles cp ON cp.uid=r.uid LEFT JOIN community_review_meta m ON m.uid=r.uid AND m.game_key=r.game_key
      WHERE COALESCE(cp.suspended,0)=0 AND COALESCE(m.hidden,0)=0 AND ${visibleTo("r")} GROUP BY r.game_key
    ), game_keys AS (SELECT game_key FROM catalog UNION SELECT game_key FROM libraries UNION SELECT game_key FROM reviews)
    SELECT k.game_key AS gameKey,COALESCE(c.title,l.title,r.title) AS title,COALESCE(c.steamId,l.steamId) AS steamId,COALESCE(c.coverUrl,l.coverUrl,r.coverUrl) AS coverUrl,
      COALESCE(l.players,0) AS players,COALESCE(l.completedPlayers,0) AS completedPlayers,COALESCE(l.totalMinutes,0) AS totalMinutes,r.averageScore,COALESCE(r.reviewCount,0) AS reviewCount
    FROM game_keys k LEFT JOIN catalog c ON c.game_key=k.game_key LEFT JOIN libraries l ON l.game_key=k.game_key LEFT JOIN reviews r ON r.game_key=k.game_key
    WHERE COALESCE(c.title,l.title,r.title) LIKE ? ESCAPE '\\'
      ${sort === "score" ? "AND COALESCE(r.reviewCount,0)>=1" : ""}
    ORDER BY ${order},title COLLATE NOCASE,gameKey LIMIT ? OFFSET ?`,
        )
          .bind(uid, uid, uid, uid, search, limit + 1, offset)
          .all<any>()
      ).results || [];
    return jsonResponse(
      page(
        rows.map((r) => ({
          ...r,
          coverUrl: publicUrl(r.coverUrl),
        })),
        limit,
        offset,
      ),
    );
  });
  add("PUT", "/blocks/:uid", async (request, env, ctx) => {
    const user = await requireUser(request, env);
    const id = text(ctx.params?.uid, 160, true);
    if (id === user.uid) throw new CommunityError("Cannot block yourself");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO community_blocks(uid,blocked_uid) VALUES (?,?)",
    )
      .bind(user.uid, id)
      .run();
    return jsonResponse({
      success: true,
    });
  });
  add("GET", "/blocks", async (request, env) => {
    const user = await requireUser(request, env, true);
    return jsonResponse({
      items:
        (
          await env.DB.prepare(
            "SELECT b.blocked_uid AS uid,p.nickname FROM community_blocks b LEFT JOIN community_profiles p ON p.uid=b.blocked_uid WHERE b.uid=? LIMIT 200",
          )
            .bind(user.uid)
            .all<any>()
        ).results || [],
    });
  });
  add("DELETE", "/blocks/:uid", async (request, env, ctx) => {
    const user = await requireUser(request, env, true);
    await env.DB.prepare(
      "DELETE FROM community_blocks WHERE uid=? AND blocked_uid=?",
    )
      .bind(user.uid, text(ctx.params?.uid, 160, true))
      .run();
    return jsonResponse({
      success: true,
    });
  });
  add("GET", "/notifications", async (request, env, ctx) => {
    const user = await requireUser(request, env, true);
    const { limit, offset } = paging(ctx.url);
    const rows =
      (
        await env.DB.prepare(
          `SELECT n.*,cp.nickname FROM community_notifications n JOIN community_posts p ON p.id=n.post_id
      LEFT JOIN community_profiles cp ON cp.uid=n.actor_uid WHERE n.uid=? AND p.hidden=0 AND COALESCE(cp.suspended,0)=0
      AND NOT EXISTS(SELECT 1 FROM community_blocks b WHERE (b.uid=? AND b.blocked_uid=n.actor_uid) OR (b.blocked_uid=? AND b.uid=n.actor_uid))
      ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`,
        )
          .bind(user.uid, user.uid, user.uid, limit + 1, offset)
          .all<any>()
      ).results || [];
    return jsonResponse(
      page(
        rows.map((n) => ({
          id: n.id,
          postId: n.post_id,
          kind: n.kind,
          nickname: safeName(n.nickname),
          read: !!n.is_read,
          createdAt: n.created_at,
        })),
        limit,
        offset,
      ),
    );
  });
  add("PUT", "/notifications/read", async (request, env) => {
    const user = await requireUser(request, env, true);
    await env.DB.prepare(
      "UPDATE community_notifications SET is_read=1 WHERE uid=?",
    )
      .bind(user.uid)
      .run();
    return jsonResponse({
      success: true,
    });
  });
  add("POST", "/reports", async (request, env) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "report", 10, 3600);
    const b = await jsonBody(request);
    const targetType = text(b.targetType, 20, true),
      targetId = text(b.targetId, 200, true);
    const tables: Record<string, string> = {
      post: "community_posts",
      comment: "community_comments",
      review: "ratings",
      performance: "community_performance",
    };
    if (!tables[targetType]) throw new CommunityError("Invalid report target");
    const target = await env.DB.prepare(
      `SELECT id FROM ${tables[targetType]} WHERE id=?`,
    )
      .bind(targetId)
      .first();
    if (!target) throw new CommunityError("Content not found", 404);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO community_reports(id,reporter_uid,target_type,target_id,reason) VALUES (?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        user.uid,
        targetType,
        targetId,
        text(b.reason, 500, true),
      )
      .run();
    return jsonResponse({
      success: true,
    });
  });
  add("GET", "/admin/reports", async (request, env, ctx) => {
    await requireAdmin(request, env);
    const { limit, offset } = paging(ctx.url);
    const rows =
      (
        await env.DB.prepare(
          `SELECT r.id,r.target_type AS targetType,r.target_id AS targetId,r.reason,r.status,r.created_at AS createdAt,
      COALESCE(p.body,c.body,v.review,f.game_title,'Content removed') AS targetBody
      FROM community_reports r LEFT JOIN community_posts p ON r.target_type='post' AND p.id=r.target_id
      LEFT JOIN community_comments c ON r.target_type='comment' AND c.id=r.target_id
      LEFT JOIN ratings v ON r.target_type='review' AND v.id=r.target_id
      LEFT JOIN community_performance f ON r.target_type='performance' AND f.id=r.target_id
      WHERE r.status='open' ORDER BY r.created_at LIMIT ? OFFSET ?`,
        )
          .bind(limit + 1, offset)
          .all<any>()
      ).results || [];
    return jsonResponse(page(rows, limit, offset));
  });
  add("PUT", "/admin/reports/:id", async (request, env, ctx) => {
    await requireAdmin(request, env);
    const b = await jsonBody(request),
      id = text(ctx.params?.id, 100, true);
    const report = await env.DB.prepare(
      "SELECT * FROM community_reports WHERE id=?",
    )
      .bind(id)
      .first<any>();
    if (!report) throw new CommunityError("Report not found", 404);
    if (!["dismiss", "hide", "suspend"].includes(b.action))
      throw new CommunityError("Invalid moderation action");
    const tables: Record<string, string> = {
      post: "community_posts",
      comment: "community_comments",
      review: "ratings",
      performance: "community_performance",
    };
    const target = await env.DB.prepare(
      `SELECT * FROM ${tables[report.target_type]} WHERE id=?`,
    )
      .bind(report.target_id)
      .first<any>();
    const stmts = [
      env.DB.prepare("UPDATE community_reports SET status=? WHERE id=?").bind(
        b.action,
        id,
      ),
    ];
    if (target && b.action !== "dismiss") {
      if (
        report.target_type === "review" ||
        (report.target_type === "post" && target.kind === "review")
      )
        stmts.push(
          env.DB.prepare(
            "INSERT INTO community_review_meta(uid,game_key,hidden) VALUES (?,?,1) ON CONFLICT(uid,game_key) DO UPDATE SET hidden=1",
          ).bind(target.uid, target.game_key),
          env.DB.prepare(
            "UPDATE community_posts SET hidden=1 WHERE uid=? AND game_key=? AND kind='review'",
          ).bind(target.uid, target.game_key),
        );
      else
        stmts.push(
          env.DB.prepare(
            `UPDATE ${tables[report.target_type]} SET hidden=1 WHERE id=?`,
          ).bind(target.id),
        );
      if (b.action === "suspend")
        stmts.push(
          env.DB.prepare(
            "INSERT INTO community_profiles(uid,nickname,suspended) VALUES (?,'Player',1) ON CONFLICT(uid) DO UPDATE SET suspended=1",
          ).bind(target.uid),
          env.DB.prepare("DELETE FROM community_library WHERE uid=?").bind(
            target.uid,
          ),
        );
    }
    await env.DB.batch(stmts);
    return jsonResponse({
      success: true,
    });
  });
}
