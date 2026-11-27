export interface AdminUserInfo {
  uid: string;
  email: string;
  displayName?: string;
}

export interface AdminStats {
  totalCovers: number;
  missingCovers: number;
  externalCovers: number;
  cloudCovers: number;
  libraryGamesCount: number;
  reviewsCount: number;
  storedImagesCount: number;
}

export interface AdminCoverItem {
  game_key: string;
  title: string;
  steam_id?: number | null;
  cover_url?: string | null;
  banner_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PropagationStats {
  userLibraryUpdated: number;
  ratingsUpdated: number;
  picksUpdated: number;
  votesUpdated: number;
}

export interface HealthCheckImageStatus {
  status: 'ok' | 'broken' | 'missing' | 'external_ok';
  httpStatus?: number;
  reason?: string;
}

export interface HealthCheckItem {
  gameKey: string;
  title: string;
  overall: 'healthy' | 'broken' | 'missing' | 'external';
  poster: HealthCheckImageStatus;
  banner: HealthCheckImageStatus;
}

export type CoverFilter = 'all' | 'missing' | 'external' | 'cloud' | 'broken';

const TOKEN_STORAGE_KEY = 'gv_admin_session_token';
const API_BASE_STORAGE_KEY = 'gv_admin_api_base';

export function getApiBase(): string {
  const saved = localStorage.getItem(API_BASE_STORAGE_KEY);
  if (saved && saved.trim()) {
    return saved.trim().replace(/\/+$/, '');
  }
  return '';
}

export function setApiBase(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) {
    localStorage.removeItem(API_BASE_STORAGE_KEY);
  } else {
    localStorage.setItem(API_BASE_STORAGE_KEY, trimmed);
  }
}

export function consumeTokenFromUrlHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  if (!hash.includes('token=')) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('token');
  if (token && token.trim()) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, '', cleanUrl);
    return token.trim();
  }
  return null;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (!token) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } else {
    localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  }
}

export function qualifyImageUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('/api/images/')) {
    const base = getApiBase();
    return base ? `${base}${url}` : url;
  }
  return url;
}

