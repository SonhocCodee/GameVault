import type { Env, RouteHandler } from "../types.ts";
import { authenticate } from "../auth.ts";
import { jsonResponse } from "../utils.ts";
import { communityAvatar, CommunityError, ensureProfile, page, paging, rateLimit, requireUser, safeName, text, visibleTo } from "../community-common.ts";

export async function followStats(env: Env, uid: string, viewer: string) {
  const stats = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM community_follows f JOIN community_profiles p ON p.uid=f.uid WHERE f.followed_uid=? AND p.suspended=0) AS followersCount,
    (SELECT COUNT(*) FROM community_follows f JOIN community_profiles p ON p.uid=f.followed_uid WHERE f.uid=? AND p.suspended=0) AS followingCount,
    EXISTS(SELECT 1 FROM community_follows WHERE uid=? AND followed_uid=?) AS isFollowing`)
    .bind(uid, uid, viewer, uid).first<any>();
  return { followersCount: Number(stats?.followersCount || 0), followingCount: Number(stats?.followingCount || 0), isFollowing: !!stats?.isFollowing };
}

export function registerFollowRoutes(add: (method: string, path: string, handler: RouteHandler) => void) {
  add("GET", "/profiles", async (request, env, ctx) => {
    const who = (await authenticate(request, env))?.uid || "";
    const { limit, offset } = paging(ctx.url);
    const following = ctx.url.searchParams.get("following") === "true";
    if (following && !who) throw new CommunityError("Sign in to view following", 401);
    const query = text(ctx.url.searchParams.get("q"), 100);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = (await env.DB.prepare(`SELECT p.uid,p.nickname,p.bio,p.share_library,
      COALESCE('/community/profile-presets/avatars/'||p.avatar_preset||'.svg',u.photo_url) AS avatar_url,
      EXISTS(SELECT 1 FROM community_follows f WHERE f.uid=? AND f.followed_uid=p.uid) AS following
      FROM community_profiles p LEFT JOIN users u ON u.uid=p.uid
      WHERE p.suspended=0 AND p.nickname LIKE ? ESCAPE '\\' AND ${visibleTo("p")}
      ${following ? "AND EXISTS(SELECT 1 FROM community_follows f WHERE f.uid=? AND f.followed_uid=p.uid)" : ""}
      ORDER BY p.nickname COLLATE NOCASE,p.uid LIMIT ? OFFSET ?`)
      .bind(who, pattern, who, who, ...(following ? [who] : []), limit + 1, offset).all<any>()).results || [];
    return jsonResponse(page(rows.map((p) => ({ uid: p.uid, nickname: safeName(p.nickname), bio: p.bio,
      avatarUrl: communityAvatar(request, p.avatar_url), shareLibrary: !!p.share_library, isFollowing: !!p.following })), limit, offset));
  });
  add("PUT", "/follows/:uid", async (request, env, ctx) => {
    const user = await requireUser(request, env);
    const target = text(ctx.params?.uid, 160, true);
    if (target === user.uid) throw new CommunityError("Cannot follow yourself");
    await rateLimit(env, user.uid, "follow", 60);
    const p = await env.DB.prepare(`SELECT p.uid FROM community_profiles p WHERE p.uid=? AND p.suspended=0 AND ${visibleTo("p")}`)
      .bind(target, user.uid, user.uid).first();
    if (!p) throw new CommunityError("Profile not found", 404);
    await ensureProfile(env, user);
    // Recheck visibility in the write so an intervening block cannot restore a follow.
    await env.DB.prepare(`INSERT OR IGNORE INTO community_follows(uid,followed_uid)
      SELECT ?,p.uid FROM community_profiles p WHERE p.uid=? AND p.suspended=0 AND ${visibleTo("p")}`)
      .bind(user.uid, target, user.uid, user.uid).run();
    return jsonResponse(await followStats(env, target, user.uid));
  });
  add("DELETE", "/follows/:uid", async (request, env, ctx) => {
    const user = await requireUser(request, env, true);
    const target = text(ctx.params?.uid, 160, true);
    await env.DB.prepare("DELETE FROM community_follows WHERE uid=? AND followed_uid=?").bind(user.uid, target).run();
    return jsonResponse(await followStats(env, target, user.uid));
  });
}
