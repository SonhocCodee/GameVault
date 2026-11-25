import type { RouteHandler, Env, CoverCachePayload, AuthUser } from '../types.ts';
import { jsonResponse, errorResponse } from '../utils.ts';
import { saveImageToCloud, ALLOWED_CONTENT_TYPES } from './images.ts';
import { authenticate, isAdminUser } from '../auth.ts';

const STEAM_STATIC_CDN_BASE = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps';
const IGDB_API_URL = 'https://api.igdb.com/v4/games';
const IGDB_IMAGE_CDN = 'https://images.igdb.com/igdb/image/upload';
let cachedTwitchToken: { token: string; expiresAt: number } | null = null;

async function getTwitchAccessToken(env: Env): Promise<{ clientId: string; token: string } | null> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return null;
  if (cachedTwitchToken && Date.now() < cachedTwitchToken.expiresAt) {
    return { clientId: env.TWITCH_CLIENT_ID, token: cachedTwitchToken.token };
  }
  try {
    const url =
      `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(env.TWITCH_CLIENT_ID)}` +
      `&client_secret=${encodeURIComponent(env.TWITCH_CLIENT_SECRET)}&grant_type=client_credentials`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data?.access_token) return null;
    cachedTwitchToken = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 300) * 1000,
    };
    return { clientId: env.TWITCH_CLIENT_ID, token: data.access_token };
  } catch {
    return null;
  }
}

