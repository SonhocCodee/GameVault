import type { RouteHandler, LeaderboardEntry, LeaderboardResponse } from '../types.ts';
import { authenticate } from '../auth.ts';
import { jsonResponse } from '../utils.ts';

export const handleLeaderboard: RouteHandler = async (request, env, ctx) => {
  const url = ctx.url;
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const offsetParam = parseInt(url.searchParams.get('offset') || '0', 10);

  const limit = isNaN(limitParam) || limitParam <= 0 ? 50 : Math.min(limitParam, 500);
  const offset = isNaN(offsetParam) || offsetParam < 0 ? 0 : offsetParam;

  // Optional authentication: if user is logged in, calculate myScore
  const authUser = await authenticate(request, env);
  const requestingUid = authUser?.uid || '';

  const totalStmt = await env.DB.prepare(
    `SELECT COUNT(DISTINCT game_key) AS total FROM ratings`
  ).first<{ total: number }>();
  const total = totalStmt?.total ? Number(totalStmt.total) : 0;

  const entriesResult = await env.DB.prepare(
    `SELECT
       game_key AS gameKey,
       MAX(game_title) AS gameTitle,
       MAX(cover_url) AS coverUrl,
       ROUND(AVG(score), 1) AS avgScore,
       COUNT(*) AS reviewCount,
       ROUND(SUM(CASE WHEN dropped = 1 THEN 1.0 ELSE 0.0 END) / COUNT(*), 2) AS dropRate,
       SUM(playtime_minutes) AS totalPlaytimeMinutes,
       MAX(CASE WHEN uid = ? THEN score ELSE NULL END) AS myScore
     FROM ratings
     GROUP BY game_key
     ORDER BY reviewCount DESC, avgScore DESC
     LIMIT ? OFFSET ?`
  )
    .bind(requestingUid, limit, offset)
    .all<any>();

  const rows = entriesResult.results || [];
  const entries: LeaderboardEntry[] = rows.map((r: any) => ({
    gameKey: String(r.gameKey),
    gameTitle: String(r.gameTitle),
    coverUrl: r.coverUrl || null,
    avgScore: r.avgScore != null ? Number(r.avgScore) : 0,
    reviewCount: r.reviewCount != null ? Number(r.reviewCount) : 0,
    dropRate: r.dropRate != null ? Number(r.dropRate) : 0,
    totalPlaytimeMinutes: r.totalPlaytimeMinutes != null ? Number(r.totalPlaytimeMinutes) : 0,
    myScore: r.myScore != null ? Number(r.myScore) : null,
    guMatchScore: null,
  }));

  const response: LeaderboardResponse = {
    entries,
    total,
    limit,
    offset,
  };

  return jsonResponse(response);
};
