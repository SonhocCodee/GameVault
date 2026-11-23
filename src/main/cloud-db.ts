import path from 'node:path';
import fs from 'node:fs';
import { getGameById } from './db.ts';
import { normalizeForMatch } from './media.ts';
import { getValidFirebaseToken, getAuthStatus, getCurrentSession, getCloudConfig, type FetchLike } from './auth.ts';
import type {
  CloudReview,
  CommunityPick,
  Game,
  HardwareProfile,
  LeaderboardEntry,
} from '../shared/types.js';

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects';
const RATINGS_LIMIT = 2000;
const LEADERBOARD_CACHE_FILE = 'community-cache.json';
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

function defaultFetch(): FetchLike {
  const electron = require('electron');
  const netFetch = electron?.net?.fetch;
  if (typeof netFetch === 'function') {
    return netFetch.bind(electron.net);
  }
  return fetch;
}

function getConfig(): { projectId: string } {
  if (cloudOverrides.projectId) {
    return { projectId: cloudOverrides.projectId };
  }
  const config = getCloudConfig();
  if (config?.firebaseProjectId) {
    return { projectId: config.firebaseProjectId };
  }
  throw new Error('Chưa cấu hình cloud-config.json (firebaseProjectId). Xem SETUP.md.');
}

let cloudOverrides: { fetchImpl?: FetchLike; projectId?: string; userDataDir?: string } = {};

/** Test/advanced hook: override the HTTP layer, project id and cache dir. */
export function configureCloudDb(
  options: { fetchImpl?: FetchLike; projectId?: string; userDataDir?: string } = {}
): void {
  cloudOverrides = { ...cloudOverrides, ...options };
}

function getUserDataDir(): string {
  if (cloudOverrides.userDataDir) return cloudOverrides.userDataDir;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // tests
  }
  return process.cwd();
}

async function fetchImpl(): Promise<FetchLike> {
  return cloudOverrides.fetchImpl || defaultFetch();
}

async function firestoreFetch(url: string, init: any): Promise<any> {
  const token = await getValidFirebaseToken();
  const doFetch = await fetchImpl();
  const resp = await doFetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  return resp;
}

// ==========================================
// Firestore value conversion
// ==========================================

type FirestoreFields = Record<string, any>;

function toFirestoreValue(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  // nested map
  const fields: FirestoreFields = {};
  for (const [k, v] of Object.entries(value)) {
    fields[k] = toFirestoreValue(v);
  }
  return { mapValue: { fields } };
}

function fromFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in value) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value.mapValue?.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function toFirestoreFields(obj: Record<string, any>): FirestoreFields {
  const fields: FirestoreFields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function fromFirestoreFields(fields: FirestoreFields): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

function docUrl(collection: string, docId: string): string {
  const { projectId } = getConfig();
  return `${FIRESTORE_BASE}/${projectId}/databases/(default)/documents/${collection}/${docId}`;
}

function collectionUrl(collection: string): string {
  const { projectId } = getConfig();
  return `${FIRESTORE_BASE}/${projectId}/databases/(default)/documents/${collection}`;
}

function runQueryUrl(): string {
  const { projectId } = getConfig();
  return `${FIRESTORE_BASE}/${projectId}/databases/(default)/documents:runQuery`;
}

// ==========================================
// Game identity (cloud key)
// ==========================================

/**
 * Stable cloud identity for a game: Steam AppID when known (the community's
 * canonical join key), else a normalized-title slug.
 */
export function computeGameKey(game: Game): string {
  if (game.steam_id && Number(game.steam_id) > 0) {
    return String(Number(game.steam_id));
  }
  return `t_${normalizeForMatch(game.title)}`;
}

// ==========================================
// Ratings / reviews
// ==========================================

function ratingDocId(uid: string, gameKey: string): string {
  return `${uid}_${gameKey}`;
}

function reviewFromDoc(name: string, fields: FirestoreFields): CloudReview {
  const data = fromFirestoreFields(fields);
  return {
    uid: String(data.uid || ''),
    gameKey: String(data.gameKey || ''),
    gameTitle: String(data.gameTitle || ''),
    coverUrl: data.coverUrl ?? null,
    score: Number(data.score || 0),
    review: String(data.review || ''),
    dropped: Boolean(data.dropped),
    dropReason: data.dropReason ?? null,
    playtimeMinutes: Number(data.playtimeMinutes || 0),
    fps: data.fps ?? null,
    updatedAt: String(data.updatedAt || ''),
    authorName: String(data.authorName || ''),
    authorPhoto: String(data.authorPhoto || ''),
    authorHw: (data.authorHw as HardwareProfile) || null,
  };
}

export async function submitReview(
  gameId: number,
  payload: { score: number; review: string; dropped: boolean; dropReason?: string; fps?: number }
): Promise<CloudReview> {
  const session = getCurrentSession();
  if (!session) {
    throw new Error('Chưa đăng nhập');
  }
  const game = getGameById(gameId);
  if (!game) {
    throw new Error(`Game with id ${gameId} not found`);
  }
  const uid = session.firebase.localId;
  const gameKey = computeGameKey(game);

  const review: CloudReview = {
    uid,
    gameKey,
    gameTitle: game.title,
    coverUrl: game.cover_url || null,
    score: Math.max(1, Math.min(10, Number(payload.score) || 0)),
    review: String(payload.review || '').slice(0, 4000),
    dropped: Boolean(payload.dropped),
    dropReason: payload.dropped ? String(payload.dropReason || '').slice(0, 300) : null,
    playtimeMinutes: game.playtime_minutes || 0,
    fps: payload.fps && payload.fps > 0 ? Math.round(payload.fps) : null,
    updatedAt: new Date().toISOString(),
    authorName: session.firebase.displayName || session.firebase.email,
    authorPhoto: session.firebase.photoUrl,
    authorHw: null,
  };

  // Embed the reviewer's hardware profile so "máy tui chạy nổi k?" works
  // without extra reads
  try {
    const me = await getUserDoc(uid);
    review.authorHw = (me?.hw as HardwareProfile) || null;
  } catch {
    // profile optional
  }

  const doFetch = await fetchImpl();
  const resp = await doFetch(docUrl('ratings', ratingDocId(uid, gameKey)), {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFirestoreFields(review as any) }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Không đăng được review: ${resp.status} ${errText.slice(0, 200)}`);
  }
  invalidateLeaderboardCache();
  return review;
}

export async function deleteMyReview(gameId: number): Promise<boolean> {
  const session = getCurrentSession();
  if (!session) {
    throw new Error('Chưa đăng nhập');
  }
  const game = getGameById(gameId);
  if (!game) {
    return false;
  }
  const doFetch = await fetchImpl();
  const resp = await doFetch(docUrl('ratings', ratingDocId(session.firebase.localId, computeGameKey(game))), {
    method: 'DELETE',
  });
  invalidateLeaderboardCache();
  return resp.ok || resp.status === 404;
}

export async function getGameReviews(gameKey: string): Promise<CloudReview[]> {
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'ratings' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'gameKey' },
          op: 'EQUAL',
          value: { stringValue: gameKey },
        },
      },
      orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }],
      limit: { value: 200 },
    },
  };
  const doFetch = await fetchImpl();
  const resp = await doFetch(runQueryUrl(), { method: 'POST', body: JSON.stringify(query) });
  if (!resp.ok) {
    throw new Error(`Không tải được review: ${resp.status}`);
  }
  const rows = await resp.json();
  return (rows || [])
    .filter((row: any) => row?.document)
    .map((row: any) => reviewFromDoc(row.document.name, row.document.fields || {}));
}

// ==========================================
// Users (hardware profile)
// ==========================================

export async function getUserDoc(uid: string): Promise<Record<string, any> | null> {
  const doFetch = await fetchImpl();
  const resp = await doFetch(docUrl('users', uid), { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`Không đọc được profile: ${resp.status}`);
  }
  const doc = await resp.json();
  return fromFirestoreFields(doc.fields || {});
}

export async function setMyHardwareProfile(profile: HardwareProfile): Promise<HardwareProfile> {
  const session = getCurrentSession();
  if (!session) {
    throw new Error('Chưa đăng nhập');
  }
  const uid = session.firebase.localId;
  const clean: HardwareProfile = {
    gpu: String(profile.gpu || '').slice(0, 80).trim(),
    cpu: String(profile.cpu || '').slice(0, 80).trim(),
    ramGb: Math.max(0, Math.min(512, Math.round(Number(profile.ramGb) || 0))),
  };

  // Upsert the user doc (public profile — reviews join against it)
  const existing = await getUserDoc(uid).catch(() => null);
  const userDoc = {
    uid,
    displayName: session.firebase.displayName || session.firebase.email,
    photoUrl: session.firebase.photoUrl,
    hw: clean,
    updatedAt: new Date().toISOString(),
    ...(existing?.createdAt ? {} : { createdAt: new Date().toISOString() }),
  };
  const doFetch = await fetchImpl();
  const resp = await doFetch(docUrl('users', uid), {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFirestoreFields(userDoc) }),
  });
  if (!resp.ok) {
    throw new Error(`Không lưu được cấu hình máy: ${resp.status}`);
  }
  invalidateLeaderboardCache();
  return clean;
}

export async function getMyHardwareProfile(): Promise<HardwareProfile | null> {
  const session = getCurrentSession();
  if (!session) return null;
  const doc = await getUserDoc(session.firebase.localId).catch(() => null);
  return (doc?.hw as HardwareProfile) || null;
}

// ==========================================
// Leaderboard (aggregation + taste-match)
// ==========================================

interface CacheBox {
  ts: number;
  ratings: any[];
  users: Record<string, any>;
}

let memoryCache: CacheBox | null = null;

function cacheFile(): string {
  return path.join(getUserDataDir(), LEADERBOARD_CACHE_FILE);
}

function invalidateLeaderboardCache(): void {
  memoryCache = null;
  try {
    fs.rmSync(cacheFile(), { force: true });
  } catch {
    // best effort
  }
}

async function fetchAllRatings(): Promise<{ ratings: Record<string, any>[]; users: Record<string, any> }> {
  if (memoryCache && Date.now() - memoryCache.ts < LEADERBOARD_CACHE_TTL_MS) {
    return { ratings: memoryCache.ratings, users: memoryCache.users };
  }
  try {
    const diskRaw = fs.readFileSync(cacheFile(), 'utf-8');
    const disk = JSON.parse(diskRaw);
    if (Date.now() - Number(disk?.ts || 0) < LEADERBOARD_CACHE_TTL_MS) {
      memoryCache = disk;
      return { ratings: disk.ratings, users: disk.users };
    }
  } catch {
    // no cache
  }

  const query = {
    structuredQuery: {
      from: [{ collectionId: 'ratings' }],
      limit: { value: RATINGS_LIMIT },
    },
  };
  const doFetch = await fetchImpl();
  const resp = await doFetch(runQueryUrl(), { method: 'POST', body: JSON.stringify(query) });
  if (!resp.ok) {
    throw new Error(`Không tải được bảng xếp hạng: ${resp.status}`);
  }
  const rows = await resp.json();
  const ratings = (rows || [])
    .filter((row: any) => row?.document)
    .map((row: any) => fromFirestoreFields(row.document.fields || {}));

  // Fetch user docs (hardware) — small community, one GET per reviewer
  const users: Record<string, any> = {};
  const uids: string[] = Array.from(new Set(ratings.map((r: any) => String(r.uid || '')).filter(Boolean)));
  await Promise.all(
    uids.slice(0, 100).map(async (uid: string) => {
      try {
        users[uid] = await getUserDoc(uid);
      } catch {
        // optional join
      }
    })
  );

  const box: CacheBox = { ts: Date.now(), ratings, users };
  memoryCache = box;
  try {
    const tmp = `${cacheFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(box), 'utf-8');
    fs.renameSync(tmp, cacheFile());
  } catch {
    // cache write best effort
  }
  return { ratings, users };
}

/**
 * Pearson correlation over co-rated games → 0..100 taste-match score.
 * Requires at least `minCoRated` shared games to be meaningful.
 */
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

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null; // zero variance → no signal
  const r = cov / Math.sqrt(varX * varY);
  return Math.round(((r + 1) / 2) * 100);
}