async function searchIgdbCandidates(
  env: Env,
  query: string,
  steamId?: number | null
): Promise<Array<{ id: number; name: string; posterUrl: string | null; bannerUrl: string | null }>> {
  const auth = await getTwitchAccessToken(env);
  if (!auth) return [];

  const splitCamel = query.replace(/([a-z])([A-Z])/g, '$1 $2');
  const clean = splitCamel.replace(/"/g, '').trim();

  const runIgdbPost = async (body: string) => {
    const res = await fetch(IGDB_API_URL, {
      method: 'POST',
      headers: {
        'Client-ID': auth.clientId,
        'Authorization': `Bearer ${auth.token}`,
        'Accept': 'application/json',
      },
      body,
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    return Array.isArray(rows) ? rows : [];
  };

  try {
    let rows: any[] = [];
    if (steamId && steamId > 0) {
      rows = await runIgdbPost(
        `fields name, cover.image_id, artworks.image_id, screenshots.image_id; where external_games.category = 1 & external_games.uid = "${steamId}"; limit 5;`
      );
    }
    if (rows.length === 0 && clean) {
      rows = await runIgdbPost(
        `search "${clean}"; fields name, cover.image_id, artworks.image_id, screenshots.image_id; limit 8;`
      );
    }
    return rows.map((r) => {
      const coverId = r?.cover?.image_id;
      const artId = r?.artworks?.[0]?.image_id || r?.screenshots?.[0]?.image_id || coverId;
      return {
        id: Number(r.id),
        name: String(r.name || ''),
        posterUrl: coverId ? `${IGDB_IMAGE_CDN}/t_cover_big_2x/${coverId}.jpg` : null,
        bannerUrl: artId ? `${IGDB_IMAGE_CDN}/t_1080p/${artId}.jpg` : null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Normalizes gameKey: clean and sanitize key.
 */
function sanitizeGameKey(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
}

function normalizeImageKey(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const idx = url.indexOf('/api/images/');
  if (idx === -1) return null;
  const key = url.slice(idx + '/api/images/'.length).split('?')[0].trim();
  return key || null;
}

async function requireAdmin(
  request: Request,
  env: Env
): Promise<{ user: AuthUser; error?: never } | { user?: never; error: Response }> {
  const user = await authenticate(request, env);
  if (!user) {
    return { error: errorResponse('Authentication required', 401) };
  }
  if (!isAdminUser(user, env)) {
    return { error: errorResponse('Admin access required', 403) };
  }
  return { user };
}

export interface CoverPropagationStats {
  userLibraryUpdated: number;
  ratingsUpdated: number;
  picksUpdated: number;
  votesUpdated: number;
}

/**
 * Propagates a master cover update across all D1 tables (`user_library`, `ratings`,
 * `community_picks`, `community_votes`) so every user and view sees the updated artwork.
 */
export async function propagateCoverAcrossTables(
  env: Env,
  params: {
    gameKey: string;
    title?: string | null;
    steamId?: number | null;
    coverUrl?: string | null;
    bannerUrl?: string | null;
  }
): Promise<CoverPropagationStats> {
  const cleanKey = sanitizeGameKey(params.gameKey);
  const title = (params.title || '').trim();
  const steamId = params.steamId && Number(params.steamId) > 0 ? Number(params.steamId) : null;
  const coverUrl = params.coverUrl ?? null;
  const bannerUrl = params.bannerUrl ?? null;

  let userLibraryUpdated = 0;
  let ratingsUpdated = 0;
  let picksUpdated = 0;
  let votesUpdated = 0;

  if (coverUrl || bannerUrl) {
    const libRes = await env.DB.prepare(`
      UPDATE user_library
      SET cover_url = COALESCE(?, cover_url),
          banner_url = COALESCE(?, banner_url),
          steam_id = COALESCE(?, steam_id),
          server_updated_at = datetime('now')
      WHERE lower(game_key) = ?
         OR (? IS NOT NULL AND steam_id = ?)
         OR (? != '' AND lower(trim(title)) = lower(?))
    `).bind(
      coverUrl,
      bannerUrl,
      steamId,
      cleanKey,
      steamId,
      steamId,
      title,
      title
    ).run();
    userLibraryUpdated = Number(libRes.meta?.changes || 0);
  }

  if (coverUrl) {
    const ratingsRes = await env.DB.prepare(`
      UPDATE ratings
      SET cover_url = ?,
          updated_at = datetime('now')
      WHERE lower(game_key) = ?
         OR (? != '' AND lower(trim(game_title)) = lower(?))
    `).bind(coverUrl, cleanKey, title, title).run();
    ratingsUpdated = Number(ratingsRes.meta?.changes || 0);

    const picksRes = await env.DB.prepare(`
      UPDATE community_picks
      SET cover_url = ?,
          updated_at = datetime('now')
      WHERE lower(game_key) = ?
         OR (? != '' AND lower(trim(game_title)) = lower(?))
    `).bind(coverUrl, cleanKey, title, title).run();
    picksUpdated = Number(picksRes.meta?.changes || 0);

    const votesRes = await env.DB.prepare(`
      UPDATE community_votes
      SET cover_url = ?
      WHERE lower(game_key) = ?
         OR (? != '' AND lower(trim(game_title)) = lower(?))
    `).bind(coverUrl, cleanKey, title, title).run();
    votesUpdated = Number(votesRes.meta?.changes || 0);
  }

  return {
    userLibraryUpdated,
    ratingsUpdated,
    picksUpdated,
    votesUpdated,
  };
}

/**
 * Downloads an external image from an HTTP/HTTPS URL and stores it in the cloud.
 * Returns the permanent cloud path (/api/images/...) or null if download failed.
 */
async function ingestExternalImage(
  url: string,
  keyPrefix: string,
  env: Env,
  kind: string
): Promise<string | null> {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return null;
  }

  // Already a permanent cloud URL?
  if (url.startsWith('/api/images/') || url.includes('/api/images/')) {
    const parts = url.split('/api/images/');
    return `/api/images/${parts[parts.length - 1]}`;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'GameVault/1.0 (Cover Ingestion Worker)' },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res || !res.ok) return null;

    const rawMime = res.headers.get('content-type') || 'image/jpeg';
    const mime = rawMime.split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_CONTENT_TYPES[mime] || (url.toLowerCase().endsWith('.png') ? 'png' : 'jpg');
    const validMime = mime && ALLOWED_CONTENT_TYPES[mime] ? mime : (ext === 'png' ? 'image/png' : 'image/jpeg');

    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) return null;

    const key = `${keyPrefix}_${Date.now()}.${ext}`;
    const cloudUrl = await saveImageToCloud(key, buf, validMime, env, { kind });
    return cloudUrl;
  } catch (err) {
    console.warn(`[covers] Failed to ingest external image ${url}:`, err);
    return null;
  }
}

/**
 * GET /api/covers/:gameKey
 * Retrieves the single cloud source of truth cover metadata for a game.
 */
export const handleGetCover: RouteHandler = async (_request, env, ctx) => {
  const gameKey = ctx.params?.gameKey;
  if (!gameKey) {
    return errorResponse('Game key required', 400);
  }

  const cleanKey = sanitizeGameKey(gameKey);
  const row = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url, created_at, updated_at FROM game_covers WHERE game_key = ?'
  ).bind(cleanKey).first<any>();

  if (!row) {
    return jsonResponse({
      found: false,
      gameKey: cleanKey,
    }, 404);
  }

  return jsonResponse({
    found: true,
    gameKey: row.game_key,
    title: row.title,
    steamId: row.steam_id,
    coverUrl: row.cover_url,
    bannerUrl: row.banner_url,
    updatedAt: row.updated_at,
  });
};

/**
 * POST /api/covers/cache
 * Central Ingestion: Given a game and optional source URLs, checks if our cloud
 * already has permanent cached images. If not, ingests and saves the image binaries
 * directly into the cloud so every user in the world receives the exact same, durable cloud URL.
 */
export const handleCacheCover: RouteHandler = async (request, env) => {
  let body: CoverCachePayload;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.gameKey || typeof body.gameKey !== 'string') {
    return errorResponse('gameKey is required', 400);
  }

  const gameKey = sanitizeGameKey(body.gameKey);
  const title = (body.title || 'Unknown Game').trim();
  const steamId = body.steamId && Number(body.steamId) > 0 ? Number(body.steamId) : null;

  // 1. Check if already cached in cloud
  const existing = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers WHERE game_key = ?'
  ).bind(gameKey).first<any>();

  const isCoverCached = existing?.cover_url && existing.cover_url.startsWith('/api/images/');
  const isBannerCached = existing?.banner_url && existing.banner_url.startsWith('/api/images/');

  // If both cover and banner are already stored on our cloud, return immediately!
  if (isCoverCached && isBannerCached) {
    return jsonResponse({
      gameKey,
      title: existing.title || title,
      steamId: existing.steam_id || steamId,
      coverUrl: existing.cover_url,
      bannerUrl: existing.banner_url,
      fromCache: true,
    });
  }

  let finalCoverUrl = isCoverCached ? existing.cover_url : null;
  let finalBannerUrl = isBannerCached ? existing.banner_url : null;

  // 2. Ingest Poster if not yet cached
  if (!finalCoverUrl) {
    let sourcePoster = body.sourcePosterUrl;
    if (!sourcePoster && steamId) {
      sourcePoster = `${STEAM_STATIC_CDN_BASE}/${steamId}/library_600x900_2x.jpg`;
    }
    if (sourcePoster) {
      finalCoverUrl = await ingestExternalImage(
        sourcePoster,
        `cover_${gameKey}_poster`,
        env,
        'cover_poster'
      );
    }
    // Fallback: smaller 600x900 if 2x failed
    if (!finalCoverUrl && steamId) {
      finalCoverUrl = await ingestExternalImage(
        `${STEAM_STATIC_CDN_BASE}/${steamId}/library_600x900.jpg`,
        `cover_${gameKey}_poster`,
        env,
        'cover_poster'
      );
    }
    // Fallback: IGDB (Twitch) canonical 2:3 poster if server Twitch credentials are configured
    if (!finalCoverUrl && title) {
      const igdb = await searchIgdbCandidates(env, title, steamId);
      const igdbPoster = igdb.find((c) => c.posterUrl)?.posterUrl;
      if (igdbPoster) {
        finalCoverUrl = await ingestExternalImage(igdbPoster, `cover_${gameKey}_poster`, env, 'cover_poster');
      }
      if (!finalBannerUrl) {
        const igdbBanner = igdb.find((c) => c.bannerUrl)?.bannerUrl;
        if (igdbBanner) {
          finalBannerUrl = await ingestExternalImage(igdbBanner, `cover_${gameKey}_banner`, env, 'cover_banner');
        }
      }
    }
  }

  // 3. Ingest Banner if not yet cached
  if (!finalBannerUrl) {
    let sourceBanner = body.sourceBannerUrl;
    if (!sourceBanner && steamId) {
      sourceBanner = `${STEAM_STATIC_CDN_BASE}/${steamId}/library_hero.jpg`;
    }
    if (sourceBanner) {
      finalBannerUrl = await ingestExternalImage(
        sourceBanner,
        `cover_${gameKey}_banner`,
        env,
        'cover_banner'
      );
    }
    // Fallback: header.jpg
    if (!finalBannerUrl && steamId) {
      finalBannerUrl = await ingestExternalImage(
        `${STEAM_STATIC_CDN_BASE}/${steamId}/header.jpg`,
        `cover_${gameKey}_banner`,
        env,
        'cover_banner'
      );
    }
  }

  // If still missing banner, reuse cover if available or vice-versa
  if (!finalCoverUrl && finalBannerUrl) finalCoverUrl = finalBannerUrl;
  if (!finalBannerUrl && finalCoverUrl) finalBannerUrl = finalCoverUrl;

  // 4. Save into game_covers master catalog
  if (finalCoverUrl || finalBannerUrl) {
    await env.DB.prepare(`
      INSERT INTO game_covers (game_key, title, steam_id, cover_url, banner_url, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(game_key) DO UPDATE SET
        title = excluded.title,
        steam_id = COALESCE(excluded.steam_id, game_covers.steam_id),
        cover_url = COALESCE(excluded.cover_url, game_covers.cover_url),
        banner_url = COALESCE(excluded.banner_url, game_covers.banner_url),
        updated_at = datetime('now')
    `).bind(
      gameKey,
      title,
      steamId,
      finalCoverUrl,
      finalBannerUrl
    ).run();
  }

  return jsonResponse({
    gameKey,
    title,
    steamId,
    coverUrl: finalCoverUrl,
    bannerUrl: finalBannerUrl,
    fromCache: false,
  });
};

/**
 * POST /api/covers/upload
 * Allows desktop client to upload an optimized binary image directly to the cloud
 * (e.g. for custom covers or screenshots), updating the central catalog.
 */
export const handleUploadCover: RouteHandler = async (request, env) => {
  const url = new URL(request.url);
  const gameKeyParam = url.searchParams.get('gameKey') || request.headers.get('X-Game-Key');
  const typeParam = url.searchParams.get('type') || request.headers.get('X-Cover-Type') || 'poster';
  const titleParam = url.searchParams.get('title') || request.headers.get('X-Game-Title') || 'Unknown Game';
  const steamIdParam = url.searchParams.get('steamId') || request.headers.get('X-Steam-Id');

  if (!gameKeyParam) {
    return errorResponse('gameKey parameter or X-Game-Key header required', 400);
  }

  const gameKey = sanitizeGameKey(gameKeyParam);
  const type = typeParam === 'banner' ? 'banner' : 'poster';
  const steamId = steamIdParam ? Number(steamIdParam) : null;

  const rawContentType = request.headers.get('Content-Type') || 'image/jpeg';
  const mime = rawContentType.split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_CONTENT_TYPES[mime] || 'jpg';
  const validMime = ALLOWED_CONTENT_TYPES[mime] ? mime : 'image/jpeg';

  const buffer = await request.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    return errorResponse('Empty image payload', 400);
  }

  const key = `cover_${gameKey}_${type}_${Date.now()}.${ext}`;
  const cloudUrl = await saveImageToCloud(key, buffer, validMime, env, { kind: `cover_${type}` });

  // Update game_covers
  const coverUpdate = type === 'poster' ? cloudUrl : null;
  const bannerUpdate = type === 'banner' ? cloudUrl : null;

  await env.DB.prepare(`
    INSERT INTO game_covers (game_key, title, steam_id, cover_url, banner_url, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(game_key) DO UPDATE SET
      title = excluded.title,
      steam_id = COALESCE(excluded.steam_id, game_covers.steam_id),
      cover_url = CASE WHEN ? IS NOT NULL THEN ? ELSE game_covers.cover_url END,
      banner_url = CASE WHEN ? IS NOT NULL THEN ? ELSE game_covers.banner_url END,
      updated_at = datetime('now')
  `).bind(
    gameKey,
    titleParam,
    steamId,
    coverUpdate,
    bannerUpdate,
    coverUpdate,
    coverUpdate,
    bannerUpdate,
    bannerUpdate
  ).run();

  return jsonResponse({
    success: true,
    gameKey,
    type,
    url: cloudUrl,
  }, 201);
};

