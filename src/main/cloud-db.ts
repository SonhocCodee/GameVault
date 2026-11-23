import { getGameById } from './db.ts';
import { normalizeForMatch } from './media.ts';
import { getValidSessionToken, getAuthStatus, getCurrentSession, getCloudConfig, type FetchLike } from './auth.ts';
import type {
  CloudReview,
  CommunityPick,
  Game,
  HardwareProfile,
  LeaderboardEntry,
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
