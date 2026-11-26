import type {
  RouteHandler,
  Env,
  UserLibraryItem,
  CloudSessionItem,
  GameLibraryStatus,
  LibrarySyncStats,
  LibrarySyncResponse,
} from '../types.ts';
import { authenticate } from '../auth.ts';
import { jsonResponse, errorResponse } from '../utils.ts';
import { refreshSharedLibrary } from '../community-common.ts';

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
    completedAt: row.completed_at || null,
    userScore: row.user_score != null ? Number(row.user_score) : null,
    userNotes: row.user_notes || null,
    isDeleted: Boolean(row.is_deleted),
    clientUpdatedAt: row.client_updated_at,
    serverUpdatedAt: row.server_updated_at,
    masterCoverUpdatedAt: row.master_cover_updated_at || null,
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

function isValidStoredCoverUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/api/images/');
}

async function getUserSyncEpoch(env: Env, uid: string): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT sync_epoch FROM user_sync_state WHERE uid = ?').bind(uid).first<any>();
    return Number(row?.sync_epoch) || 0;
  } catch {
    return 0;
  }
}

async function bumpUserSyncEpoch(env: Env, uid: string): Promise<number> {
  try {
    await env.DB.prepare(`
      INSERT INTO user_sync_state (uid, sync_epoch, updated_at)
      VALUES (?, 1, datetime('now'))
      ON CONFLICT(uid) DO UPDATE SET
        sync_epoch = user_sync_state.sync_epoch + 1,
        updated_at = datetime('now')
    `).bind(uid).run();
    return await getUserSyncEpoch(env, uid);
  } catch {
    return 0;
  }
}

async function fetchUserLibraryResponse(
  env: Env,
  uid: string,
  extra?: { authoritativePull?: boolean }
): Promise<LibrarySyncResponse> {
  const query = `
    SELECT ul.game_key, ul.title, ul.steam_id,
           COALESCE(gc.cover_url, ul.cover_url) AS cover_url,
           COALESCE(gc.banner_url, ul.banner_url) AS banner_url,
           gc.updated_at AS master_cover_updated_at,
           ul.status, ul.playtime_minutes, ul.last_played, ul.completed_at, ul.user_score, ul.user_notes,
           ul.is_deleted, ul.client_updated_at, ul.server_updated_at
    FROM user_library ul
    LEFT JOIN game_covers gc ON gc.game_key = LOWER(ul.game_key)
    WHERE ul.uid = ? AND ul.is_deleted = 0
    ORDER BY ul.server_updated_at DESC
  `;

  const { results } = await env.DB.prepare(query).bind(uid).all<any>();
  const games = (results || []).map(mapRowToItem);
  const stats = computeStats(games);

  let sessions: CloudSessionItem[] = [];
  try {
    const sRes = await env.DB.prepare(`
      SELECT game_key, source, start_time, end_time, duration_minutes
      FROM user_sessions
      WHERE uid = ?
      ORDER BY start_time DESC
      LIMIT 5000
    `).bind(uid).all<any>();
    sessions = (sRes.results || []).map((r: any) => ({
      gameKey: r.game_key,
      source: r.source,
      startTime: r.start_time,
      endTime: r.end_time || null,
      durationMinutes: Number(r.duration_minutes) || 0,
    }));
  } catch {
    // Graceful fallback if user_sessions table is not yet migrated in an isolated test DB
  }

  const syncEpoch = await getUserSyncEpoch(env, uid);

  return {
    games,
    sessions,
    syncedAt: new Date().toISOString(),
    stats,
    syncEpoch,
    ...(extra?.authoritativePull ? { authoritativePull: true } : {}),
  };
}

