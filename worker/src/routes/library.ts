import type {
  RouteHandler,
  UserLibraryItem,
  GameLibraryStatus,
  LibrarySyncStats,
  LibrarySyncResponse,
} from '../types.ts';
import { authenticate } from '../auth.ts';
import { jsonResponse, errorResponse } from '../utils.ts';

const VALID_STATUSES = new Set<GameLibraryStatus>([
  'playing',
  'completed',
  'paused',
  'dropped',
  'backlog',
]);

function mapRowToItem(row: any): UserLibraryItem {
  return {
    gameKey: row.game_key,
    title: row.title,
    steamId: row.steam_id != null ? Number(row.steam_id) : null,
    coverUrl: row.cover_url || null,
    bannerUrl: row.banner_url || null,
    status: VALID_STATUSES.has(row.status) ? row.status : 'backlog',
    playtimeMinutes: Number(row.playtime_minutes) || 0,
    lastPlayed: row.last_played || null,
    userScore: row.user_score != null ? Number(row.user_score) : null,
    userNotes: row.user_notes || null,
    isDeleted: Boolean(row.is_deleted),
    clientUpdatedAt: row.client_updated_at,
    serverUpdatedAt: row.server_updated_at,
  };
}

function computeStats(items: UserLibraryItem[]): LibrarySyncStats {
  let completed = 0;
  let playing = 0;
  let backlog = 0;
  let paused = 0;
  let dropped = 0;
  let totalPlaytimeMinutes = 0;

  for (const item of items) {
    totalPlaytimeMinutes += item.playtimeMinutes;
    switch (item.status) {
      case 'completed':
        completed++;
        break;
      case 'playing':
        playing++;
        break;
      case 'paused':
        paused++;
        break;
      case 'dropped':
        dropped++;
        break;
      case 'backlog':
      default:
        backlog++;
        break;
    }
  }

  return {
    total: items.length,
    completed,
    playing,
    backlog,
    paused,
    dropped,
    totalPlaytimeMinutes,
  };
}

export const handleGetLibrary: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const query = `
    SELECT game_key, title, steam_id, cover_url, banner_url, status,
           playtime_minutes, last_played, user_score, user_notes,
           is_deleted, client_updated_at, server_updated_at
    FROM user_library
    WHERE uid = ? AND is_deleted = 0
    ORDER BY server_updated_at DESC
  `;

  const { results } = await env.DB.prepare(query).bind(user.uid).all<any>();
  const games = (results || []).map(mapRowToItem);
  const stats = computeStats(games);

  const response: LibrarySyncResponse = {
    games,
    syncedAt: new Date().toISOString(),
    stats,
  };

  return jsonResponse(response);
};

export const handleSyncLibrary: RouteHandler = async (request, env) => {
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

  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items) {
    return errorResponse('Payload must include an "items" array', 400);
  }

  const upsertStmt = env.DB.prepare(`
    INSERT INTO user_library (
      uid, game_key, title, steam_id, cover_url, banner_url, status,
      playtime_minutes, last_played, user_score, user_notes, is_deleted,
      client_updated_at, server_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(uid, game_key) DO UPDATE SET
      title = excluded.title,
      steam_id = COALESCE(excluded.steam_id, user_library.steam_id),
      cover_url = COALESCE(excluded.cover_url, user_library.cover_url),
      banner_url = COALESCE(excluded.banner_url, user_library.banner_url),
      status = CASE
        WHEN excluded.is_deleted = 1 THEN user_library.status
        WHEN excluded.status = 'completed' OR user_library.status = 'completed' THEN 'completed'
        WHEN excluded.client_updated_at >= user_library.client_updated_at THEN excluded.status
        ELSE user_library.status
      END,
      playtime_minutes = MAX(user_library.playtime_minutes, excluded.playtime_minutes),
      last_played = CASE
        WHEN excluded.last_played IS NOT NULL AND (user_library.last_played IS NULL OR excluded.last_played > user_library.last_played)
        THEN excluded.last_played ELSE user_library.last_played
      END,
      user_score = CASE
        WHEN excluded.user_score IS NOT NULL AND excluded.client_updated_at >= user_library.client_updated_at
        THEN excluded.user_score ELSE COALESCE(user_library.user_score, excluded.user_score)
      END,
      user_notes = CASE
        WHEN excluded.user_notes IS NOT NULL AND excluded.client_updated_at >= user_library.client_updated_at
        THEN excluded.user_notes ELSE COALESCE(user_library.user_notes, excluded.user_notes)
      END,
      is_deleted = excluded.is_deleted,
      client_updated_at = MAX(user_library.client_updated_at, excluded.client_updated_at),
      server_updated_at = datetime('now')
  `);

  for (const item of items) {
    if (!item || typeof item.gameKey !== 'string' || !item.gameKey.trim()) {
      continue;
    }

    const gameKey = item.gameKey.trim();
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Unknown Game';
    const steamId = item.steamId != null && !isNaN(Number(item.steamId)) ? Number(item.steamId) : null;
    const coverUrl = typeof item.coverUrl === 'string' && item.coverUrl.trim() ? item.coverUrl.trim() : null;
    const bannerUrl = typeof item.bannerUrl === 'string' && item.bannerUrl.trim() ? item.bannerUrl.trim() : null;
    const status: GameLibraryStatus = VALID_STATUSES.has(item.status) ? item.status : 'backlog';
    const playtimeMinutes = Math.max(0, Math.floor(Number(item.playtimeMinutes) || 0));
    const lastPlayed = typeof item.lastPlayed === 'string' && item.lastPlayed.trim() ? item.lastPlayed.trim() : null;
    const userScore = item.userScore != null && !isNaN(Number(item.userScore)) ? Number(item.userScore) : null;
    const userNotes = typeof item.userNotes === 'string' ? item.userNotes : null;
    const isDeleted = item.isDeleted ? 1 : 0;
    const clientUpdatedAt = typeof item.clientUpdatedAt === 'string' && item.clientUpdatedAt.trim()
      ? item.clientUpdatedAt.trim()
      : new Date().toISOString();

    await upsertStmt
      .bind(
        user.uid,
        gameKey,
        title,
        steamId,
        coverUrl,
        bannerUrl,
        status,
        playtimeMinutes,
        lastPlayed,
        userScore,
        userNotes,
        isDeleted,
        clientUpdatedAt
      )
      .run();
  }

  // Retrieve active library for response
  const query = `
    SELECT game_key, title, steam_id, cover_url, banner_url, status,
           playtime_minutes, last_played, user_score, user_notes,
           is_deleted, client_updated_at, server_updated_at
    FROM user_library
    WHERE uid = ? AND is_deleted = 0
    ORDER BY server_updated_at DESC
  `;

  const { results } = await env.DB.prepare(query).bind(user.uid).all<any>();
  const games = (results || []).map(mapRowToItem);
  const stats = computeStats(games);

  const response: LibrarySyncResponse = {
    games,
    syncedAt: new Date().toISOString(),
    stats,
  };

  return jsonResponse(response);
};
