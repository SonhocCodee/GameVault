import type { RouteHandler, CloudReview } from '../types.ts';
import { authenticate } from '../auth.ts';
import { jsonResponse, errorResponse } from '../utils.ts';
import { communityFailure, ensureProfile, jsonBody, rateLimit, requireUser, safeName, visibleTo } from '../community-common.ts';

export const handleGetReviews: RouteHandler = async (request, env, ctx) => {
  const viewerUid = (await authenticate(request, env))?.uid || '';
  const gameKey = ctx.params?.gameKey;
  if (!gameKey) {
    return errorResponse('Missing gameKey', 400);
  }

  const url = ctx.url;
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const offsetParam = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = isNaN(limitParam) || limitParam <= 0 ? 50 : Math.min(limitParam, 200);
  const offset = isNaN(offsetParam) || offsetParam < 0 ? 0 : offsetParam;

  const totalStmt = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM ratings r
     LEFT JOIN community_review_meta m ON m.uid=r.uid AND m.game_key=r.game_key
     LEFT JOIN community_profiles cp ON cp.uid=r.uid
     WHERE r.game_key = ? AND COALESCE(m.hidden,0)=0 AND COALESCE(cp.suspended,0)=0 AND ${visibleTo('r')}`
  )
    .bind(gameKey, viewerUid, viewerUid)
    .first<{ total: number }>();
  const total = totalStmt?.total ? Number(totalStmt.total) : 0;

  const queryResult = await env.DB.prepare(
    `SELECT
       r.id,
       r.uid,
       r.game_key AS gameKey,
       r.game_title AS gameTitle,
       r.cover_url AS coverUrl,
       r.score,
       r.review,
       r.dropped,
       r.drop_reason AS dropReason,
       r.playtime_minutes AS playtimeMinutes,
       r.fps,
       r.updated_at AS updatedAt,
       COALESCE(cp.nickname,u.display_name) AS authorName,
       u.photo_url AS authorPhoto,
       u.gpu AS authorGpu,
       u.cpu AS authorCpu,
       u.ram_gb AS authorRamGb
     FROM ratings r
     LEFT JOIN users u ON r.uid = u.uid
      LEFT JOIN community_profiles cp ON cp.uid=r.uid
      LEFT JOIN community_review_meta m ON m.uid=r.uid AND m.game_key=r.game_key
      WHERE r.game_key = ? AND COALESCE(m.hidden,0)=0 AND COALESCE(cp.suspended,0)=0 AND ${visibleTo('r')}
     ORDER BY r.score DESC, r.updated_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(gameKey, viewerUid, viewerUid, limit, offset)
    .all<any>();

  const rows = queryResult.results || [];
  const reviews: CloudReview[] = rows.map((r: any) => ({
    id: r.id,
    uid: r.uid,
    gameKey: r.gameKey,
    gameTitle: r.gameTitle,
    coverUrl: r.coverUrl || null,
    score: Number(r.score),
    review: r.review || '',
    dropped: r.dropped === 1,
    dropReason: r.dropReason || null,
    playtimeMinutes: Number(r.playtimeMinutes) || 0,
    fps: r.fps != null ? Number(r.fps) : null,
    updatedAt: r.updatedAt,
    authorName: safeName(r.authorName),
    authorPhoto: r.authorPhoto || undefined,
    authorHw:
      r.authorGpu || r.authorCpu || r.authorRamGb
        ? {
            gpu: r.authorGpu || '',
            cpu: r.authorCpu || '',
            ramGb: Number(r.authorRamGb) || 0,
          }
        : null,
  }));

  return jsonResponse({ reviews, total });
};