export async function getLeaderboard(options: { sortByGuMatch?: boolean } = {}): Promise<LeaderboardEntry[]> {
  const status = getAuthStatus();
  const myUid = status.profile?.uid || null;

  const { ratings, users } = await fetchAllRatings();

  // Group by gameKey
  const byGame = new Map<string, any[]>();
  for (const r of ratings) {
    const key = String(r.gameKey || '');
    if (!key) continue;
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key)!.push(r);
  }

  // My scores for taste-match
  const myScores = new Map<string, number>();
  if (myUid) {
    for (const r of ratings) {
      if (String(r.uid) === myUid && Number(r.score) > 0) {
        myScores.set(String(r.gameKey), Number(r.score));
      }
    }
  }

  const entries: LeaderboardEntry[] = [];
  for (const [gameKey, reviews] of byGame) {
    const scores = reviews.map((r) => Number(r.score) || 0).filter((s) => s > 0);
    if (scores.length === 0) continue;
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const droppedCount = reviews.filter((r) => Boolean(r.dropped)).length;
    const anyReview = reviews[0];

    let guMatchScore: number | null = null;
    if (myUid) {
      const otherScores = new Map<string, number>();
      for (const r of reviews) {
        if (String(r.uid) !== myUid && Number(r.score) > 0) {
          otherScores.set(String(r.gameKey), Number(r.score));
        }
      }
      // taste-match is per-reviewer: take the best matching reviewer for this game
      const byReviewer = new Map<string, Map<string, number>>();
      for (const r of ratings) {
        const uid = String(r.uid || '');
        if (uid === myUid || !Number(r.score)) continue;
        if (!byReviewer.has(uid)) byReviewer.set(uid, new Map());
        byReviewer.get(uid)!.set(String(r.gameKey), Number(r.score));
      }
      let best: number | null = null;
      for (const [, their] of byReviewer) {
        if (!their.has(gameKey)) continue;
        const score = computeGuMatch(myScores, their);
        if (score !== null && (best === null || score > best)) best = score;
      }
      guMatchScore = best;
    }

    entries.push({
      gameKey,
      gameTitle: String(anyReview.gameTitle || gameKey),
      coverUrl: anyReview.coverUrl ?? null,
      avgScore: Math.round(avgScore * 10) / 10,
      reviewCount: reviews.length,
      dropRate: scores.length > 0 ? Math.round((droppedCount / reviews.length) * 100) / 100 : 0,
      totalPlaytimeMinutes: reviews.reduce((acc, r) => acc + (Number(r.playtimeMinutes) || 0), 0),
      guMatchScore,
      myScore: myUid ? myScores.get(gameKey) ?? null : null,
    });
  }

  if (options.sortByGuMatch && myUid) {
    entries.sort((a, b) => {
      const ga = a.guMatchScore ?? -1;
      const gb = b.guMatchScore ?? -1;
      if (ga !== gb) return gb - ga;
      return b.avgScore - a.avgScore;
    });
  } else {
    entries.sort((a, b) => {
      if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
      return b.avgScore - a.avgScore;
    });
  }
  return entries;
}

