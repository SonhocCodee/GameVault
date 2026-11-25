import fs from 'node:fs';
import {
  getGameById,
  getGames,
  getGameByTitle,
  createGame,
  updateGame,
  getDeletedGames,
  getDb,
} from './db.ts';
import { normalizeForMatch } from './media.ts';
import { autoEnrichAllGameCovers } from './covers.ts';
import { NON_GAME_TITLE_REGEX } from './tracker.ts';
import { getValidSessionToken, getAuthStatus, getCurrentSession, getCloudConfig, type FetchLike } from './auth.ts';
import type {
  CloudReview,
  CommunityPick,
  Game,
  HardwareProfile,
  LeaderboardEntry,
  LibrarySyncResponse,
  LibrarySyncResult,
  UserLibraryItem,
  AdminCoverItem,
  AdminCoversResponse,
  AdminUpdateCoverPayload,
} from '../shared/types.js';

let cloudOverrides: { fetchImpl?: FetchLike; workerApiUrl?: string; projectId?: string; userDataDir?: string } = {};

/** Test/advanced hook: override the HTTP layer, worker API URL, and cache dir. */
export function configureCloudDb(
  options: { fetchImpl?: FetchLike; workerApiUrl?: string; projectId?: string; userDataDir?: string } = {}
): void {
  cloudOverrides = { ...cloudOverrides, ...options };
}

function getWorkerBaseUrl(): string {
  if (cloudOverrides.workerApiUrl) return cloudOverrides.workerApiUrl.replace(/\/+$/, '');
  if (cloudOverrides.projectId) return 'http://localhost'; // backward-compatibility with tests
  const config = getCloudConfig();
  if (config?.workerApiUrl) return config.workerApiUrl.replace(/\/+$/, '');
  return 'http://127.0.0.1:8787';
}

function defaultFetch(): FetchLike {
  const electron = require('electron');
  const netFetch = electron?.net?.fetch;
  if (typeof netFetch === 'function') {
    return netFetch.bind(electron.net);
  }
  return fetch;
}

async function fetchImpl(): Promise<FetchLike> {
  return cloudOverrides.fetchImpl || defaultFetch();
}

async function apiFetch(path: string, init: RequestInit = {}, requiresAuth = false): Promise<Response> {
  const baseUrl = getWorkerBaseUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  let token: string | null = null;
  try {
    token = await getValidSessionToken();
  } catch (err) {
    if (requiresAuth) throw err;
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else if (requiresAuth) {
    throw new Error('Chưa đăng nhập');
  }

  const doFetch = await fetchImpl();
  return doFetch(url, { ...init, headers });
}

export function computeGameKey(game: Game): string {
  if (game.steam_id && Number(game.steam_id) > 0) return String(Number(game.steam_id));
  return `t_${normalizeForMatch(game.title)}`;
}

export interface CloudCoverResult {
  found: boolean;
  gameKey: string;
  title?: string;
  steamId?: number | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  fromCache?: boolean;
}

export function qualifyCloudUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/api/images/')) {
    const baseUrl = getWorkerBaseUrl();
    return `${baseUrl}${url}`;
  }
  return url;
}

export async function getCloudGameCover(gameKey: string): Promise<CloudCoverResult | null> {
  try {
    const resp = await apiFetch(`/api/covers/${encodeURIComponent(gameKey)}`, { method: 'GET' }, false);
    if (resp.status === 404) return { found: false, gameKey };
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      found: Boolean(data.found),
      gameKey: data.gameKey || gameKey,
      title: data.title,
      steamId: data.steamId,
      coverUrl: qualifyCloudUrl(data.coverUrl),
      bannerUrl: qualifyCloudUrl(data.bannerUrl),
    };
  } catch {
    return null;
  }
}