/**
 * GET /api/admin/config
 * Public auth config for the Admin Web Dashboard.
 */
export const handleAdminConfig: RouteHandler = async (_request, env) => {
  return jsonResponse({
    webGoogleClientId: env.WEB_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || '',
    hasSeparateWebClientId: Boolean(env.WEB_GOOGLE_CLIENT_ID),
  });
};

/**
 * GET /api/admin/me
 * Verifies current session belongs to an administrator and returns overview stats.
 */
export const handleAdminMe: RouteHandler = async (request, env) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const stats = await collectAdminStats(env);
  return jsonResponse({
    user: auth.user,
    isAdmin: true,
    stats,
  });
};

async function collectAdminStats(env: Env) {
  const [coversRow, missingRow, externalRow, cloudRow, libRow, ratingsRow, imagesRow] = await Promise.all([
    env.DB.prepare('SELECT count(*) as total FROM game_covers').first<any>(),
    env.DB.prepare(
      "SELECT count(*) as total FROM game_covers WHERE cover_url IS NULL OR cover_url = '' OR banner_url IS NULL OR banner_url = ''"
    ).first<any>(),
    env.DB.prepare(
      "SELECT count(*) as total FROM game_covers WHERE (cover_url LIKE 'http%' AND cover_url NOT LIKE '%/api/images/%') OR (banner_url LIKE 'http%' AND banner_url NOT LIKE '%/api/images/%')"
    ).first<any>(),
    env.DB.prepare(
      "SELECT count(*) as total FROM game_covers WHERE cover_url LIKE '/api/images/%' AND banner_url LIKE '/api/images/%'"
    ).first<any>(),
    env.DB.prepare('SELECT count(*) as total FROM user_library WHERE is_deleted = 0').first<any>(),
    env.DB.prepare('SELECT count(*) as total FROM ratings').first<any>(),
    env.DB.prepare('SELECT count(*) as total FROM image_store').first<any>().catch(() => ({ total: 0 })),
  ]);

  return {
    totalCovers: Number(coversRow?.total || 0),
    missingCovers: Number(missingRow?.total || 0),
    externalCovers: Number(externalRow?.total || 0),
    cloudCovers: Number(cloudRow?.total || 0),
    libraryGamesCount: Number(libRow?.total || 0),
    reviewsCount: Number(ratingsRow?.total || 0),
    storedImagesCount: Number(imagesRow?.total || 0),
  };
}