async function apiRequest<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const base = getApiBase();
  const headers = new Headers(init.headers || {});
  if (auth) {
    const token = getStoredToken();
    if (!token) {
      throw new Error('Chưa đăng nhập Admin');
    }
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const resp = await fetch(`${base}${path}`, { ...init, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.error || `HTTP ${resp.status}`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  return data as T;
}

export async function getAdminConfig(): Promise<{ webGoogleClientId: string; hasSeparateWebClientId: boolean }> {
  return apiRequest('/api/admin/config', { method: 'GET' }, false);
}

export async function exchangeGoogleIdToken(idToken: string): Promise<{ token: string; expiresAt: number; user: AdminUserInfo }> {
  return apiRequest('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  }, false);
}

export async function getAdminMe(): Promise<{ user: AdminUserInfo; isAdmin: boolean; stats: AdminStats }> {
  return apiRequest('/api/admin/me', { method: 'GET' }, true);
}

export async function fetchAdminCovers(params: {
  query?: string;
  filter?: Exclude<CoverFilter, 'broken'>;
  limit?: number;
  offset?: number;
} = {}): Promise<{
  covers: AdminCoverItem[];
  total: number;
  limit: number;
  offset: number;
  stats: AdminStats;
}> {
  const q = new URLSearchParams();
  if (params.query) q.set('query', params.query);
  if (params.filter && params.filter !== 'all') q.set('filter', params.filter);
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.offset !== undefined) q.set('offset', String(params.offset));
  return apiRequest(`/api/admin/covers?${q.toString()}`, { method: 'GET' }, true);
}

export async function updateAdminCover(
  gameKey: string,
  payload: {
    title?: string;
    steamId?: number | null;
    coverUrl?: string | null;
    bannerUrl?: string | null;
    sourcePosterUrl?: string | null;
    sourceBannerUrl?: string | null;
  }
): Promise<{
  success: boolean;
  gameKey: string;
  cover: AdminCoverItem;
  syncStats?: PropagationStats;
}> {
  return apiRequest(`/api/admin/covers/${encodeURIComponent(gameKey)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }, true);
}

export async function uploadAdminCoverFile(
  gameKey: string,
  type: 'poster' | 'banner',
  file: File,
  meta?: { title?: string; steamId?: number | null }
): Promise<{
  success: boolean;
  gameKey: string;
  type: string;
  url: string;
  cover: AdminCoverItem;
  syncStats?: PropagationStats;
}> {
  const q = new URLSearchParams({ type });
  if (meta?.title) q.set('title', meta.title);
  if (meta?.steamId) q.set('steamId', String(meta.steamId));

  const buf = await file.arrayBuffer();
  return apiRequest(
    `/api/admin/covers/${encodeURIComponent(gameKey)}/upload?${q.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'image/jpeg',
        'X-Cover-Type': type,
      },
      body: buf,
    },
    true
  );
}

export async function deleteAdminCover(gameKey: string): Promise<{ success: boolean; gameKey: string }> {
  return apiRequest(`/api/admin/covers/${encodeURIComponent(gameKey)}`, { method: 'DELETE' }, true);
}

export async function discoverGamesFromDb(): Promise<{ success: boolean; discovered: number; totalCovers: number }> {
  return apiRequest('/api/admin/covers/discover', { method: 'POST', body: '{}' }, true);
}

export async function healthCheckCovers(params: {
  gameKeys?: string[];
  limit?: number;
  offset?: number;
} = {}): Promise<{ checked: number; results: HealthCheckItem[] }> {
  return apiRequest('/api/admin/covers/health-check', {
    method: 'POST',
    body: JSON.stringify(params),
  }, true);
}

export async function batchIngestCovers(params: {
  gameKeys?: string[];
  limit?: number;
} = {}): Promise<{
  success: boolean;
  processed: number;
  fixed: number;
  failed: number;
}> {
  return apiRequest('/api/admin/covers/batch-ingest', {
    method: 'POST',
    body: JSON.stringify(params),
  }, true);
}

export async function syncAllCovers(gameKey?: string): Promise<{
  success: boolean;
  gamesSynced: number;
  syncStats: PropagationStats;
}> {
  return apiRequest('/api/admin/covers/sync-all', {
    method: 'POST',
    body: JSON.stringify(gameKey ? { gameKey } : {}),
  }, true);
}

export interface IgdbCandidate {
  id: number;
  name: string;
  posterUrl: string | null;
  bannerUrl: string | null;
}

export async function searchIgdbCovers(query: string, steamId?: number | null): Promise<{
  configured: boolean;
  results: IgdbCandidate[];
  message?: string;
}> {
  return apiRequest('/api/admin/covers/igdb-search', {
    method: 'POST',
    body: JSON.stringify({ query, steamId }),
  }, true);
}

export interface AdminBugReportItem {
  id: number;
  uid: string;
  email: string;
  display_name: string;
  title: string;
  category: string;
  severity: string;
  description: string;
  app_version: string;
  platform: string;
  gpu_summary: string;
  log_length?: number;
  log_text?: string;
  status: 'open' | 'in_progress' | 'fixed' | 'wontfix';
  fixed_in_version: string;
  admin_note: string;
  created_at: string;
  updated_at: string;
}

export async function fetchAdminBugs(status: string = ''): Promise<{ bugs: AdminBugReportItem[] }> {
  const q = status ? `?status=${encodeURIComponent(status)}&limit=60` : '?limit=60';
  return apiRequest(`/api/admin/bugs${q}`, { method: 'GET' }, true);
}

export async function fetchAdminBugDetail(id: number): Promise<{ bug: AdminBugReportItem }> {
  return apiRequest(`/api/admin/bugs/${id}`, { method: 'GET' }, true);
}

export async function updateAdminBug(
  id: number,
  payload: { status: AdminBugReportItem['status']; fixed_in_version: string; admin_note: string }
): Promise<{ ok: boolean; bug: AdminBugReportItem }> {
  return apiRequest(`/api/admin/bugs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }, true);
}