export async function cacheCloudGameCover(payload: {
  gameKey: string;
  title: string;
  steamId?: number | null;
  sourcePosterUrl?: string | null;
  sourceBannerUrl?: string | null;
}): Promise<CloudCoverResult | null> {
  try {
    const resp = await apiFetch(
      '/api/covers/cache',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      false
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      found: Boolean(data.coverUrl || data.bannerUrl),
      gameKey: data.gameKey || payload.gameKey,
      title: data.title || payload.title,
      steamId: data.steamId ?? payload.steamId,
      coverUrl: qualifyCloudUrl(data.coverUrl),
      bannerUrl: qualifyCloudUrl(data.bannerUrl),
      fromCache: Boolean(data.fromCache),
    };
  } catch {
    return null;
  }
}

export async function uploadCloudGameCover(
  gameKey: string,
  type: 'poster' | 'banner',
  imageBuffer: Buffer | Uint8Array,
  mimeType: string,
  meta?: { title?: string; steamId?: number }
): Promise<string | null> {
  try {
    const q = new URLSearchParams({
      gameKey,
      type,
      title: meta?.title || '',
    });
    if (meta?.steamId) q.set('steamId', String(meta.steamId));
    const resp = await apiFetch(
      `/api/covers/upload?${q.toString()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'X-Game-Key': gameKey,
          'X-Cover-Type': type,
          'X-Game-Title': meta?.title || '',
        },
        body: imageBuffer as any,
      },
      false
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return qualifyCloudUrl(data.url);
  } catch {
    return null;
  }
}

export async function adminGetCloudCovers(params: {
  query?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<AdminCoversResponse> {
  const q = new URLSearchParams();
  if (params.query) q.set('query', params.query);
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.offset !== undefined) q.set('offset', String(params.offset));

  const resp = await apiFetch(`/api/admin/covers?${q.toString()}`, { method: 'GET' }, true);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Lỗi tải danh sách bìa: ${resp.status}`);
  }
  const data = await resp.json();
  return {
    covers: (data.covers || []).map((c: any) => ({
      ...c,
      cover_url: qualifyCloudUrl(c.cover_url),
      banner_url: qualifyCloudUrl(c.banner_url),
    })),
    total: data.total || 0,
    limit: data.limit || params.limit || 50,
    offset: data.offset || params.offset || 0,
  };
}

export async function adminUpdateCloudCover(
  gameKey: string,
  payload: AdminUpdateCoverPayload
): Promise<{ success: boolean; gameKey: string; cover?: AdminCoverItem }> {
  const resp = await apiFetch(
    `/api/admin/covers/${encodeURIComponent(gameKey)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    true
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Lỗi cập nhật bìa game: ${resp.status}`);
  }
  const data = await resp.json();
  if (data.cover) {
    data.cover.cover_url = qualifyCloudUrl(data.cover.cover_url);
    data.cover.banner_url = qualifyCloudUrl(data.cover.banner_url);
  }
  return data;
}