/**
 * GET /api/admin/covers
 * Lists or searches cloud game covers with filtering and pagination for administrators.
 */
export const handleAdminGetCovers: RouteHandler = async (request, env) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const query = (url.searchParams.get('query') || '').trim();
  const filter = (url.searchParams.get('filter') || 'all').trim().toLowerCase();
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.max(1, Math.min(isNaN(limitParam) ? 50 : limitParam, 200));
  const offsetParam = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Math.max(0, isNaN(offsetParam) ? 0 : offsetParam);

  // Automatically register any games already synced by users so searching finds them immediately
  if (offset === 0) {
    try {
      await discoverGamesIntoCatalog(env);
    } catch (err) {
      console.warn('[admin] Auto-discover warning:', err);
    }
  }

  const conditions: string[] = [];
  const binds: any[] = [];

  if (query) {
    const term = `%${query.toLowerCase()}%`;
    conditions.push('(lower(game_key) LIKE ? OR lower(title) LIKE ? OR CAST(steam_id AS TEXT) LIKE ?)');
    binds.push(term, term, term);
  }

  if (filter === 'missing') {
    conditions.push("(cover_url IS NULL OR cover_url = '' OR banner_url IS NULL OR banner_url = '')");
  } else if (filter === 'external') {
    conditions.push(
      "((cover_url LIKE 'http%' AND cover_url NOT LIKE '%/api/images/%') OR (banner_url LIKE 'http%' AND banner_url NOT LIKE '%/api/images/%'))"
    );
  } else if (filter === 'cloud') {
    conditions.push("(cover_url LIKE '/api/images/%' AND banner_url LIKE '/api/images/%')");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = await env.DB.prepare(`SELECT count(*) as total FROM game_covers ${whereClause}`)
    .bind(...binds)
    .first<any>();
  const total = Number(countRow?.total || 0);

  const rows = await env.DB.prepare(
    `SELECT game_key, title, steam_id, cover_url, banner_url, created_at, updated_at
     FROM game_covers ${whereClause}
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, limit, offset)
    .all();

  const stats = await collectAdminStats(env);

  return jsonResponse({
    covers: rows.results || [],
    total,
    limit,
    offset,
    stats,
  });
};

/**
 * PUT /api/admin/covers/:gameKey
 * Updates or overrides game covers in the cloud master catalog and propagates
 * the updated artwork across all server tables (admin only).
 */
export const handleAdminUpdateCover: RouteHandler = async (request, env, ctx) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const gameKeyParam = ctx.params?.gameKey;
  if (!gameKeyParam) {
    return errorResponse('gameKey parameter is required', 400);
  }
  const cleanKey = sanitizeGameKey(gameKeyParam);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const existing = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers WHERE game_key = ?'
  ).bind(cleanKey).first<any>();

  const title = body.title !== undefined ? String(body.title).trim() : (existing?.title || cleanKey);
  const steamId = body.steamId !== undefined ? (Number(body.steamId) > 0 ? Number(body.steamId) : null) : (existing?.steam_id || null);

  let coverUrl: string | null = existing?.cover_url || null;
  let bannerUrl: string | null = existing?.banner_url || null;

  // Process poster/cover URL update
  if (body.sourcePosterUrl) {
    const ingested = await ingestExternalImage(body.sourcePosterUrl, `cover_${cleanKey}_poster`, env, 'cover_poster');
    if (ingested) coverUrl = ingested;
  } else if (body.coverUrl !== undefined) {
    if (body.coverUrl === null || body.coverUrl === '') {
      coverUrl = null;
    } else if (String(body.coverUrl).includes('/api/images/')) {
      const key = normalizeImageKey(String(body.coverUrl));
      coverUrl = key ? `/api/images/${key}` : String(body.coverUrl);
    } else {
      const ingested = await ingestExternalImage(String(body.coverUrl), `cover_${cleanKey}_poster`, env, 'cover_poster');
      coverUrl = ingested || String(body.coverUrl);
    }
  }

  // Process banner URL update
  if (body.sourceBannerUrl) {
    const ingested = await ingestExternalImage(body.sourceBannerUrl, `cover_${cleanKey}_banner`, env, 'cover_banner');
    if (ingested) bannerUrl = ingested;
  } else if (body.bannerUrl !== undefined) {
    if (body.bannerUrl === null || body.bannerUrl === '') {
      bannerUrl = null;
    } else if (String(body.bannerUrl).includes('/api/images/')) {
      const key = normalizeImageKey(String(body.bannerUrl));
      bannerUrl = key ? `/api/images/${key}` : String(body.bannerUrl);
    } else {
      const ingested = await ingestExternalImage(String(body.bannerUrl), `cover_${cleanKey}_banner`, env, 'cover_banner');
      bannerUrl = ingested || String(body.bannerUrl);
    }
  }

  await env.DB.prepare(`
    INSERT INTO game_covers (game_key, title, steam_id, cover_url, banner_url, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(game_key) DO UPDATE SET
      title = excluded.title,
      steam_id = excluded.steam_id,
      cover_url = excluded.cover_url,
      banner_url = excluded.banner_url,
      updated_at = datetime('now')
  `).bind(cleanKey, title, steamId, coverUrl, bannerUrl).run();

  const syncStats = await propagateCoverAcrossTables(env, {
    gameKey: cleanKey,
    title,
    steamId,
    coverUrl,
    bannerUrl,
  });

  const updated = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url, created_at, updated_at FROM game_covers WHERE game_key = ?'
  ).bind(cleanKey).first<any>();

  return jsonResponse({
    success: true,
    gameKey: cleanKey,
    cover: updated,
    syncStats,
  });
};

/**
 * POST /api/admin/covers/:gameKey/upload
 * Admin-authenticated binary image upload that updates game_covers and propagates
 * the new image across all server tables.
 */
export const handleAdminUploadCover: RouteHandler = async (request, env, ctx) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const gameKeyParam = ctx.params?.gameKey;
  if (!gameKeyParam) {
    return errorResponse('gameKey parameter is required', 400);
  }
  const cleanKey = sanitizeGameKey(gameKeyParam);

  const url = new URL(request.url);
  const typeParam = url.searchParams.get('type') || request.headers.get('X-Cover-Type') || 'poster';
  const type = typeParam === 'banner' ? 'banner' : 'poster';

  const existing = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers WHERE game_key = ?'
  ).bind(cleanKey).first<any>();

  const titleParam = (url.searchParams.get('title') || request.headers.get('X-Game-Title') || existing?.title || cleanKey).trim();
  const steamIdRaw = url.searchParams.get('steamId') || request.headers.get('X-Steam-Id');
  const steamId = steamIdRaw && Number(steamIdRaw) > 0 ? Number(steamIdRaw) : (existing?.steam_id || null);

  const rawContentType = request.headers.get('Content-Type') || 'image/jpeg';
  const mime = rawContentType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES[mime]) {
    return errorResponse('Unsupported image type. Allowed: png, jpg, webp, gif', 415);
  }
  const ext = ALLOWED_CONTENT_TYPES[mime];

  const buffer = await request.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    return errorResponse('Empty image payload', 400);
  }
  if (buffer.byteLength > 10 * 1024 * 1024) {
    return errorResponse('Image exceeds maximum size of 10MB', 413);
  }

  const key = `cover_${cleanKey}_${type}_${Date.now()}.${ext}`;
  const cloudUrl = await saveImageToCloud(key, buffer, mime, env, {
    uploadedBy: auth.user.uid,
    kind: `admin_cover_${type}`,
  });

  const nextCoverUrl = type === 'poster' ? cloudUrl : (existing?.cover_url || null);
  const nextBannerUrl = type === 'banner' ? cloudUrl : (existing?.banner_url || null);

  await env.DB.prepare(`
    INSERT INTO game_covers (game_key, title, steam_id, cover_url, banner_url, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(game_key) DO UPDATE SET
      title = excluded.title,
      steam_id = COALESCE(excluded.steam_id, game_covers.steam_id),
      cover_url = excluded.cover_url,
      banner_url = excluded.banner_url,
      updated_at = datetime('now')
  `).bind(cleanKey, titleParam, steamId, nextCoverUrl, nextBannerUrl).run();

  const syncStats = await propagateCoverAcrossTables(env, {
    gameKey: cleanKey,
    title: titleParam,
    steamId,
    coverUrl: nextCoverUrl,
    bannerUrl: nextBannerUrl,
  });

  const updated = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url, created_at, updated_at FROM game_covers WHERE game_key = ?'
  ).bind(cleanKey).first<any>();

  return jsonResponse({
    success: true,
    gameKey: cleanKey,
    type,
    url: cloudUrl,
    cover: updated,
    syncStats,
  }, 201);
};

async function discoverGamesIntoCatalog(env: Env): Promise<{ discovered: number; totalCovers: number }> {
  const discoveredRows = await env.DB.prepare(`
    SELECT lower(game_key) AS game_key,
           MAX(title) AS title,
           MAX(steam_id) AS steam_id,
           MAX(cover_url) AS cover_url,
           MAX(banner_url) AS banner_url
    FROM (
      SELECT game_key, title, steam_id, cover_url, banner_url FROM user_library WHERE is_deleted = 0
      UNION ALL
      SELECT game_key, game_title AS title, NULL AS steam_id, cover_url, NULL AS banner_url FROM ratings
      UNION ALL
      SELECT game_key, game_title AS title, NULL AS steam_id, cover_url, NULL AS banner_url FROM community_picks WHERE game_key IS NOT NULL AND game_key != ''
      UNION ALL
      SELECT game_key, game_title AS title, NULL AS steam_id, cover_url, NULL AS banner_url FROM community_votes
    ) all_games
    WHERE game_key IS NOT NULL AND trim(game_key) != ''
    GROUP BY lower(game_key)
  `).all<any>();

  let inserted = 0;
  for (const row of discoveredRows.results || []) {
    const cleanKey = sanitizeGameKey(row.game_key);
    if (!cleanKey) continue;
    const existing = await env.DB.prepare('SELECT game_key FROM game_covers WHERE game_key = ?')
      .bind(cleanKey)
      .first();
    if (existing) continue;

    await env.DB.prepare(`
      INSERT INTO game_covers (game_key, title, steam_id, cover_url, banner_url, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      cleanKey,
      (row.title || cleanKey).trim(),
      row.steam_id && Number(row.steam_id) > 0 ? Number(row.steam_id) : null,
      row.cover_url || null,
      row.banner_url || null
    ).run();
    inserted++;
  }

  const totalRow = await env.DB.prepare('SELECT count(*) as total FROM game_covers').first<any>();
  return {
    discovered: inserted,
    totalCovers: Number(totalRow?.total || 0),
  };
}

/**
 * POST /api/admin/covers/discover
 * Discovers games from user_library, ratings, community_picks, and community_votes
 * that are not yet registered in game_covers.
 */
export const handleAdminDiscoverGames: RouteHandler = async (request, env) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const result = await discoverGamesIntoCatalog(env);
  return jsonResponse({
    success: true,
    ...result,
  });
};

/**
 * POST /api/admin/covers/igdb-search
 * Searches IGDB (Twitch) for canonical 2:3 posters and 16:9 artworks when
 * TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are configured on the Worker.
 */
export const handleAdminIgdbSearch: RouteHandler = async (request, env) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return jsonResponse({
      configured: false,
      results: [],
      message: 'Chưa cấu hình TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET trên Worker.',
    });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {}

  const query = String(body?.query || '').trim();
  const steamId = body?.steamId ? Number(body.steamId) : null;
  if (!query && !steamId) {
    return errorResponse('query or steamId is required', 400);
  }

  const results = await searchIgdbCandidates(env, query, steamId);
  return jsonResponse({
    configured: true,
    results,
  });
};

