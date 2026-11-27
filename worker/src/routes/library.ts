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
import { ensureProfile, refreshSharedLibrary } from '../community-common.ts';

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
    recordedPlaytimeMinutes: Number(row.recorded_playtime_minutes) || 0,
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
  let recordedMinutes = 0;

  for (const item of items) {
    totalPlaytimeMinutes += item.playtimeMinutes;
    recordedMinutes += item.recordedPlaytimeMinutes;
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
    recordedMinutes,
  };
}

function isValidStoredCoverUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/api/images/');
}

function normalizeSinceTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace('T', ' ').slice(0, 19);
}

async function getUserSyncState(
  env: Env,
  uid: string
): Promise<{ syncEpoch: number; updatedAt: string | null }> {
  try {
    const row = await env.DB.prepare('SELECT sync_epoch, updated_at FROM user_sync_state WHERE uid = ?')
      .bind(uid)
      .first<any>();
    return {
      syncEpoch: Number(row?.sync_epoch) || 0,
      updatedAt: typeof row?.updated_at === 'string' && row.updated_at.trim() ? row.updated_at.trim() : null,
    };
  } catch {
    return { syncEpoch: 0, updatedAt: null };
  }
}

async function getUserSyncEpoch(env: Env, uid: string): Promise<number> {
  const state = await getUserSyncState(env, uid);
  return state.syncEpoch;
}