export async function adminDeleteCloudCover(gameKey: string): Promise<{ success: boolean; gameKey: string }> {
  const resp = await apiFetch(
    `/api/admin/covers/${encodeURIComponent(gameKey)}`,
    { method: 'DELETE' },
    true
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Lỗi xóa bìa game: ${resp.status}`);
  }
  return resp.json();
}

export async function adminUploadCloudCover(
  gameKey: string,
  type: 'poster' | 'banner',
  imageBuffer: Buffer | Uint8Array,
  mimeType: string,
  meta?: { title?: string; steamId?: number }
): Promise<{ success: boolean; url: string | null; cover?: AdminCoverItem }> {
  const q = new URLSearchParams({ type });
  if (meta?.title) q.set('title', meta.title);
  if (meta?.steamId) q.set('steamId', String(meta.steamId));

  const resp = await apiFetch(
    `/api/admin/covers/${encodeURIComponent(gameKey)}/upload?${q.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-Cover-Type': type,
      },
      body: imageBuffer as any,
    },
    true
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Lỗi tải ảnh bìa lên Cloud: ${resp.status}`);
  }
  const data = await resp.json();
  if (data.cover) {
    data.cover.cover_url = qualifyCloudUrl(data.cover.cover_url);
    data.cover.banner_url = qualifyCloudUrl(data.cover.banner_url);
  }
  return {
    success: Boolean(data.success),
    url: qualifyCloudUrl(data.url),
    cover: data.cover,
  };
}

export function computeGuMatch(
  myScores: Map<string, number>,
  theirScores: Map<string, number>,
  minCoRated = 3
): number | null {
  const shared: string[] = [];
  for (const key of myScores.keys()) {
    if (theirScores.has(key)) shared.push(key);
  }
  if (shared.length < minCoRated) return null;
  const xs = shared.map((k) => myScores.get(k)!);
  const ys = shared.map((k) => theirScores.get(k)!);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  const r = cov / Math.sqrt(varX * varY);
  return Math.round(((r + 1) / 2) * 100);
}

export async function getLeaderboard(options: { sortByGuMatch?: boolean } = {}): Promise<LeaderboardEntry[]> {
  const resp = await apiFetch('/api/leaderboard?limit=100&offset=0', { method: 'GET' }, false);
  if (!resp.ok) throw new Error(`Không tải được bảng xếp hạng: ${resp.status}`);
  const data = await resp.json();
  const entries: LeaderboardEntry[] = data.entries || [];
  if (options.sortByGuMatch) {
    entries.sort((a, b) => {
      const ga = a.guMatchScore ?? -1;
      const gb = b.guMatchScore ?? -1;
      if (ga !== gb) return gb - ga;
      return b.avgScore - a.avgScore;
    });
  }
  return entries;
}

export async function getGameReviews(gameKey: string): Promise<CloudReview[]> {
  const resp = await apiFetch(`/api/games/${encodeURIComponent(gameKey)}/reviews?limit=200`, { method: 'GET' });
  if (!resp.ok) throw new Error(`Không tải được review: ${resp.status}`);
  const data = await resp.json();
  return data.reviews || [];
}

export async function submitReview(
  gameId: number,
  payload: { score: number; review: string; dropped: boolean; dropReason?: string; fps?: number }
): Promise<CloudReview> {
  const game = getGameById(gameId);
  if (!game) throw new Error(`Game with id ${gameId} not found`);
  const gameKey = computeGameKey(game);

  const body = {
    gameTitle: game.title,
    coverUrl: game.cover_url || null,
    score: Math.max(1, Math.min(10, Number(payload.score) || 0)),
    review: String(payload.review || '').slice(0, 4000),
    dropped: Boolean(payload.dropped),
    dropReason: payload.dropped ? String(payload.dropReason || '').slice(0, 300) : null,
    playtimeMinutes: game.playtime_minutes || 0,
    fps: payload.fps && payload.fps > 0 ? Math.round(payload.fps) : null,
  };

  const resp = await apiFetch(
    `/api/games/${encodeURIComponent(gameKey)}/reviews`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    true
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Không đăng được review: ${resp.status} ${errText.slice(0, 200)}`);
  }
  return resp.json();
}

export async function deleteMyReview(gameId: number): Promise<boolean> {
  const game = getGameById(gameId);
  if (!game) return false;
  const gameKey = computeGameKey(game);
  const resp = await apiFetch(
    `/api/games/${encodeURIComponent(gameKey)}/reviews`,
    {
      method: 'DELETE',
    },
    true
  );
  return resp.ok || resp.status === 404;
}