async function checkSingleImageUrl(
  url: string | null | undefined,
  env: Env
): Promise<{ status: 'ok' | 'broken' | 'missing' | 'external_ok'; httpStatus?: number; reason?: string }> {
  if (!url || !url.trim()) {
    return { status: 'missing', reason: 'Chưa có ảnh' };
  }

  const trimmed = url.trim();
  const internalKey = normalizeImageKey(trimmed);
  if (internalKey) {
    if (env.IMAGES_BUCKET) {
      const head = await env.IMAGES_BUCKET.head(internalKey);
      return head ? { status: 'ok', httpStatus: 200 } : { status: 'broken', httpStatus: 404, reason: 'Không tìm thấy trong R2' };
    }
    const row = await env.DB.prepare('SELECT length(data) as sz FROM image_store WHERE key = ?').bind(internalKey).first<any>();
    return row && Number(row.sz) > 0
      ? { status: 'ok', httpStatus: 200 }
      : { status: 'broken', httpStatus: 404, reason: 'Không tìm thấy trong D1 image_store' };
  }

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return { status: 'broken', reason: 'URL không hợp lệ' };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(trimmed, {
        method: 'HEAD',
        headers: { 'User-Agent': 'GameVault/1.0 (Admin Health Check)' },
        signal: ctrl.signal,
      });
      if (res.status === 405) {
        res = await fetch(trimmed, {
          method: 'GET',
          headers: { 'User-Agent': 'GameVault/1.0 (Admin Health Check)', Range: 'bytes=0-0' },
          signal: ctrl.signal,
        });
      }
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      return { status: 'external_ok', httpStatus: res.status };
    }
    return { status: 'broken', httpStatus: res.status, reason: `HTTP ${res.status}` };
  } catch (err: any) {
    return { status: 'broken', reason: err?.name === 'AbortError' ? 'Timeout' : (err?.message || 'Fetch error') };
  }
}

