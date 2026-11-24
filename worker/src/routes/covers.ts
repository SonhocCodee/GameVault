import type { RouteHandler, Env, CoverCachePayload } from '../types.ts';
import { jsonResponse, errorResponse } from '../utils.ts';
import { saveImageToCloud, ALLOWED_CONTENT_TYPES } from './images.ts';
import { authenticate, isAdminUser } from '../auth.ts';

const STEAM_STATIC_CDN_BASE = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps';

/**
 * Normalizes gameKey: clean and sanitize key.
 */
function sanitizeGameKey(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
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
 * GET /api/admin/covers
 * Lists or searches cloud game covers with pagination for administrators.
 */
export const handleAdminGetCovers: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Authentication required', 401);
  }
  if (!isAdminUser(user, env)) {
    return errorResponse('Admin access required', 403);
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('query') || '').trim();
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.max(1, Math.min(limitParam, 100));
  const offsetParam = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Math.max(0, offsetParam);

  if (query) {
    const term = `%${query.toLowerCase()}%`;
    const countRow = await env.DB.prepare(
      'SELECT count(*) as total FROM game_covers WHERE lower(game_key) LIKE ? OR lower(title) LIKE ?'
    ).bind(term, term).first<any>();
    const total = countRow?.total || 0;

    const rows = await env.DB.prepare(
      'SELECT game_key, title, steam_id, cover_url, banner_url, created_at, updated_at FROM game_covers WHERE lower(game_key) LIKE ? OR lower(title) LIKE ? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ).bind(term, term, limit, offset).all();

    return jsonResponse({
      covers: rows.results || [],
      total,
      limit,
      offset,
    });
  }

  const countRow = await env.DB.prepare('SELECT count(*) as total FROM game_covers').first<any>();
  const total = countRow?.total || 0;

  const rows = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url, created_at, updated_at FROM game_covers ORDER BY updated_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();

  return jsonResponse({
    covers: rows.results || [],
    total,
    limit,
    offset,
  });
};

/**
 * PUT /api/admin/covers/:gameKey
 * Updates or overrides game covers in the cloud master catalog (admin only).
 */
export const handleAdminUpdateCover: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Authentication required', 401);
  }
  if (!isAdminUser(user, env)) {
    return errorResponse('Admin access required', 403);
  }

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

  let title = (body.title !== undefined ? String(body.title).trim() : (existing?.title || cleanKey));
  let steamId = body.steamId !== undefined ? (Number(body.steamId) > 0 ? Number(body.steamId) : null) : (existing?.steam_id || null);

  let coverUrl = existing?.cover_url || null;
  let bannerUrl = existing?.banner_url || null;

  // Process poster/cover URL update
  if (body.sourcePosterUrl) {
    const ingested = await ingestExternalImage(body.sourcePosterUrl, `cover_${cleanKey}_poster`, env, 'cover_poster');
    if (ingested) coverUrl = ingested;
  } else if (body.coverUrl !== undefined) {
    if (body.coverUrl && !body.coverUrl.startsWith('/api/images/')) {
      const ingested = await ingestExternalImage(body.coverUrl, `cover_${cleanKey}_poster`, env, 'cover_poster');
      coverUrl = ingested || body.coverUrl;
    } else {
      coverUrl = body.coverUrl;
    }
  }

  // Process banner URL update
  if (body.sourceBannerUrl) {
    const ingested = await ingestExternalImage(body.sourceBannerUrl, `cover_${cleanKey}_banner`, env, 'cover_banner');
    if (ingested) bannerUrl = ingested;
  } else if (body.bannerUrl !== undefined) {
    if (body.bannerUrl && !body.bannerUrl.startsWith('/api/images/')) {
      const ingested = await ingestExternalImage(body.bannerUrl, `cover_${cleanKey}_banner`, env, 'cover_banner');
      bannerUrl = ingested || body.bannerUrl;
    } else {
      bannerUrl = body.bannerUrl;
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

  const updated = await env.DB.prepare(
    'SELECT game_key, title, steam_id, cover_url, banner_url, created_at, updated_at FROM game_covers WHERE game_key = ?'
  ).bind(cleanKey).first<any>();

  return jsonResponse({
    success: true,
    gameKey: cleanKey,
    cover: updated,
  });
};

/**
 * DELETE /api/admin/covers/:gameKey
 * Deletes a game cover entry from the cloud catalog (admin only).
 */
export const handleAdminDeleteCover: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Authentication required', 401);
  }
  if (!isAdminUser(user, env)) {
    return errorResponse('Admin access required', 403);
  }

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