// ==========================================
// Community pick (game tháng này)
// ==========================================

function currentMonthKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export async function getCurrentPick(): Promise<CommunityPick | null> {
  const doFetch = await fetchImpl();
  const resp = await doFetch(docUrl('picks', currentMonthKey()), { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`Không tải được pick tháng này: ${resp.status}`);
  }
  const doc = await resp.json();
  const data = fromFirestoreFields(doc.fields || {});
  return {
    month: String(data.month || currentMonthKey()),
    gameKey: String(data.gameKey || ''),
    gameTitle: String(data.gameTitle || ''),
    coverUrl: data.coverUrl ?? null,
    votes: (data.votes as Record<string, string>) || {},
    state: (data.state as CommunityPick['state']) || 'voting',
  };
}

/**
 * Votes for a game this month. The pick doc is created lazily on the first
 * vote; a vote stores `votes.{uid} = gameKey` so tallies need no extra reads.
 */
export async function votePick(game: Game): Promise<CommunityPick> {
  const session = getCurrentSession();
  if (!session) {
    throw new Error('Chưa đăng nhập');
  }
  const uid = session.firebase.localId;
  const gameKey = computeGameKey(game);
  const month = currentMonthKey();

  const pick: Record<string, any> = {
    month,
    gameKey,
    gameTitle: game.title,
    coverUrl: game.cover_url || null,
    votes: { [uid]: gameKey },
    state: 'voting',
    createdAt: new Date().toISOString(),
  };

  const doFetch = await fetchImpl();
  // First try a targeted field merge so concurrent voters never clobber each
  // other's vote (404 → the doc doesn't exist yet → create it wholesale)
  const mergeResp = await doFetch(`${docUrl('picks', month)}?updateMask.fieldPaths=votes.${uid}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        votes: toFirestoreValue({ [uid]: gameKey }),
      },
    }),
  });

  if (mergeResp.status === 404) {
    const createResp = await doFetch(docUrl('picks', month), {
      method: 'PATCH',
      body: JSON.stringify({ fields: toFirestoreFields(pick) }),
    });
    if (!createResp.ok) {
      throw new Error(`Không tạo được pick: ${createResp.status}`);
    }
    return {
      month,
      gameKey,
      gameTitle: game.title,
      coverUrl: game.cover_url || null,
      votes: { [uid]: gameKey },
      state: 'voting',
    };
  }
  if (!mergeResp.ok) {
    throw new Error(`Không vote được: ${mergeResp.status}`);
  }

  // Read back the merged doc for the UI
  const current = await getCurrentPick();
  return current || { month, gameKey, gameTitle: game.title, coverUrl: null, votes: { [uid]: gameKey }, state: 'voting' };
}

export async function unvotePick(): Promise<CommunityPick> {
  const session = getCurrentSession();
  if (!session) {
    throw new Error('Chưa đăng nhập');
  }
  const uid = session.firebase.localId;
  const doFetch = await fetchImpl();
  // Setting the field to null deletes it in Firestore
  const resp = await doFetch(`${docUrl('picks', currentMonthKey())}?updateMask.fieldPaths=votes.${uid}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: { votes: { [uid]: { nullValue: null } } },
    }),
  });
  if (!resp.ok) {
    throw new Error(`Không bỏ vote được: ${resp.status}`);
  }
  const current = await getCurrentPick();
  return current || { month: currentMonthKey(), gameKey: '', gameTitle: '', coverUrl: null, votes: {}, state: 'voting' };
}