export async function getCurrentPick(): Promise<CommunityPick | null> {
  const resp = await apiFetch('/api/picks/current', { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Không tải được pick tháng này: ${resp.status}`);
  const data = await resp.json();
  if (!data?.gameKey && Object.keys(data?.votes || {}).length === 0) return null;
  return data;
}

export async function votePick(game: Game): Promise<CommunityPick> {
  const gameKey = computeGameKey(game);
  const resp = await apiFetch(
    '/api/picks/vote',
    {
      method: 'POST',
      body: JSON.stringify({
        gameKey,
        gameTitle: game.title,
        coverUrl: game.cover_url || null,
      }),
    },
    true
  );
  if (!resp.ok) throw new Error(`Không vote được: ${resp.status}`);
  return resp.json();
}

export async function unvotePick(): Promise<CommunityPick> {
  const resp = await apiFetch('/api/picks/vote', { method: 'DELETE' }, true);
  if (!resp.ok) throw new Error(`Không bỏ vote được: ${resp.status}`);
  return resp.json();
}

export async function setMyHardwareProfile(profile: HardwareProfile): Promise<HardwareProfile> {
  const clean: HardwareProfile = {
    gpu: String(profile.gpu || '').slice(0, 80).trim(),
    cpu: String(profile.cpu || '').slice(0, 80).trim(),
    ramGb: Math.max(0, Math.min(512, Math.round(Number(profile.ramGb) || 0))),
  };
  const resp = await apiFetch(
    '/api/users/me/hardware',
    {
      method: 'PUT',
      body: JSON.stringify(clean),
    },
    true
  );
  if (!resp.ok) throw new Error(`Không lưu được cấu hình máy: ${resp.status}`);
  return resp.json();
}

export async function getMyHardwareProfile(): Promise<HardwareProfile | null> {
  const status = getAuthStatus();
  if (!status.loggedIn || !status.profile?.uid) return null;
  const resp = await apiFetch(`/api/users/${encodeURIComponent(status.profile.uid)}`, { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) return null;
  const user = await resp.json();
  if (!user.gpu && !user.cpu && !user.ramGb) return null;
  return { gpu: user.gpu || '', cpu: user.cpu || '', ramGb: Number(user.ramGb) || 0 };
}

export async function getUserDoc(uid: string): Promise<Record<string, any> | null> {
  const resp = await apiFetch(`/api/users/${encodeURIComponent(uid)}`, { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Không đọc được profile: ${resp.status}`);
  const user = await resp.json();
  return {
    ...user,
    hw: { gpu: user.gpu || '', cpu: user.cpu || '', ramGb: Number(user.ramGb) || 0 },
  };
}

export async function getCloudLibrary(): Promise<LibrarySyncResponse> {
  const resp = await apiFetch('/api/library', { method: 'GET' }, true);
  if (!resp.ok) {
    throw new Error(`Lấy danh sách thư viện từ cloud thất bại: HTTP ${resp.status}`);
  }
  const data: LibrarySyncResponse = await resp.json();
  data.games = (data.games || []).map((g) => ({
    ...g,
    coverUrl: qualifyCloudUrl(g.coverUrl),
    bannerUrl: qualifyCloudUrl(g.bannerUrl),
  }));
  return data;
}

export async function syncLibraryWithCloud(): Promise<LibrarySyncResult> {
  const db = getDb();

  // 1. Sanitize local paths in DB (reset local/non-HTTP paths to NULL so canonical web covers are enriched)
  try {
    const allGames = db.prepare('SELECT id, cover_url, banner_url FROM games').all() as any[];
    for (const g of allGames) {
      let changed = false;
      let newCover = g.cover_url;
      let newBanner = g.banner_url;
      if (g.cover_url && !g.cover_url.startsWith('http://') && !g.cover_url.startsWith('https://')) {
        newCover = null;
        changed = true;
      }
      if (g.banner_url && !g.banner_url.startsWith('http://') && !g.banner_url.startsWith('https://')) {
        newBanner = null;
        changed = true;
      }
      if (changed) {
        db.prepare("UPDATE games SET cover_url = ?, banner_url = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(newCover, newBanner, g.id);
      }
    }
  } catch (err) {
    console.warn('Pre-sync local path sanitization warning:', err);
  }

  // 2. Pre-sync auto-enrichment: resolve covers for games lacking artwork before upload
  try {
    await autoEnrichAllGameCovers(db);
  } catch (err) {
    console.warn('Pre-sync autoEnrich warning:', err);
  }

  const localGames = getGames();
  const deleted = getDeletedGames();

  const items: UserLibraryItem[] = [];

  for (const g of localGames) {
    if (NON_GAME_TITLE_REGEX.test((g.title || '').trim())) continue;
    // Only upload valid HTTP/HTTPS URLs to the cloud. Never upload local machine file paths!
    const isCoverHttp = g.cover_url && (g.cover_url.startsWith('http://') || g.cover_url.startsWith('https://'));
    const isBannerHttp = g.banner_url && (g.banner_url.startsWith('http://') || g.banner_url.startsWith('https://'));

    items.push({
      gameKey: computeGameKey(g),
      title: g.title,
      steamId: g.steam_id && g.steam_id > 0 ? g.steam_id : null,
      coverUrl: isCoverHttp ? g.cover_url : null,
      bannerUrl: isBannerHttp ? g.banner_url : null,
      status: g.status,
      playtimeMinutes: g.playtime_minutes || 0,
      lastPlayed: g.last_played_at || null,
      userScore: g.user_rating != null ? g.user_rating : null,
      userNotes: g.notes || null,
      isDeleted: false,
      clientUpdatedAt: g.updated_at || new Date().toISOString(),
    });
  }

  const deletedTitles = new Set<string>();
  const deletedKeys = new Set<string>();
  const deletedSteamIds = new Set<number>();

  for (const d of deleted) {
    if (d.title) {
      const normT = d.title.toLowerCase().trim();
      deletedTitles.add(normT);
      const titleKey = `t_${normalizeForMatch(d.title)}`;
      deletedKeys.add(titleKey);

      items.push({
        gameKey: titleKey,
        title: d.title,
        status: 'backlog',
        playtimeMinutes: 0,
        isDeleted: true,
        clientUpdatedAt: d.deleted_at || new Date().toISOString(),
      });
    }

    if (d.steam_id && d.steam_id > 0) {
      const steamKey = String(d.steam_id);
      deletedSteamIds.add(d.steam_id);
      deletedKeys.add(steamKey);
      deletedKeys.add(`s_${d.steam_id}`);
      items.push({
        gameKey: steamKey,
        title: d.title,
        steamId: d.steam_id,
        status: 'backlog',
        playtimeMinutes: 0,
        isDeleted: true,
        clientUpdatedAt: d.deleted_at || new Date().toISOString(),
      });
    }

    if (d.game_key && !deletedKeys.has(d.game_key)) {
      deletedKeys.add(d.game_key);
      items.push({
        gameKey: d.game_key,
        title: d.title,
        status: 'backlog',
        playtimeMinutes: 0,
        isDeleted: true,
        clientUpdatedAt: d.deleted_at || new Date().toISOString(),
      });
    }
  }

  const resp = await apiFetch(
    '/api/library/sync',
    {
      method: 'POST',
      body: JSON.stringify({ items }),
    },
    true
  );

  if (!resp.ok) {
    throw new Error(`Đồng bộ thư viện game thất bại: HTTP ${resp.status}`);
  }

  const result: LibrarySyncResponse = await resp.json();

  let pulled = 0;
  let updated = 0;

  for (const remote of result.games) {
    if (remote.isDeleted) continue;
    if (NON_GAME_TITLE_REGEX.test((remote.title || '').trim())) continue;

    const rTitleNorm = (remote.title || '').toLowerCase().trim();
    const rKey = remote.gameKey || (remote.steamId ? `s_${remote.steamId}` : `t_${normalizeForMatch(remote.title)}`);
    const isLocallyDeleted =
      deletedTitles.has(rTitleNorm) ||
      deletedKeys.has(rKey) ||
      (remote.steamId != null && remote.steamId > 0 && deletedSteamIds.has(remote.steamId));

    if (isLocallyDeleted) {
      // User explicitly deleted this game locally! NEVER pull or recreate it!
      const row = remote.steamId && remote.steamId > 0
        ? (db.prepare('SELECT id FROM games WHERE steam_id = ?').get(remote.steamId) as any)
        : (getGameByTitle(remote.title));
      if (row) {
        db.prepare('DELETE FROM games WHERE id = ?').run(row.id);
      }
      continue;
    }

    // Validate remote cover/banner: qualify relative /api/images/... paths first
    const qualifiedRemoteCover = qualifyCloudUrl(remote.coverUrl);
    const isRemoteCoverValid = qualifiedRemoteCover && (
      qualifiedRemoteCover.startsWith('http://') ||
      qualifiedRemoteCover.startsWith('https://')
    );
    const validRemoteCover = isRemoteCoverValid ? qualifiedRemoteCover : null;

    const qualifiedRemoteBanner = qualifyCloudUrl(remote.bannerUrl);
    const isRemoteBannerValid = qualifiedRemoteBanner && (
      qualifiedRemoteBanner.startsWith('http://') ||
      qualifiedRemoteBanner.startsWith('https://')
    );
    const validRemoteBanner = isRemoteBannerValid ? qualifiedRemoteBanner : null;

    // Check if game exists locally by steam_id or title
    let existing: Game | null = null;
    if (remote.steamId && remote.steamId > 0) {
      const row = db.prepare('SELECT * FROM games WHERE steam_id = ?').get(remote.steamId) as any;
      if (row) existing = row;
    }
    if (!existing) {
      existing = getGameByTitle(remote.title);
    }

    if (!existing) {
      // Game exists on cloud (from another machine) but not locally
      createGame({
        title: remote.title,
        status: remote.status,
        playtime_minutes: remote.playtimeMinutes,
        cover_url: validRemoteCover,
        banner_url: validRemoteBanner,
        steam_id: remote.steamId || -1,
        user_rating: remote.userScore,
        notes: remote.userNotes,
        last_played_at: remote.lastPlayed,
        media_folder: remote.title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Unknown_Game',
      });
      pulled++;
    } else {
      // Game exists locally: reconcile status, playtime, covers
      const patch: Partial<Game> = {};
      let needsUpdate = false;

      // Completed status rule: if remote or local is completed, it stays completed!
      if (remote.status === 'completed' && existing.status !== 'completed') {
        patch.status = 'completed';
        needsUpdate = true;
      } else if (remote.status !== existing.status && remote.clientUpdatedAt && existing.updated_at) {
        if (new Date(remote.clientUpdatedAt) > new Date(existing.updated_at)) {
          patch.status = remote.status;
          needsUpdate = true;
        }
      }

      // Playtime rule: highest playtime wins
      if (remote.playtimeMinutes > (existing.playtime_minutes || 0)) {
        patch.playtime_minutes = remote.playtimeMinutes;
        needsUpdate = true;
      }

      // Covers & metadata enrichment from cloud:
      // Master catalog (game_covers) or permanent /api/images/ URLs override stale/broken local covers
      const hasMasterCover = Boolean((remote as any).masterCoverUpdatedAt);
      const isCloudHostedCover = Boolean(validRemoteCover && validRemoteCover.includes('/api/images/'));
      if (
        validRemoteCover &&
        validRemoteCover !== existing.cover_url &&
        (!existing.cover_url || hasMasterCover || isCloudHostedCover)
      ) {
        patch.cover_url = validRemoteCover;
        needsUpdate = true;
      }
      const isCloudHostedBanner = Boolean(validRemoteBanner && validRemoteBanner.includes('/api/images/'));
      if (
        validRemoteBanner &&
        validRemoteBanner !== existing.banner_url &&
        (!existing.banner_url || hasMasterCover || isCloudHostedBanner)
      ) {
        patch.banner_url = validRemoteBanner;
        needsUpdate = true;
      }
      if (existing.user_rating == null && remote.userScore != null) {
        patch.user_rating = remote.userScore;
        needsUpdate = true;
      }
      if (!existing.notes && remote.userNotes) {
        patch.notes = remote.userNotes;
        needsUpdate = true;
      }
      if ((!existing.steam_id || existing.steam_id <= 0) && remote.steamId && remote.steamId > 0) {
        patch.steam_id = remote.steamId;
        needsUpdate = true;
      }

      if (needsUpdate) {
        updateGame(existing.id, patch);
        updated++;
      }
    }
  }

  // 3. Post-sync auto-enrichment: resolve covers for any games that are still missing art
  try {
    await autoEnrichAllGameCovers(db);
  } catch (err) {
    console.warn('Post-sync autoEnrich warning:', err);
  }

  return {
    pushed: items.length,
    pulled,
    updated,
    completedCount: result.stats.completed,
    totalCount: result.stats.total,
    timestamp: result.syncedAt,
    stats: result.stats,
  };
}