/**
 * POST /api/admin/covers/health-check
 * Scans covers for missing, broken (404/unreachable), or un-ingested external URLs.
 */
export const handleAdminHealthCheck: RouteHandler = async (request, env) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body: any = {};
  try {
    body = await request.json();
  } catch {}

  const requestedKeys = Array.isArray(body?.gameKeys)
    ? body.gameKeys.map((k: any) => sanitizeGameKey(String(k))).filter(Boolean)
    : [];
  // Keep <= 20 games per request (<= 40 outbound HEAD fetches) to stay under Cloudflare's 50-subrequest limit
  const limit = Math.max(1, Math.min(Number(body?.limit) || 15, 20));
  const offset = Math.max(0, Number(body?.offset) || 0);

  let rows: any[] = [];
  if (requestedKeys.length > 0) {
    const placeholders = requestedKeys.slice(0, 20).map(() => '?').join(',');
    const res = await env.DB.prepare(
      `SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers WHERE game_key IN (${placeholders})`
    ).bind(...requestedKeys.slice(0, 20)).all<any>();
    rows = res.results || [];
  } else {
    const res = await env.DB.prepare(
      'SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all<any>();
    rows = res.results || [];
  }

  const results = await Promise.all(
    rows.map(async (row) => {
      const [poster, banner] = await Promise.all([
        checkSingleImageUrl(row.cover_url, env),
        checkSingleImageUrl(row.banner_url, env),
      ]);

      let overall: 'healthy' | 'broken' | 'missing' | 'external' = 'healthy';
      if (poster.status === 'broken' || banner.status === 'broken') {
        overall = 'broken';
      } else if (poster.status === 'missing' || banner.status === 'missing') {
        overall = 'missing';
      } else if (poster.status === 'external_ok' || banner.status === 'external_ok') {
        overall = 'external';
      }

      return {
        gameKey: row.game_key,
        title: row.title,
        overall,
        poster,
        banner,
      };
    })
  );

  return jsonResponse({
    checked: results.length,
    results,
  });
};

