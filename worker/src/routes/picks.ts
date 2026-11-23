import type { RouteHandler, CommunityPick } from '../types.ts';
import { authenticate } from '../auth.ts';
import { jsonResponse, errorResponse } from '../utils.ts';

function getCurrentMonthString(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

async function getCommunityPickForMonth(env: Env, month: string): Promise<CommunityPick> {
  const pickRow = await env.DB.prepare(
    `SELECT month, state, game_key AS gameKey, game_title AS gameTitle, cover_url AS coverUrl
     FROM community_picks
     WHERE month = ?`
  )
    .bind(month)
    .first<any>();

  const votesRows = await env.DB.prepare(
    `SELECT uid, game_key AS gameKey
     FROM community_votes
     WHERE month = ?`
  )
    .bind(month)
    .all<any>();

  const votes: Record<string, string> = {};
  for (const r of votesRows.results || []) {
    if (r.uid && r.gameKey) {
      votes[r.uid] = r.gameKey;
    }
  }

  let state: 'voting' | 'playing' | 'done' = pickRow?.state || 'voting';
  let gameKey = pickRow?.gameKey || '';
  let gameTitle = pickRow?.gameTitle || '';
  let coverUrl = pickRow?.coverUrl || null;

  // If pick record doesn't exist or gameKey is empty, find the current leader from votes
  if (!gameKey) {
    const leaderRow = await env.DB.prepare(
      `SELECT game_key AS gameKey, MAX(game_title) AS gameTitle, MAX(cover_url) AS coverUrl, COUNT(*) AS voteCount
       FROM community_votes
       WHERE month = ?
       GROUP BY game_key
       ORDER BY voteCount DESC, MIN(created_at) ASC
       LIMIT 1`
    )
      .bind(month)
      .first<any>();

    if (leaderRow?.gameKey) {
      gameKey = leaderRow.gameKey;
      gameTitle = leaderRow.gameTitle || '';
      coverUrl = leaderRow.coverUrl || null;
    }
  }

  return {
    month,
    state,
    gameKey,
    gameTitle,
    coverUrl,
    votes,
  };
}

export const handleGetCurrentPick: RouteHandler = async (_request, env, ctx) => {
  const month = ctx.url.searchParams.get('month') || getCurrentMonthString();
  const pick = await getCommunityPickForMonth(env, month);
  return jsonResponse(pick);
};

export const handleVotePick: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { gameKey, gameTitle = '', coverUrl = null } = body || {};
  if (!gameKey || typeof gameKey !== 'string') {
    return errorResponse('Missing or invalid gameKey in request body', 400);
  }

  const month = body.month || ctx.url.searchParams.get('month') || getCurrentMonthString();

  // Check state: if already 'playing' or 'done', reject
  const pickRow = await env.DB.prepare(
    `SELECT state FROM community_picks WHERE month = ?`
  )
    .bind(month)
    .first<any>();

  if (pickRow && pickRow.state !== 'voting') {
    return errorResponse('Voting is closed for this month', 403);
  }

  const voteId = `${month}_${user.uid}`;

  await env.DB.prepare(
    `INSERT INTO community_votes (
       id, month, uid, game_key, game_title, cover_url, created_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, datetime('now')
     )
     ON CONFLICT(month, uid) DO UPDATE SET
       game_key = excluded.game_key,
       game_title = CASE WHEN excluded.game_title != '' THEN excluded.game_title ELSE community_votes.game_title END,
       cover_url = COALESCE(excluded.cover_url, community_votes.cover_url),
       created_at = datetime('now')`
  )
    .bind(voteId, month, user.uid, gameKey, gameTitle, coverUrl)
    .run();

  const updatedPick = await getCommunityPickForMonth(env, month);
  return jsonResponse(updatedPick);
};

export const handleUnvotePick: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const month = ctx.url.searchParams.get('month') || getCurrentMonthString();

  const pickRow = await env.DB.prepare(
    `SELECT state FROM community_picks WHERE month = ?`
  )
    .bind(month)
    .first<any>();

  if (pickRow && pickRow.state !== 'voting') {
    return errorResponse('Voting is closed for this month', 403);
  }

  await env.DB.prepare(
    `DELETE FROM community_votes WHERE month = ? AND uid = ?`
  )
    .bind(month, user.uid)
    .run();

  const updatedPick = await getCommunityPickForMonth(env, month);
  return jsonResponse(updatedPick);
};