export const handleGetLibrary: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  return jsonResponse(await fetchUserLibraryResponse(env, user.uid));
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

  const syncMode = body?.mode === 'overwrite' ? 'overwrite' : 'merge';
  const clientSyncEpoch = Number.isFinite(Number(body?.clientSyncEpoch))
    ? Math.max(0, Math.floor(Number(body.clientSyncEpoch)))
    : 0;
  const serverSyncEpoch = await getUserSyncEpoch(env, user.uid);

  // If Cloud has a newer authoritative snapshot than this client, do NOT merge stale/corrupted
  // local data into Cloud. Return the authoritative Cloud snapshot so the client mirrors it.
  if (syncMode !== 'overwrite' && serverSyncEpoch > 0 && clientSyncEpoch < serverSyncEpoch) {
    return jsonResponse(await fetchUserLibraryResponse(env, user.uid, { authoritativePull: true }));
  }

  if (syncMode === 'overwrite') {
    await env.DB.prepare('DELETE FROM user_library WHERE uid = ?').bind(user.uid).run();
    try {
      await env.DB.prepare('DELETE FROM user_sessions WHERE uid = ?').bind(user.uid).run();
    } catch {
      // Ignore if user_sessions is not migrated in older test fixtures
    }
  }

  const upsertStmt = env.DB.prepare(`
    INSERT INTO user_library (
      uid, game_key, title, steam_id, cover_url, banner_url, status,
      playtime_minutes, last_played, completed_at, user_score, user_notes, is_deleted,
      client_updated_at, server_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(uid, game_key) DO UPDATE SET
      title = excluded.title,
      steam_id = COALESCE(excluded.steam_id, user_library.steam_id),
      cover_url = CASE
        WHEN user_library.cover_url LIKE '/api/images/%' THEN user_library.cover_url
        WHEN excluded.cover_url IS NOT NULL AND (excluded.cover_url LIKE 'http://%' OR excluded.cover_url LIKE 'https://%' OR excluded.cover_url LIKE '/api/images/%') THEN excluded.cover_url
        WHEN user_library.cover_url LIKE 'http://%' OR user_library.cover_url LIKE 'https://%' THEN user_library.cover_url
        ELSE NULL
      END,
      banner_url = CASE
        WHEN user_library.banner_url LIKE '/api/images/%' THEN user_library.banner_url
        WHEN excluded.banner_url IS NOT NULL AND (excluded.banner_url LIKE 'http://%' OR excluded.banner_url LIKE 'https://%' OR excluded.banner_url LIKE '/api/images/%') THEN excluded.banner_url
        WHEN user_library.banner_url LIKE 'http://%' OR user_library.banner_url LIKE 'https://%' THEN user_library.banner_url
        ELSE NULL
      END,
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
      completed_at = CASE
        WHEN excluded.completed_at IS NOT NULL AND (
          user_library.completed_at IS NULL OR excluded.client_updated_at >= user_library.client_updated_at
        ) THEN excluded.completed_at
        ELSE user_library.completed_at
      END,
      user_score = CASE
        WHEN excluded.client_updated_at >= user_library.client_updated_at
        THEN excluded.user_score ELSE COALESCE(user_library.user_score, excluded.user_score)
      END,
      user_notes = CASE
        WHEN excluded.client_updated_at >= user_library.client_updated_at
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
    const coverUrl = isValidStoredCoverUrl(item.coverUrl) ? item.coverUrl.trim() : null;
    const bannerUrl = isValidStoredCoverUrl(item.bannerUrl) ? item.bannerUrl.trim() : null;
    const status: GameLibraryStatus = VALID_STATUSES.has(item.status) ? item.status : 'backlog';
    const playtimeMinutes = Math.max(0, Math.floor(Number(item.playtimeMinutes) || 0));
    const lastPlayed = typeof item.lastPlayed === 'string' && item.lastPlayed.trim() ? item.lastPlayed.trim() : null;
    const completedAt = typeof item.completedAt === 'string' && item.completedAt.trim() ? item.completedAt.trim() : null;
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
        completedAt,
        userScore,
        userNotes,
        isDeleted,
        clientUpdatedAt
      )
      .run();
  }

  await refreshSharedLibrary(env, user.uid);

  const rawSessions = Array.isArray(body?.sessions) ? body.sessions : [];
  if (rawSessions.length > 0) {
    try {
      const sessionUpsert = env.DB.prepare(`
        INSERT INTO user_sessions (uid, game_key, source, start_time, end_time, duration_minutes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(uid, game_key, source, start_time) DO UPDATE SET
          end_time = CASE
            WHEN excluded.end_time IS NOT NULL AND (user_sessions.end_time IS NULL OR excluded.end_time > user_sessions.end_time)
            THEN excluded.end_time ELSE user_sessions.end_time
          END,
          duration_minutes = MAX(user_sessions.duration_minutes, excluded.duration_minutes)
      `);
      const stmts: any[] = [];
      for (const s of rawSessions.slice(0, 5000)) {
        if (!s || typeof s.gameKey !== 'string' || !s.gameKey.trim()) continue;
        const source = typeof s.source === 'string' && s.source.trim() ? s.source.trim().slice(0, 32) : 'tracker';
        if (source === 'manual') continue;
        const startTime = typeof s.startTime === 'string' && s.startTime.trim() ? s.startTime.trim().slice(0, 48) : '';
        if (!startTime) continue;
        const endTime = typeof s.endTime === 'string' && s.endTime.trim() ? s.endTime.trim().slice(0, 48) : null;
        const durationMinutes = Math.max(0, Math.floor(Number(s.durationMinutes) || 0));
        if (durationMinutes <= 0) continue;
        stmts.push(sessionUpsert.bind(user.uid, s.gameKey.trim(), source, startTime, endTime, durationMinutes));
      }
      for (let i = 0; i < stmts.length; i += 80) {
        await env.DB.batch(stmts.slice(i, i + 80));
      }
    } catch {
      // Ignore if user_sessions is not migrated in older test fixtures
    }
  }

  if (syncMode === 'overwrite') {
    await bumpUserSyncEpoch(env, user.uid);
  }

  return jsonResponse(await fetchUserLibraryResponse(env, user.uid));
};