/**
 * POST /api/admin/covers/batch-ingest
 * Downloads external / Steam CDN covers into permanent cloud storage (/api/images/...)
 * and propagates them across all server tables.
 */
export const handleAdminBatchIngest: RouteHandler = async (request, env) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body: any = {};
  try {
    body = await request.json();
  } catch {}

  // Keep <= 12 games per batch to stay well under Cloudflare Worker's 50-subrequest limit
  const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 12));
  const requestedKeys = Array.isArray(body?.gameKeys)
    ? body.gameKeys.map((k: any) => sanitizeGameKey(String(k))).filter(Boolean)
    : [];

  let rows: any[] = [];
  if (requestedKeys.length > 0) {
    const placeholders = requestedKeys.slice(0, 12).map(() => '?').join(',');
    const res = await env.DB.prepare(
      `SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers WHERE game_key IN (${placeholders})`
    ).bind(...requestedKeys.slice(0, 12)).all<any>();
    rows = res.results || [];
  } else {
    const res = await env.DB.prepare(`
      SELECT game_key, title, steam_id, cover_url, banner_url
      FROM game_covers
      WHERE (cover_url IS NULL OR cover_url = '' OR cover_url NOT LIKE '/api/images/%')
         OR (banner_url IS NULL OR banner_url = '' OR banner_url NOT LIKE '/api/images/%')
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(limit).all<any>();
    rows = res.results || [];
  }

  let fixed = 0;
  let failed = 0;
  const details: Array<{ gameKey: string; fixed: boolean; coverUrl: string | null; bannerUrl: string | null }> = [];

  for (const row of rows) {
    const cleanKey = sanitizeGameKey(row.game_key);
    const steamId = row.steam_id && Number(row.steam_id) > 0 ? Number(row.steam_id) : null;

    let nextCover = row.cover_url || null;
    let nextBanner = row.banner_url || null;
    let changed = false;

    const posterCheck = await checkSingleImageUrl(nextCover, env);
    if (posterCheck.status !== 'ok') {
      const candidatePoster =
        posterCheck.status === 'external_ok' && nextCover
          ? nextCover
          : steamId
            ? `${STEAM_STATIC_CDN_BASE}/${steamId}/library_600x900_2x.jpg`
            : null;
      if (candidatePoster) {
        let ingested = await ingestExternalImage(candidatePoster, `cover_${cleanKey}_poster`, env, 'cover_poster');
        if (!ingested && steamId) {
          ingested = await ingestExternalImage(
            `${STEAM_STATIC_CDN_BASE}/${steamId}/library_600x900.jpg`,
            `cover_${cleanKey}_poster`,
            env,
            'cover_poster'
          );
        }
        if (ingested) {
          nextCover = ingested;
          changed = true;
        }
      }
    }

    const bannerCheck = await checkSingleImageUrl(nextBanner, env);
    if (bannerCheck.status !== 'ok') {
      const candidateBanner =
        bannerCheck.status === 'external_ok' && nextBanner
          ? nextBanner
          : steamId
            ? `${STEAM_STATIC_CDN_BASE}/${steamId}/library_hero.jpg`
            : null;
      if (candidateBanner) {
        let ingested = await ingestExternalImage(candidateBanner, `cover_${cleanKey}_banner`, env, 'cover_banner');
        if (!ingested && steamId) {
          ingested = await ingestExternalImage(
            `${STEAM_STATIC_CDN_BASE}/${steamId}/header.jpg`,
            `cover_${cleanKey}_banner`,
            env,
            'cover_banner'
          );
        }
        if (ingested) {
          nextBanner = ingested;
          changed = true;
        }
      }
    }

    if (changed) {
      await env.DB.prepare(
        "UPDATE game_covers SET cover_url = ?, banner_url = ?, updated_at = datetime('now') WHERE game_key = ?"
      ).bind(nextCover, nextBanner, cleanKey).run();
      await propagateCoverAcrossTables(env, {
        gameKey: cleanKey,
        title: row.title,
        steamId,
        coverUrl: nextCover,
        bannerUrl: nextBanner,
      });
      fixed++;
      details.push({ gameKey: cleanKey, fixed: true, coverUrl: nextCover, bannerUrl: nextBanner });
    } else {
      failed++;
      details.push({ gameKey: cleanKey, fixed: false, coverUrl: nextCover, bannerUrl: nextBanner });
    }
  }

  return jsonResponse({
    success: true,
    processed: rows.length,
    fixed,
    failed,
    details,
  });
};

/**
 * POST /api/admin/covers/sync-all
 * Force-propagates master covers from game_covers to user_library, ratings,
 * community_picks, and community_votes across the server.
 */
export const handleAdminSyncAll: RouteHandler = async (request, env) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body: any = {};
  try {
    body = await request.json();
  } catch {}

  const singleKey = body?.gameKey ? sanitizeGameKey(String(body.gameKey)) : null;
  const rows = singleKey
    ? await env.DB.prepare('SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers WHERE game_key = ?')
        .bind(singleKey)
        .all<any>()
    : await env.DB.prepare('SELECT game_key, title, steam_id, cover_url, banner_url FROM game_covers').all<any>();

  const totals: CoverPropagationStats = {
    userLibraryUpdated: 0,
    ratingsUpdated: 0,
    picksUpdated: 0,
    votesUpdated: 0,
  };

  for (const row of rows.results || []) {
    const stats = await propagateCoverAcrossTables(env, {
      gameKey: row.game_key,
      title: row.title,
      steamId: row.steam_id,
      coverUrl: row.cover_url,
      bannerUrl: row.banner_url,
    });
    totals.userLibraryUpdated += stats.userLibraryUpdated;
    totals.ratingsUpdated += stats.ratingsUpdated;
    totals.picksUpdated += stats.picksUpdated;
    totals.votesUpdated += stats.votesUpdated;
  }

  return jsonResponse({
    success: true,
    gamesSynced: (rows.results || []).length,
    syncStats: totals,
  });
};

/**
 * DELETE /api/admin/covers/:gameKey
 * Deletes a game cover entry from the cloud catalog (admin only).
 */
export const handleAdminDeleteCover: RouteHandler = async (request, env, ctx) => {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const gameKeyParam = ctx.params?.gameKey;
  if (!gameKeyParam) {
    return errorResponse('gameKey parameter is required', 400);
  }
  const cleanKey = sanitizeGameKey(gameKeyParam);

  await env.DB.prepare('DELETE FROM game_covers WHERE game_key = ?').bind(cleanKey).run();

  return jsonResponse({
    success: true,
    gameKey: cleanKey,
  });
};