export const handleSubmitReview: RouteHandler = async (request, env, ctx) => {
  let user;
  try { user = await requireUser(request, env); await rateLimit(env, user.uid, 'legacy-review', 20, 300); }
  catch (error) { return communityFailure(error); }
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const gameKey = ctx.params?.gameKey;
  if (!gameKey) {
    return errorResponse('Missing gameKey in path', 400);
  }

  let body: any;
  try {
    body = await jsonBody(request);
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const {
    gameTitle,
    coverUrl,
    score,
    review = '',
    dropped = false,
    dropReason = null,
    playtimeMinutes = 0,
    fps = null,
  } = body || {};

  if (!gameTitle || typeof gameTitle !== 'string') {
    return errorResponse('Missing gameTitle in request body', 400);
  }

  const numericScore = Number(score);
  if (isNaN(numericScore) || numericScore < 1 || numericScore > 10) {
    return errorResponse('Score must be a number between 1 and 10', 400);
  }
  if (typeof review !== 'string' || review.length > 4000 || (dropReason != null && (typeof dropReason !== 'string' || dropReason.length > 300))) {
    return errorResponse('Invalid review text', 400);
  }
  if (!Number.isFinite(Number(playtimeMinutes)) || Number(playtimeMinutes) < 0 || Number(playtimeMinutes) > 10000000 || (fps != null && (!Number.isFinite(Number(fps)) || Number(fps) <= 0 || Number(fps) > 2000))) {
    return errorResponse('Invalid playtime or FPS value', 400);
  }

  const reviewId = `${user.uid}_${gameKey}`;
  const droppedInt = dropped ? 1 : 0;
  const safePlaytime = Math.max(0, parseInt(playtimeMinutes || 0, 10));
  const safeFps = fps != null && !isNaN(Number(fps)) ? Number(fps) : null;

  await env.DB.prepare(
    `INSERT INTO ratings (
       id, uid, game_key, game_title, cover_url, score, review,
       dropped, drop_reason, playtime_minutes, fps, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, datetime('now'), datetime('now')
     )
     ON CONFLICT(uid, game_key) DO UPDATE SET
       game_title = excluded.game_title,
       cover_url = COALESCE(excluded.cover_url, ratings.cover_url),
       score = excluded.score,
       review = excluded.review,
       dropped = excluded.dropped,
       drop_reason = excluded.drop_reason,
       playtime_minutes = excluded.playtime_minutes,
       fps = excluded.fps,
       updated_at = datetime('now')`
  )
    .bind(
      reviewId,
      user.uid,
      gameKey,
      gameTitle,
      coverUrl || null,
      numericScore,
      review,
      droppedInt,
      dropReason || null,
      safePlaytime,
      safeFps
    )
    .run();

  await ensureProfile(env, user);
  await env.DB.prepare(`INSERT INTO community_posts(id,uid,game_key,game_title,cover_url,kind,body)
    VALUES (?,?,?,?,?,'review',?)
    ON CONFLICT(uid,game_key) WHERE kind='review' DO UPDATE SET
      game_title=excluded.game_title,cover_url=COALESCE(excluded.cover_url,community_posts.cover_url),
      body=excluded.body,edited=1,updated_at=datetime('now')`)
    .bind(crypto.randomUUID(), user.uid, gameKey, gameTitle, coverUrl || null, review).run();
  const savedRow = await env.DB.prepare(
    `SELECT
       r.id,
       r.uid,
       r.game_key AS gameKey,
       r.game_title AS gameTitle,
       r.cover_url AS coverUrl,
       r.score,
       r.review,
       r.dropped,
       r.drop_reason AS dropReason,
       r.playtime_minutes AS playtimeMinutes,
       r.fps,
       r.updated_at AS updatedAt,
       u.display_name AS authorName,
       u.photo_url AS authorPhoto,
       u.gpu AS authorGpu,
       u.cpu AS authorCpu,
       u.ram_gb AS authorRamGb
     FROM ratings r
     LEFT JOIN users u ON r.uid = u.uid
     WHERE r.uid = ? AND r.game_key = ?`
  )
    .bind(user.uid, gameKey)
    .first<any>();

  const savedReview: CloudReview = {
    id: savedRow?.id || reviewId,
    uid: user.uid,
    gameKey,
    gameTitle: savedRow?.gameTitle || gameTitle,
    coverUrl: savedRow?.coverUrl || coverUrl || null,
    score: Number(savedRow?.score ?? numericScore),
    review: savedRow?.review ?? review,
    dropped: savedRow?.dropped === 1,
    dropReason: savedRow?.dropReason || null,
    playtimeMinutes: Number(savedRow?.playtimeMinutes ?? safePlaytime),
    fps: savedRow?.fps != null ? Number(savedRow.fps) : null,
    updatedAt: savedRow?.updatedAt || new Date().toISOString(),
    authorName: safeName(savedRow?.authorName || user.displayName),
    authorPhoto: savedRow?.authorPhoto || undefined,
    authorHw:
      savedRow?.authorGpu || savedRow?.authorCpu || savedRow?.authorRamGb
        ? {
            gpu: savedRow.authorGpu || '',
            cpu: savedRow.authorCpu || '',
            ramGb: Number(savedRow.authorRamGb) || 0,
          }
        : null,
  };

  return jsonResponse(savedReview, 200);
};

export const handleDeleteReview: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const gameKey = ctx.params?.gameKey;
  if (!gameKey) {
    return errorResponse('Missing gameKey in path', 400);
  }

  const result = await env.DB.prepare(
    `DELETE FROM ratings WHERE uid = ? AND game_key = ?`
  )
    .bind(user.uid, gameKey)
    .run();

  const reviewPostIds = "SELECT id FROM community_posts WHERE uid=? AND game_key=? AND kind='review'";
  await env.DB.batch(['community_likes','community_saved','community_comments','community_notifications','community_images']
    .map(table => env.DB.prepare(`DELETE FROM ${table} WHERE post_id IN (${reviewPostIds})`).bind(user.uid,gameKey))
    .concat([env.DB.prepare("DELETE FROM community_posts WHERE uid=? AND game_key=? AND kind='review'").bind(user.uid,gameKey),
      env.DB.prepare('DELETE FROM community_review_meta WHERE uid=? AND game_key=?').bind(user.uid,gameKey)]));

  return jsonResponse({ success: true, deleted: result.meta?.changes ?? 1 });
};
