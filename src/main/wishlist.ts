import { getDb, findMatchingGame, createGame } from './db.ts';
import { searchSteamApps, searchSteamCovers, type LiveResolveOptions } from './covers.ts';
import type { Game } from '../shared/types.ts';

// Steam CDN asset path that still serves NEW games (the legacy /steam/apps/
// path 404s for post-2023 appids — verified on 1903340 Clair Obscur)
const STEAM_HEADER_CDN_BASE = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps';
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 64;
const searchFetchIds = new WeakMap<NonNullable<LiveResolveOptions['fetchImpl']>, number>();
let nextSearchFetchId = 0;
const searchCache = new Map<string, {
  expiresAt: number;
  pending: Promise<WishlistSearchResult[]>;
}>();

export interface WishlistSearchResult {
  appId: number;
  name: string;
  /** 16:9 header capsule used as a preview thumbnail in the search dialog. */
  headerUrl: string;
}

export interface AddWishlistPayload {
  title: string;
  steamId?: number;
  /** 'backlog' (mặc định) = Chờ chơi (Wishlist); 'completed' = Đã phá đảo (chơi ở máy khác). */
  status?: 'backlog' | 'completed';
  /** Điểm cá nhân 1-10 (không bắt buộc — null = chưa chấm). */
  user_rating?: number | null;
  /** Review cá nhân (không bắt buộc). */
  notes?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Chờ chơi (Wishlist)',
  completed: 'Đã phá đảo',
};

/**
 * Searches the live Steam catalogue for the wishlist "add game" dialog.
 * This is the ONLY supported way to create a 'Chờ chơi' (backlog/wishlist)
 * game — a wishlist entry is created from a real store entry so it can
 * carry its cover & banner URLs right away.
 */
export async function searchWishlistGames(
  query: string,
  opts: LiveResolveOptions & { limit?: number } = {}
): Promise<WishlistSearchResult[]> {
  const clean = (query || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit!)) : 24;
  if (clean.length < 2 || limit === 0) return [];

  const fetchImpl = opts.fetchImpl || fetch;
  let fetchId = searchFetchIds.get(fetchImpl);
  if (fetchId === undefined) {
    fetchId = ++nextSearchFetchId;
    searchFetchIds.set(fetchImpl, fetchId);
  }
  const key = JSON.stringify([clean, limit, opts.cacheDir || '', fetchId]);
  const now = Date.now();
  for (const [cachedKey, cached] of searchCache) {
    if (cached.expiresAt <= now) searchCache.delete(cachedKey);
  }

  let entry = searchCache.get(key);
  if (entry) {
    // Refresh insertion order so the bounded cache evicts the least recently used query.
    searchCache.delete(key);
    searchCache.set(key, entry);
  } else {
    // Search only returns metadata/CDN URLs. Cover resolution and cloud publishing
    // remain in addWishlistGame, after the user explicitly confirms the add.
    const pending = searchSteamApps(clean, { ...opts, fetchImpl, limit }).then((results) =>
      results.map((r) => ({
        appId: r.appid,
        name: r.name,
        headerUrl: `${STEAM_HEADER_CDN_BASE}/${r.appid}/header.jpg`,
      }))
    );
    entry = { expiresAt: now + SEARCH_CACHE_TTL_MS, pending };
    searchCache.set(key, entry);
    while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
      searchCache.delete(searchCache.keys().next().value!);
    }
  }

  try {
    // Do not let one caller mutate results reused by another renderer request.
    return (await entry.pending).map((result) => ({ ...result }));
  } catch (err) {
    if (searchCache.get(key) === entry) searchCache.delete(key);
    throw err;
  }
}

/**
 * Adds a game from the external Steam catalogue into the library with
 * cover & banner resolved from the CDN. Two entry statuses:
 * - 'backlog'  → Chờ chơi (Wishlist): pure metadata, media folder only
 *                appears once the game actually runs and auto-promotes.
 * - 'completed' → Đã phá đảo: game played on another machine (no playtime
 *                history here); media folder is also NOT created at add
 *                time — it is created lazily when the folder is opened or
 *                the game actually runs.
 */
export async function addWishlistGame(
  payload: AddWishlistPayload,
  opts: LiveResolveOptions = {}
): Promise<Game> {
  const title = (payload?.title || '').trim();
  if (!title) {
    throw new Error('Game title is required');
  }

  const status = payload.status === 'completed' ? 'completed' : 'backlog';

  const steamId = typeof payload.steamId === 'number' && payload.steamId > 0 ? payload.steamId : undefined;

  const db = getDb();
  const existing = findMatchingGame({ title, steam_id: steamId });
  if (existing) {
    if (existing.status === status) {
      throw new Error(`"${title}" đã nằm trong thư viện (${STATUS_LABELS[status]})`);
    }
    throw new Error(
      `"${title}" đã có trong thư viện với trạng thái khác (${STATUS_LABELS[existing.status] || existing.status})`
    );
  }

  // Completed games may carry an optional rating/review; backlog entries do not.
  const rawRating = Number(payload.user_rating);
  const userRating =
    status === 'completed' &&
    payload.user_rating !== null &&
    payload.user_rating !== undefined &&
    Number.isFinite(rawRating) &&
    rawRating > 0 &&
    rawRating <= 10
      ? rawRating
      : null;
  const notes =
    status === 'completed' && typeof payload.notes === 'string' && payload.notes.trim()
      ? payload.notes.trim()
      : null;

  // Resolve cover art from the store entry (poster 2:3 + hero banner 16:9)
  let coverUrl: string | null = null;
  let bannerUrl: string | null = null;
  try {
    const covers = await searchSteamCovers(title, steamId, opts);
    coverUrl = covers.posterUrl || covers.poster || null;
    bannerUrl = covers.bannerUrl || covers.banner || null;
  } catch {
    // Offline / blocked — wishlist entry is still created, covers enrich later
  }

  const created = createGame({
    title,
    status,
    steam_id: steamId ?? -1,
    cover_url: coverUrl,
    banner_url: bannerUrl,
    media_folder: null,
    user_rating: userRating,
    notes,
    completed_at: null,
  });

  // Keep the detected AppID when the live search found one
  if (!steamId && coverUrl) {
    const appIdMatch = coverUrl.match(/steam\/apps\/(\d+)/) || coverUrl.match(/steamstatic\.com\/store_item_assets\/steam\/apps\/(\d+)/);
    if (appIdMatch) {
      try {
        db.prepare('UPDATE games SET steam_id = ? WHERE id = ?').run(Number(appIdMatch[1]), created.id);
        created.steam_id = Number(appIdMatch[1]);
      } catch {}
    }
  }

  return created;
}