async function touchUserSyncState(env: Env, uid: string): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO user_sync_state (uid, sync_epoch, updated_at)
      VALUES (?, 0, datetime('now'))
      ON CONFLICT(uid) DO UPDATE SET
        updated_at = datetime('now')
    `).bind(uid).run();
  } catch {
    // Graceful fallback if user_sync_state is not yet migrated in an isolated test DB
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
  extra?: { authoritativePull?: boolean; since?: string | null }
): Promise<LibrarySyncResponse> {
  const since = !extra?.authoritativePull ? normalizeSinceTimestamp(extra?.since) : null;
  const isDelta = Boolean(since);

  const query = isDelta
    ? `
      SELECT ul.game_key, ul.title, ul.steam_id,
             COALESCE(gc.cover_url, ul.cover_url) AS cover_url,
             COALESCE(gc.banner_url, ul.banner_url) AS banner_url,
             gc.updated_at AS master_cover_updated_at,
             ul.status, ul.playtime_minutes, ul.recorded_playtime_minutes, ul.last_played, ul.completed_at, ul.user_score, ul.user_notes,
             ul.is_deleted, ul.client_updated_at, ul.server_updated_at
      FROM user_library ul
      LEFT JOIN game_covers gc ON gc.game_key = LOWER(ul.game_key)
      WHERE ul.uid = ? AND ul.server_updated_at >= ?
      ORDER BY ul.server_updated_at DESC
    `
    : `
      SELECT ul.game_key, ul.title, ul.steam_id,
             COALESCE(gc.cover_url, ul.cover_url) AS cover_url,
             COALESCE(gc.banner_url, ul.banner_url) AS banner_url,
             gc.updated_at AS master_cover_updated_at,
             ul.status, ul.playtime_minutes, ul.recorded_playtime_minutes, ul.last_played, ul.completed_at, ul.user_score, ul.user_notes,
             ul.is_deleted, ul.client_updated_at, ul.server_updated_at
      FROM user_library ul
      LEFT JOIN game_covers gc ON gc.game_key = LOWER(ul.game_key)
      WHERE ul.uid = ? AND ul.is_deleted = 0
      ORDER BY ul.server_updated_at DESC
    `;

  const stmt = isDelta ? env.DB.prepare(query).bind(uid, since) : env.DB.prepare(query).bind(uid);
  const { results } = await stmt.all<any>();
  const games = (results || []).map(mapRowToItem);
  const stats = computeStats(games.filter((g) => !g.isDeleted));

  let sessions: CloudSessionItem[] = [];
  if (!isDelta || games.length > 0) {
    try {
      let sRes: { results?: any[] };
      if (isDelta && games.length <= 50) {
        const changedKeys = Array.from(new Set(games.map((g) => g.gameKey)));
        const placeholders = changedKeys.map(() => '?').join(', ');
        sRes = await env.DB.prepare(`
          SELECT game_key, source, start_time, end_time, duration_minutes
          FROM user_sessions
          WHERE uid = ? AND game_key IN (${placeholders})
          ORDER BY start_time DESC
          LIMIT 500
        `).bind(uid, ...changedKeys).all<any>();
      } else {
        sRes = await env.DB.prepare(`
          SELECT game_key, source, start_time, end_time, duration_minutes
          FROM user_sessions
          WHERE uid = ?
          ORDER BY start_time DESC
          LIMIT 5000
        `).bind(uid).all<any>();
      }
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
  }

  const syncEpoch = await getUserSyncEpoch(env, uid);

  return {
    games,
    sessions,
    syncedAt: new Date().toISOString(),
    stats,
    syncEpoch,
    ...(extra?.authoritativePull ? { authoritativePull: true } : {}),
    ...(isDelta ? { delta: true } : {}),
  };
}

export const handleGetLibrary: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const since = normalizeSinceTimestamp(url.searchParams.get('since'));
  const rawEpoch = url.searchParams.get('clientSyncEpoch');
  const clientSyncEpoch = rawEpoch != null && Number.isFinite(Number(rawEpoch))
    ? Math.max(0, Math.floor(Number(rawEpoch)))
    : null;

  if (since) {
    const syncState = await getUserSyncState(env, user.uid);
    if (clientSyncEpoch !== null && syncState.syncEpoch > 0 && clientSyncEpoch < syncState.syncEpoch) {
      return jsonResponse(await fetchUserLibraryResponse(env, user.uid, { authoritativePull: true }));
    }
    if (syncState.updatedAt && syncState.updatedAt < since) {
      return jsonResponse({
        games: [],
        sessions: [],
        syncedAt: new Date().toISOString(),
        stats: computeStats([]),
        syncEpoch: syncState.syncEpoch,
        delta: true,
      });
    }
  }

  return jsonResponse(await fetchUserLibraryResponse(env, user.uid, { since }));
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
  const isDelta = body?.delta === true && syncMode !== 'overwrite';
  const since = isDelta ? normalizeSinceTimestamp(body?.since) : null;
  const clientSyncEpoch = Number.isFinite(Number(body?.clientSyncEpoch))
    ? Math.max(0, Math.floor(Number(body.clientSyncEpoch)))
    : 0;
  const serverSyncEpoch = await getUserSyncEpoch(env, user.uid);

  // If Cloud has a newer authoritative snapshot than this client, do NOT merge stale/corrupted
  // local data into Cloud. Return the authoritative Cloud snapshot so the client mirrors it.
  if (syncMode !== 'overwrite' && serverSyncEpoch > 0 && clientSyncEpoch < serverSyncEpoch) {
    return jsonResponse(await fetchUserLibraryResponse(env, user.uid, { authoritativePull: true }));
  }

  const overwrittenRecordedByKey = new Map<string, number>();
  if (syncMode === 'overwrite') {
    const previous = await env.DB.prepare(
      'SELECT game_key, recorded_playtime_minutes FROM user_library WHERE uid = ?'
    ).bind(user.uid).all<any>();
    for (const row of previous.results || []) {
      overwrittenRecordedByKey.set(row.game_key, Number(row.recorded_playtime_minutes) || 0);
    }
    await env.DB.prepare('DELETE FROM user_library WHERE uid = ?').bind(user.uid).run();
    try {
      await env.DB.prepare('DELETE FROM user_sessions WHERE uid = ?').bind(user.uid).run();
    } catch {
      // Ignore if user_sessions is not migrated in older test fixtures
    }
  }

  const existingByKey = new Map<string, any>();
  if (syncMode !== 'overwrite') {
    const targetKeys = isDelta
      ? Array.from(
          new Set(
            items
              .map((it: any) => (typeof it?.gameKey === 'string' ? it.gameKey.trim() : ''))
              .filter(Boolean)
          )
        )
      : [];

    if (isDelta && targetKeys.length === 0) {
      // Nothing to look up in user_library
    } else if (isDelta && targetKeys.length <= 50) {
      const placeholders = targetKeys.map(() => '?').join(', ');
      const existingRes = await env.DB.prepare(`
        SELECT game_key, title, steam_id, cover_url, banner_url, status,
               playtime_minutes, recorded_playtime_minutes, last_played, completed_at, user_score, user_notes,
               is_deleted, client_updated_at
        FROM user_library
        WHERE uid = ? AND game_key IN (${placeholders})
      `).bind(user.uid, ...targetKeys).all<any>();
      for (const row of existingRes.results || []) {
        existingByKey.set(row.game_key, row);
      }
    } else {
      const existingRes = await env.DB.prepare(`
        SELECT game_key, title, steam_id, cover_url, banner_url, status,
               playtime_minutes, recorded_playtime_minutes, last_played, completed_at, user_score, user_notes,
               is_deleted, client_updated_at
        FROM user_library
        WHERE uid = ?
      `).bind(user.uid).all<any>();
      for (const row of existingRes.results || []) {
        existingByKey.set(row.game_key, row);
      }
    }
  }

  const upsertStmt = env.DB.prepare(`
    INSERT INTO user_library (
      uid, game_key, title, steam_id, cover_url, banner_url, status,
      playtime_minutes, recorded_playtime_minutes, last_played, completed_at, user_score, user_notes, is_deleted,
      client_updated_at, server_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
      playtime_minutes = CASE WHEN ? = 1 THEN
        MAX(user_library.recorded_playtime_minutes, excluded.recorded_playtime_minutes) +
        CASE WHEN excluded.client_updated_at >= user_library.client_updated_at
          THEN MAX(0, excluded.playtime_minutes - excluded.recorded_playtime_minutes)
          ELSE MAX(0, user_library.playtime_minutes - user_library.recorded_playtime_minutes)
        END
        ELSE MAX(user_library.playtime_minutes, excluded.playtime_minutes)
      END,
      recorded_playtime_minutes = MAX(user_library.recorded_playtime_minutes, excluded.recorded_playtime_minutes),
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

  const libStmts: any[] = [];
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
    const rawPlaytime = Number(item.playtimeMinutes);
    const playtimeMinutes = Number.isFinite(rawPlaytime) ? Math.max(0, Math.floor(rawPlaytime)) : 0;
    // Legacy clients may increase the display total, but cannot turn that
    // increase into recorded time by omitting its provenance.
    const hasRecordedPlaytime = typeof item.recordedPlaytimeMinutes === 'number' && Number.isFinite(item.recordedPlaytimeMinutes);
    const recordedPlaytimeMinutes = hasRecordedPlaytime
      ? Math.max(0, Math.min(playtimeMinutes, Math.floor(item.recordedPlaytimeMinutes)))
      : Math.min(playtimeMinutes, overwrittenRecordedByKey.get(gameKey) || 0);
    const lastPlayed = typeof item.lastPlayed === 'string' && item.lastPlayed.trim() ? item.lastPlayed.trim() : null;
    const completedAt = typeof item.completedAt === 'string' && item.completedAt.trim() ? item.completedAt.trim() : null;
    const userScore = item.userScore != null && !isNaN(Number(item.userScore)) ? Number(item.userScore) : null;
    const userNotes = typeof item.userNotes === 'string' ? item.userNotes : null;
    const isDeleted = item.isDeleted ? 1 : 0;
    const clientUpdatedAt = typeof item.clientUpdatedAt === 'string' && item.clientUpdatedAt.trim()
      ? item.clientUpdatedAt.trim()
      : new Date().toISOString();

    const prev = existingByKey.get(gameKey);
    if (prev) {
      const prevSteamId = prev.steam_id != null ? Number(prev.steam_id) : null;
      const mergedSteamId = steamId ?? prevSteamId;
      const prevCover = prev.cover_url || null;
      const mergedCover = prevCover && prevCover.startsWith('/api/images/')
        ? prevCover
        : (coverUrl ?? (prevCover && (prevCover.startsWith('http://') || prevCover.startsWith('https://')) ? prevCover : null));
      const prevBanner = prev.banner_url || null;
      const mergedBanner = prevBanner && prevBanner.startsWith('/api/images/')
        ? prevBanner
        : (bannerUrl ?? (prevBanner && (prevBanner.startsWith('http://') || prevBanner.startsWith('https://')) ? prevBanner : null));
      const mergedStatus = isDeleted === 1
        ? prev.status
        : (status === 'completed' || prev.status === 'completed')
          ? 'completed'
          : (clientUpdatedAt >= prev.client_updated_at ? status : prev.status);
      const prevRecordedPlaytime = Number(prev.recorded_playtime_minutes) || 0;
      const mergedRecordedPlaytime = Math.max(prevRecordedPlaytime, recordedPlaytimeMinutes);
      const mergedManualPlaytime = clientUpdatedAt >= prev.client_updated_at
        ? Math.max(0, playtimeMinutes - recordedPlaytimeMinutes)
        : Math.max(0, (Number(prev.playtime_minutes) || 0) - prevRecordedPlaytime);
      const mergedPlaytime = hasRecordedPlaytime
        ? mergedRecordedPlaytime + mergedManualPlaytime
        : Math.max(Number(prev.playtime_minutes) || 0, playtimeMinutes);
      const prevLastPlayed = prev.last_played || null;
      const mergedLastPlayed = lastPlayed && (!prevLastPlayed || lastPlayed > prevLastPlayed) ? lastPlayed : prevLastPlayed;
      const prevCompletedAt = prev.completed_at || null;
      const mergedCompletedAt = completedAt && (!prevCompletedAt || clientUpdatedAt >= prev.client_updated_at)
        ? completedAt
        : prevCompletedAt;
      const prevUserScore = prev.user_score != null ? Number(prev.user_score) : null;
      const mergedUserScore = clientUpdatedAt >= prev.client_updated_at ? userScore : (prevUserScore ?? userScore);
      const prevUserNotes = prev.user_notes ?? null;
      const mergedUserNotes = clientUpdatedAt >= prev.client_updated_at ? userNotes : (prevUserNotes ?? userNotes);
      const prevIsDeleted = Number(prev.is_deleted) ? 1 : 0;

      const unchanged =
        title === prev.title &&
        mergedSteamId === prevSteamId &&
        mergedCover === prevCover &&
        mergedBanner === prevBanner &&
        mergedStatus === prev.status &&
        mergedPlaytime === (Number(prev.playtime_minutes) || 0) &&
        mergedRecordedPlaytime === prevRecordedPlaytime &&
        mergedLastPlayed === prevLastPlayed &&
        mergedCompletedAt === prevCompletedAt &&
        mergedUserScore === prevUserScore &&
        mergedUserNotes === prevUserNotes &&
        isDeleted === prevIsDeleted;

      if (unchanged) {
        continue;
      }

      existingByKey.set(gameKey, {
        game_key: gameKey,
        title,
        steam_id: mergedSteamId,
        cover_url: mergedCover,
        banner_url: mergedBanner,
        status: mergedStatus,
        playtime_minutes: mergedPlaytime,
        recorded_playtime_minutes: mergedRecordedPlaytime,
        last_played: mergedLastPlayed,
        completed_at: mergedCompletedAt,
        user_score: mergedUserScore,
        user_notes: mergedUserNotes,
        is_deleted: isDeleted,
        client_updated_at: clientUpdatedAt > prev.client_updated_at ? clientUpdatedAt : prev.client_updated_at,
      });
    } else {
      existingByKey.set(gameKey, {
        game_key: gameKey,
        title,
        steam_id: steamId,
        cover_url: coverUrl,
        banner_url: bannerUrl,
        status,
        playtime_minutes: playtimeMinutes,
        recorded_playtime_minutes: recordedPlaytimeMinutes,
        last_played: lastPlayed,
        completed_at: completedAt,
        user_score: userScore,
        user_notes: userNotes,
        is_deleted: isDeleted,
        client_updated_at: clientUpdatedAt,
      });
    }

    libStmts.push(
      upsertStmt.bind(
        user.uid,
        gameKey,
        title,
        steamId,
        coverUrl,
        bannerUrl,
        status,
        playtimeMinutes,
        recordedPlaytimeMinutes,
        lastPlayed,
        completedAt,
        userScore,
        userNotes,
        isDeleted,
        clientUpdatedAt,
        hasRecordedPlaytime ? 1 : 0
      )
    );
  }

  for (let i = 0; i < libStmts.length; i += 80) {
    await env.DB.batch(libStmts.slice(i, i + 80));
  }

  const profileUpdated = await ensureProfile(env, user);
  if (syncMode === 'overwrite' || libStmts.length > 0 || profileUpdated) {
    await refreshSharedLibrary(env, user.uid);
  }

  const rawSessions = Array.isArray(body?.sessions) ? body.sessions : [];
  let sessionStmtsCount = 0;
  if (rawSessions.length > 0) {
    try {
      const existingSessions = new Map<string, { endTime: string | null; durationMinutes: number }>();
      const skipSessionPreload = isDelta && rawSessions.length <= 100;
      if (syncMode !== 'overwrite' && !skipSessionPreload) {
        const sRows = await env.DB.prepare(`
          SELECT game_key, source, start_time, end_time, duration_minutes
          FROM user_sessions
          WHERE uid = ?
        `).bind(user.uid).all<any>();
        for (const r of sRows.results || []) {
          existingSessions.set(`${r.game_key}\0${r.source}\0${r.start_time}`, {
            endTime: r.end_time || null,
            durationMinutes: Number(r.duration_minutes) || 0,
          });
        }
      }

      const sessionUpsert = env.DB.prepare(`
        INSERT INTO user_sessions (uid, game_key, source, start_time, end_time, duration_minutes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(uid, game_key, source, start_time) DO UPDATE SET
          end_time = CASE
            WHEN excluded.end_time IS NOT NULL AND (user_sessions.end_time IS NULL OR excluded.end_time > user_sessions.end_time)
            THEN excluded.end_time ELSE user_sessions.end_time
          END,
          duration_minutes = MAX(user_sessions.duration_minutes, excluded.duration_minutes)
        WHERE (excluded.end_time IS NOT NULL AND (user_sessions.end_time IS NULL OR excluded.end_time > user_sessions.end_time))
           OR excluded.duration_minutes > user_sessions.duration_minutes
      `);
      const stmts: any[] = [];
      for (const s of rawSessions.slice(0, 5000)) {
        if (!s || typeof s.gameKey !== 'string' || !s.gameKey.trim()) continue;
        const gameKey = s.gameKey.trim();
        const source = typeof s.source === 'string' && s.source.trim() ? s.source.trim().slice(0, 32) : 'tracker';
        if (source === 'manual') continue;
        const startTime = typeof s.startTime === 'string' && s.startTime.trim() ? s.startTime.trim().slice(0, 48) : '';
        if (!startTime) continue;
        const endTime = typeof s.endTime === 'string' && s.endTime.trim() ? s.endTime.trim().slice(0, 48) : null;
        const durationMinutes = Math.max(0, Math.floor(Number(s.durationMinutes) || 0));
        if (durationMinutes <= 0) continue;

        if (!skipSessionPreload) {
          const sKey = `${gameKey}\0${source}\0${startTime}`;
          const prev = existingSessions.get(sKey);
          if (prev) {
            const endChanged = Boolean(endTime && (!prev.endTime || endTime > prev.endTime));
            const durChanged = durationMinutes > prev.durationMinutes;
            if (!endChanged && !durChanged) continue;
            existingSessions.set(sKey, {
              endTime: endChanged ? endTime : prev.endTime,
              durationMinutes: Math.max(prev.durationMinutes, durationMinutes),
            });
          } else {
            existingSessions.set(sKey, { endTime, durationMinutes });
          }
        }

        stmts.push(sessionUpsert.bind(user.uid, gameKey, source, startTime, endTime, durationMinutes));
      }
      sessionStmtsCount = stmts.length;
      for (let i = 0; i < stmts.length; i += 80) {
        await env.DB.batch(stmts.slice(i, i + 80));
      }
    } catch {
      // Ignore if user_sessions is not migrated in older test fixtures
    }
  }

  if (syncMode === 'overwrite') {
    await bumpUserSyncEpoch(env, user.uid);
  } else if (libStmts.length > 0 || sessionStmtsCount > 0) {
    await touchUserSyncState(env, user.uid);
  }

  return jsonResponse(await fetchUserLibraryResponse(env, user.uid, { since }));
};
