import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  getGameById,
  getGames,
  getGameByTitle,
  createGame,
  updateGame,
  getDeletedGames,
  getDb,
  getSetting,
  setSetting,
  recalculatePlaytime,
} from './db.ts';
import { normalizeForMatch } from './media.ts';
import { autoEnrichAllGameCovers } from './covers.ts';
import { NON_GAME_TITLE_REGEX } from './tracker.ts';
import { getValidSessionToken, getAuthStatus, getCurrentSession, getCloudConfig, type FetchLike } from './auth.ts';
import type {
  CloudReview,
  CloudSessionItem,
  CommunityPick,
  Game,
  HardwareProfile,
  LeaderboardEntry,
  LibrarySyncOptions,
  LibrarySyncResponse,
  LibrarySyncResult,
  UserLibraryItem,
  AdminCoverItem,
  AdminCoversResponse,
  AdminUpdateCoverPayload,
  ReviewSyncResult,
} from '../shared/types.js';

function toUtcIso(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return new Date().toISOString();
  const trimmed = raw.trim();
  if (!trimmed) return new Date().toISOString();
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

function parseTimestampMs(raw?: string | null): number {
  if (!raw || typeof raw !== 'string') return NaN;
  const trimmed = raw.trim();
  if (!trimmed) return NaN;
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  return new Date(normalized).getTime();
}

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

/** Bounded bridge for the public community API; tokens stay in the main process. */
export async function communityRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!/^\/api\/community\//.test(path) || path.includes('..') || path.length > 1000 || !['GET','POST','PUT','DELETE'].includes(method)) {
    throw new Error('Invalid community request');
  }
  const response = await apiFetch(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, method !== 'GET');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Community request failed (${response.status})`);
  const reviewPath = /^\/api\/community\/games\/([^/]+)\/reviews$/.exec(path);
  if (reviewPath && (method === 'POST' || method === 'DELETE')) {
    const gameKey = decodeURIComponent(reviewPath[1]);
    const local = getGames().find(game => computeGameKey(game) === gameKey);
    if (local) {
      if (method === 'DELETE') updateGame(local.id, { user_rating: null });
      else {
        const review = body as { score: number; review: string };
        updateGame(local.id, { user_rating: review.score, notes: review.review });
      }
    }
  }
  return result as T;
}
export async function communityUploadImage(bytes: ArrayBuffer, mime: string): Promise<{ key: string }> {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(mime)) throw new Error('Invalid community image');
  const response = await apiFetch('/api/community/uploads', { method: 'POST', body: bytes, headers: { 'Content-Type': mime } }, true);
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Image upload failed'); return data;
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
  if (!getCurrentSession()) {
    return null;
  }
  try {
    const resp = await apiFetch(
      '/api/covers/cache',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      true
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
  if (!getCurrentSession()) {
    return null;
  }
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
      true
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
  updateGame(gameId, { user_rating: body.score, notes: body.review });
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
  if (resp.ok || resp.status === 404) {
    updateGame(gameId, { user_rating: null });
    return true;
  }
  return false;
}

let reviewSyncRun: Promise<ReviewSyncResult> | null = null;

/** Acknowledged signatures survive restarts; unsent local edits are retried. */
export async function syncLocalReviews(): Promise<ReviewSyncResult> {
  if (reviewSyncRun) {
    await reviewSyncRun;
    return syncLocalReviews();
  }
  reviewSyncRun = flushLocalReviews();
  try { return await reviewSyncRun; }
  finally { reviewSyncRun = null; }
}

async function flushLocalReviews(): Promise<ReviewSyncResult> {
  const session = getCurrentSession();
  if (!session?.user?.uid) return { state: 'signed_out', synced: 0, pending: 0 };
  const uid = session.user.uid;
  const db = getDb();
  const migrationKey = `review_scores_migrated:${uid}`;
  const migrationDone = getSetting(migrationKey) === '1';
  db.exec(`CREATE TABLE IF NOT EXISTS local_review_sync (
    uid TEXT NOT NULL, game_id INTEGER NOT NULL, signature TEXT NOT NULL,
    PRIMARY KEY(uid,game_id))`);
  const pending = getGames().filter(g => !NON_GAME_TITLE_REGEX.test(g.title)).map(game => {
    const stored = db.prepare('SELECT signature FROM local_review_sync WHERE uid=? AND game_id=?').get(uid, game.id) as { signature: string } | undefined;
    const score = game.user_rating != null && game.user_rating >= 1 && game.user_rating <= 10 ? game.user_rating : null;
    const data = score == null ? null : {
      gameKey: computeGameKey(game), title: game.title, coverUrl: game.cover_url || null,
      score, review: game.notes || '', dropped: game.status === 'dropped',
      playtimeMinutes: game.playtime_minutes || 0,
    };
    const signature = JSON.stringify(data);
    return { game, data, signature, changed: signature !== stored?.signature && (data != null || stored != null) };
  }).filter(item => item.changed);
  if (pending.length === 0 && migrationDone) {
    return { state: 'synced', synced: 0, pending: 0, migrated: 0 };
  }
  let synced = 0;
  let migrated = 0;
  const acknowledge = (item: typeof pending[number]) => {
    db.prepare('INSERT INTO local_review_sync(uid,game_id,signature) VALUES (?,?,?) ON CONFLICT(uid,game_id) DO UPDATE SET signature=excluded.signature')
      .run(uid, item.game.id, item.signature);
    synced++;
  };
  try {
    const rated = pending.filter(item => item.data != null);
    if (rated.length > 0 || !migrationDone) {
      for (let offset = 0; offset < Math.max(rated.length, 1); offset += 50) {
        const chunk = rated.slice(offset, offset + 50);
        const includeStoredScores = offset === 0 && !migrationDone;
        const result = await communityRequest<{ success: boolean; synced: number; migrated?: number }>('/api/community/me/reviews/sync', 'POST', {
          items: chunk.map(item => ({ ...item.data, updatedAt: new Date(item.game.updated_at.replace(' ', 'T')).toISOString() })),
          ...(includeStoredScores ? { includeStoredScores: true } : {}),
        });
        if (!result.success || result.synced < chunk.length) throw new Error('Server did not acknowledge all reviews');
        if (includeStoredScores) {
          setSetting(migrationKey, '1');
        }
        chunk.forEach(acknowledge);
        migrated += result.migrated || 0;
      }
    }
    for (const item of pending.filter(item => item.data == null)) {
      if (!await deleteMyReview(item.game.id)) throw new Error('Could not remove the cloud rating');
      acknowledge(item);
    }
    return { state: 'synced', synced, pending: 0, migrated };
  } catch (error) {
    console.warn('[reviews] Cloud sync pending:', error);
    return { state: 'pending', synced, pending: pending.length - synced, error: String((error as Error).message || error) };
  }
}

export async function updateGameAndSyncReview(id: number, data: Partial<Game>): Promise<Game> {
  // Renderer edits cannot mint app-recorded time; only internal sync carries it.
  data = { ...data };
  delete data.recorded_playtime_minutes;
  delete data.manual_playtime_minutes;
  const game = updateGame(id, data);
  if (!('user_rating' in data || 'notes' in data || 'status' in data)) return game;
  let reviewSync = await syncLocalReviews();
  if (reviewSync.state !== 'signed_out') {
    try {
      const response = await apiFetch('/api/library/sync', {
        method: 'POST', body: JSON.stringify({ items: [libraryItem(getGameById(id) || game)] }),
      }, true);
      if (!response.ok) throw new Error(`Library save failed (${response.status})`);
    } catch (error) {
      reviewSync = { ...reviewSync, state: 'pending', error: String((error as Error).message || error) };
    }
  }
  return { ...(getGameById(id) || game), reviewSync };
}

function libraryItem(g: Game): UserLibraryItem {
  const remoteUrl = (url?: string | null) => url && /^https?:\/\//.test(url) ? url : null;
  return {
    gameKey: computeGameKey(g), title: g.title,
    steamId: g.steam_id && g.steam_id > 0 ? g.steam_id : null,
    coverUrl: remoteUrl(g.cover_url), bannerUrl: remoteUrl(g.banner_url),
    status: g.status, playtimeMinutes: g.playtime_minutes || 0,
    recordedPlaytimeMinutes: g.recorded_playtime_minutes ?? g.playtime_minutes ?? 0,
    lastPlayed: g.last_played_at || null, completedAt: g.completed_at || null,
    userScore: g.user_rating ?? null, userNotes: g.notes || null,
    isDeleted: false, clientUpdatedAt: toUtcIso(g.updated_at),
  };
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

const SYNC_EPOCH_SETTING_KEY = 'library_sync_epoch';
const SYNC_HASH_SETTING_KEY = 'library_sync_hash';

let inFlightLibrarySync: Promise<LibrarySyncResult> | null = null;

export async function syncLibraryWithCloud(options?: LibrarySyncOptions): Promise<LibrarySyncResult> {
  const syncMode = options?.mode === 'overwrite' ? 'overwrite' : 'merge';
  if (syncMode !== 'overwrite' && inFlightLibrarySync) {
    return inFlightLibrarySync;
  }
  const run = runSyncLibraryWithCloud(options);
  if (syncMode !== 'overwrite') {
    inFlightLibrarySync = run;
  }
  try {
    return await run;
  } finally {
    if (inFlightLibrarySync === run) {
      inFlightLibrarySync = null;
    }
  }
}

async function runSyncLibraryWithCloud(options?: LibrarySyncOptions): Promise<LibrarySyncResult> {
  const db = getDb();
  const syncMode = options?.mode === 'overwrite' ? 'overwrite' : 'merge';
  const localSyncEpoch = Number(getSetting(SYNC_EPOCH_SETTING_KEY) || '0') || 0;

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
      recordedPlaytimeMinutes: g.recorded_playtime_minutes ?? g.playtime_minutes ?? 0,
      lastPlayed: g.last_played_at || null,
      completedAt: g.completed_at || null,
      userScore: g.user_rating != null ? g.user_rating : null,
      userNotes: g.notes || null,
      isDeleted: false,
      clientUpdatedAt: toUtcIso(g.updated_at),
    });
  }

  // Collect real play sessions (exclude 'manual' audit rows and active/zero-duration rows)
  const sessionsPayload: CloudSessionItem[] = [];
  const gameKeyById = new Map<number, string>();
  for (const g of localGames) {
    if (NON_GAME_TITLE_REGEX.test((g.title || '').trim())) continue;
    gameKeyById.set(g.id, computeGameKey(g));
  }
  try {
    const localSessions = db
      .prepare(`
        SELECT game_id, source, start_time, end_time, duration_minutes
        FROM sessions
        WHERE is_running = 0
          AND duration_minutes > 0
          AND COALESCE(source, '') != 'manual'
          AND start_time IS NOT NULL
        ORDER BY start_time DESC
        LIMIT 5000
      `)
      .all() as any[];
    for (const s of localSessions) {
      const gKey = gameKeyById.get(Number(s.game_id));
      if (!gKey) continue;
      sessionsPayload.push({
        gameKey: gKey,
        source: String(s.source || 'tracker'),
        startTime: String(s.start_time),
        endTime: s.end_time ? String(s.end_time) : null,
        durationMinutes: Math.max(0, Number(s.duration_minutes) || 0),
      });
    }
  } catch (err) {
    console.warn('Session export warning:', err);
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

  const sessionUid = getCurrentSession()?.user?.uid || '';
  const workerBase = getWorkerBaseUrl();
  const hashItems = items.map((it) => ({
    ...it,
    clientUpdatedAt: it.isDeleted ? '' : it.clientUpdatedAt,
  }));
  const payloadFingerprint = sessionUid
    ? crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            uid: sessionUid,
            workerBase,
            localSyncEpoch,
            items: hashItems,
            sessions: sessionsPayload,
          })
        )
        .digest('hex')
    : '';
  const skipPostUpload =
    syncMode !== 'overwrite' &&
    Boolean(payloadFingerprint) &&
    payloadFingerprint === (getSetting(SYNC_HASH_SETTING_KEY) || '');

  let result: LibrarySyncResponse;
  let pushedCount = 0;

  if (skipPostUpload) {
    result = await getCloudLibrary();
  } else {
    const resp = await apiFetch(
      '/api/library/sync',
      {
        method: 'POST',
        body: JSON.stringify({
          mode: syncMode,
          clientSyncEpoch: localSyncEpoch,
          items,
          sessions: sessionsPayload,
        }),
      },
      true
    );

    if (!resp.ok) {
      throw new Error(`Đồng bộ thư viện game thất bại: HTTP ${resp.status}`);
    }

    result = await resp.json();
    pushedCount = items.length;
  }

  const serverSyncEpoch = Number(result.syncEpoch) || 0;
  const isAuthoritativePull =
    Boolean(result.authoritativePull) ||
    (syncMode !== 'overwrite' && serverSyncEpoch > localSyncEpoch);

  let pulled = 0;
  let updated = 0;
  const matchedLocalGameIds = new Set<number>();

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
      const created = createGame({
        title: remote.title,
        status: remote.status,
        playtime_minutes: remote.playtimeMinutes,
        recorded_playtime_minutes: remote.recordedPlaytimeMinutes ?? remote.playtimeMinutes,
        cover_url: validRemoteCover,
        banner_url: validRemoteBanner,
        steam_id: remote.steamId || -1,
        user_rating: remote.userScore,
        notes: remote.userNotes,
        completed_at: remote.completedAt || null,
        media_folder: remote.title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Unknown_Game',
      });
      matchedLocalGameIds.add(created.id);
      pulled++;
    } else {
      matchedLocalGameIds.add(existing.id);
      // Game exists locally: reconcile status, playtime, covers
      const patch: Partial<Game> = {};
      let needsUpdate = false;
      const remoteMs = parseTimestampMs(remote.clientUpdatedAt);
      const localMs = parseTimestampMs(existing.updated_at);
      const remoteIsNewer = Number.isFinite(remoteMs) && Number.isFinite(localMs) && remoteMs > localMs;
      const localRecorded = existing.recorded_playtime_minutes ?? existing.playtime_minutes ?? 0;
      const remoteRecorded = Math.max(0, Math.min(remote.playtimeMinutes || 0,
        remote.recordedPlaytimeMinutes ?? localRecorded));

      if (isAuthoritativePull) {
        if (remote.status !== existing.status) {
          patch.status = remote.status;
          needsUpdate = true;
        }
        if ((remote.playtimeMinutes || 0) !== (existing.playtime_minutes || 0)) {
          patch.playtime_minutes = remote.playtimeMinutes || 0;
          patch.recorded_playtime_minutes = remoteRecorded;
          needsUpdate = true;
        }
        if (remoteRecorded !== localRecorded) {
          patch.recorded_playtime_minutes = remoteRecorded;
          needsUpdate = true;
        }
        if (validRemoteCover && validRemoteCover !== existing.cover_url) {
          patch.cover_url = validRemoteCover;
          needsUpdate = true;
        }
        if (validRemoteBanner && validRemoteBanner !== existing.banner_url) {
          patch.banner_url = validRemoteBanner;
          needsUpdate = true;
        }
        if ((remote.userScore ?? null) !== (existing.user_rating ?? null)) {
          patch.user_rating = remote.userScore ?? null;
          needsUpdate = true;
        }
        if ((remote.userNotes ?? null) !== (existing.notes ?? null)) {
          patch.notes = remote.userNotes ?? null;
          needsUpdate = true;
        }
        if (remote.steamId && remote.steamId > 0 && remote.steamId !== existing.steam_id) {
          patch.steam_id = remote.steamId;
          needsUpdate = true;
        }
        if ((remote.completedAt ?? null) !== (existing.completed_at ?? null)) {
          patch.completed_at = remote.completedAt ?? null;
          needsUpdate = true;
        }
      } else {
        // Completed status rule: if remote or local is completed, it stays completed!
        if (remote.status === 'completed' && existing.status !== 'completed') {
          patch.status = 'completed';
          needsUpdate = true;
        } else if (remote.status !== existing.status && remoteIsNewer) {
          patch.status = remote.status;
          needsUpdate = true;
        }

        // Recorded progress is monotonic. Manual time is a separate component
        // chosen by the latest edit, so removing manual hours survives sync.
        const mergedRecorded = Math.max(localRecorded, remoteRecorded);
        const localManual = Math.max(0, existing.playtime_minutes - localRecorded);
        const remoteManual = Math.max(0, remote.playtimeMinutes - remoteRecorded);
        const mergedTotal = remote.recordedPlaytimeMinutes === undefined
          ? Math.max(existing.playtime_minutes, remote.playtimeMinutes)
          : mergedRecorded + (remoteIsNewer ? remoteManual : localManual);
        if (mergedTotal !== existing.playtime_minutes || mergedRecorded !== localRecorded) {
          patch.playtime_minutes = mergedTotal;
          patch.recorded_playtime_minutes = mergedRecorded;
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
        if (remote.completedAt && remote.completedAt !== existing.completed_at) {
          if (!existing.completed_at || remoteIsNewer) {
            patch.completed_at = remote.completedAt;
            needsUpdate = true;
          }
        }
      }

      if (needsUpdate) {
        updateGame(existing.id, patch);
        updated++;
      }
    }
  }

  // In authoritative pull mode, remove stale local games that do not exist in Cloud snapshot
  if (isAuthoritativePull && result.games.length > 0) {
    try {
      const currentLocal = getGames();
      for (const g of currentLocal) {
        if (!matchedLocalGameIds.has(g.id)) {
          db.prepare('DELETE FROM games WHERE id = ?').run(g.id);
        }
      }
    } catch (err) {
      console.warn('Authoritative pull stale game cleanup warning:', err);
    }
  }

  // 2.5 Pull & merge remote play sessions (so monthly Timeline & playtime stay 100% synced across machines)
  if (Array.isArray(result.sessions) && (result.sessions.length > 0 || isAuthoritativePull)) {
    try {
      if (isAuthoritativePull) {
        db.prepare('DELETE FROM sessions').run();
        // Cloud intentionally excludes manual audit rows. Recreate the local
        // offset after replacing sessions so the next real session continues
        // counting with exactly the restored total/recorded split.
        db.prepare(`INSERT INTO sessions
          (game_id, start_time, end_time, duration_minutes, is_running, source)
          SELECT id, datetime('now', 'localtime'), datetime('now', 'localtime'),
            manual_playtime_minutes, 0, 'manual'
          FROM games WHERE manual_playtime_minutes > 0`).run();
      }
      const refreshedGames = getGames();
      const idByKey = new Map<string, number>();
      for (const g of refreshedGames) {
        idByKey.set(computeGameKey(g), g.id);
        if (g.steam_id && g.steam_id > 0) {
          idByKey.set(String(g.steam_id), g.id);
          idByKey.set(`s_${g.steam_id}`, g.id);
        }
        idByKey.set(`t_${normalizeForMatch(g.title)}`, g.id);
      }

      const existsStmt = db.prepare(
        'SELECT 1 FROM sessions WHERE game_id = ? AND source = ? AND start_time = ?'
      );
      const insertSessionStmt = db.prepare(`
        INSERT INTO sessions (game_id, start_time, end_time, duration_minutes, is_running, source)
        VALUES (?, ?, ?, ?, 0, ?)
      `);
      const touchedIds = new Set<number>();

      for (const rs of result.sessions) {
        if (!rs || rs.source === 'manual' || !rs.startTime || (rs.durationMinutes || 0) <= 0) continue;
        const localGameId = idByKey.get(rs.gameKey);
        if (!localGameId) continue;
        const source = rs.source || 'tracker';
        const found = existsStmt.get(localGameId, source, rs.startTime);
        if (!found) {
          insertSessionStmt.run(
            localGameId,
            rs.startTime,
            rs.endTime || rs.startTime,
            Math.max(1, Math.floor(rs.durationMinutes)),
            source
          );
          touchedIds.add(localGameId);
        }
      }

      if (touchedIds.size > 0 && !isAuthoritativePull) {
        recalculatePlaytime(db, [...touchedIds]);
      }
    } catch (err) {
      console.warn('Remote session merge warning:', err);
    }
  }

  // 3. Post-sync auto-enrichment: only needed if we pulled new games missing covers
  if (pulled > 0 && result.games.some((g) => !g.isDeleted && !g.coverUrl)) {
    try {
      await autoEnrichAllGameCovers(db);
    } catch (err) {
      console.warn('Post-sync autoEnrich warning:', err);
    }
  }

  await syncLocalReviews();

  if (serverSyncEpoch > 0) {
    setSetting(SYNC_EPOCH_SETTING_KEY, String(serverSyncEpoch));
  }
  if (!skipPostUpload && !isAuthoritativePull && pulled === 0 && updated === 0 && payloadFingerprint) {
    setSetting(SYNC_HASH_SETTING_KEY, payloadFingerprint);
  }

  return {
    pushed: pushedCount,
    pulled,
    updated,
    completedCount: result.stats.completed,
    totalCount: result.stats.total,
    timestamp: result.syncedAt,
    stats: result.stats,
    syncEpoch: serverSyncEpoch,
    authoritativePull: isAuthoritativePull,
  };
}
