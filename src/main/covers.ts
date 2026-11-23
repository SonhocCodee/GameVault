import electronModule from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SteamCoversResult } from '../shared/types.ts';
import { updateGame } from './db.ts';
import { normalizeForMatch, resolveFolderAlias, levenshteinDistance } from './media.ts';
import { optimizeAndSaveCover } from './thumbnails.ts';

// In Electron runtime, electronModule has app, dialog. In test mode, fallback safely.
const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;
const app = electron.app || {
  getPath: (_name: string) => path.join(os.tmpdir(), 'gamevault_test_userdata'),
};
const dialog = electron.dialog || {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
};

export const STEAM_STATIC_CDN_BASE = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps';

/**
 * Curated AppID dictionary for instant, unblocked Steam cover lookup.
 */
export const CURATED_STEAM_APP_IDS: Record<string, number> = {
  // Cyberpunk
  'cyberpunk 2077': 1091500,
  'cyberpunk': 1091500,
  // Final Fantasy
  'final fantasy vii rebirth': 2909400,
  'ff7 rebirth': 2909400,
  'final fantasy vii remake': 1462040,
  'final fantasy vii remake intergrade': 1462040,
  'ff7 remake': 1462040,
  // Detroit
  'detroit become human': 1222140,
  'detroit: become human': 1222140,
  // Horizon
  'horizon forbidden west': 2420110,
  'horizon forbidden west complete edition': 2420110,
  'horizonforbiddenwest': 2420110,
  'horizon zero dawn': 1151640,
  // Witcher
  'the witcher 3: wild hunt': 292030,
  'the witcher 3': 292030,
  'witcher 3': 292030,
  // Wukong
  'black myth: wukong': 2358720,
  'black myth wukong': 2358720,
  // God of War
  'god of war': 1593500,
  'god of war ragnarok': 2322010,
  'god of war ragnarök': 2322010,
  'god of war raknarok': 2322010,
  // Dead Space / Death Stranding
  'dead space': 1693980,
  'dead space 2': 47780,
  'ds2': 3280350,
  'death stranding 2': 3280350,
  'death stranding 2: on the beach': 3280350,
  // Warhammer
  'warhammer 40000 space marine 2': 2183900,
  'warhammer 40,000: space marine 2': 2183900,
  'warhammer 40k': 2183900,
  // Callisto Protocol
  'the callisto protocol': 1544020,
  'callisto protocol': 1544020,
  // FromSoftware
  'elden ring': 1245620,
  'sekiro: shadows die twice': 814380,
  'sekiro': 814380,
  'dark souls iii': 374320,
  'dark souls 3': 374320,
  // Rockstar
  'red dead redemption 2': 1174180,
  'rdr2': 1174180,
  // Larian
  'baldur\'s gate 3': 1086940,
  'baldurs gate 3': 1086940,
  'bg3': 1086940,
  // PlayStation PC
  'ghost of tsushima': 2215430,
  'ghost of tsushima director\'s cut': 2215430,
  'marvel\'s spider-man remastered': 1817070,
  'spider-man remastered': 1817070,
  // Neowiz / Remedy
  'lies of p': 1627720,
  'control': 870780,
  'control ultimate edition': 870780,
  'control resonant': 3669870,
  // AMD Imported Games
  'crimson desert': 3321460,
  'crimsondersert': 3321460,
  'phantom blade zero': 4115450,
  'pbz': 4115450,
  'onimusha: the way of the sword': 2638890,
  'onimusha': 2638890,
  'mortal shell': 1110910,
  'mortal shell ii': 2584270,
  'mortal shell 2': 2584270,
  'mortal shell ii - open beta': 2584270,
  'gta5_enhanced': 3240220,
  'delta force client': 2507950,
  'grand theft auto v': 271590,
  'resident evil 2': 883710,
  'valheim': 892970,
  'middle-earth - shadow of war de': 356190,
  'shadow of war': 356190,
  'metro': 286690,
  'spacewar': 480,
  'dragon\'s dogma 2': 2054970,
  'wuchang: fallen feathers': 2277560,
  'project_plague': 2277560,
  'tbh: task bar hero': 3678970,
  'tbh task bar hero': 3678970,
  'bombanana! demo': 4747510,
  'how to fish': 4001890,
  'mimesis': 2827200,
  'wwz': 699130,
  'resident evil requiem': 3764200,
  're9': 3764200,
  'resident evil 9': 3764200,
};

export const NON_STEAM_COVERS: Record<string, { poster: string; banner: string }> = {
  'resident evil requiem': {
    poster: 'https://upload.wikimedia.org/wikipedia/en/1/15/Resident_Evil_Requiem_Cover_Art.jpg',
    banner: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3764200/library_hero.jpg'
  },
  're9': {
    poster: 'https://upload.wikimedia.org/wikipedia/en/1/15/Resident_Evil_Requiem_Cover_Art.jpg',
    banner: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3764200/library_hero.jpg'
  },
  'resident evil 9': {
    poster: 'https://upload.wikimedia.org/wikipedia/en/1/15/Resident_Evil_Requiem_Cover_Art.jpg',
    banner: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3764200/library_hero.jpg'
  },
  'liên minh huyền thoại': {
    poster: 'https://cdn1.epicgames.com/offer/24b9b5e323bc40eea252a10cdd3b2f10/EGS_LeagueofLegends_RiotGames_S2_1200x1600-7ae610f443b09eb23e803e670d8a57ec',
    banner: 'https://cdn1.epicgames.com/offer/24b9b5e323bc40eea252a10cdd3b2f10/EGS_LeagueofLegends_RiotGames_S1_2560x1440-804791e8432a63273eef2507efbc4e6e'
  },
  'league of legends': {
    poster: 'https://cdn1.epicgames.com/offer/24b9b5e323bc40eea252a10cdd3b2f10/EGS_LeagueofLegends_RiotGames_S2_1200x1600-7ae610f443b09eb23e803e670d8a57ec',
    banner: 'https://cdn1.epicgames.com/offer/24b9b5e323bc40eea252a10cdd3b2f10/EGS_LeagueofLegends_RiotGames_S1_2560x1440-804791e8432a63273eef2507efbc4e6e'
  },
  'valorant': {
    poster: 'https://cdn1.epicgames.com/offer/cbd5b3d313a54b1ca500e261a3407c58/EGS_VALORANT_RiotGames_S2_1200x1600-474be60580327f29a00a2ea94c7b5a86',
    banner: 'https://cdn1.epicgames.com/offer/cbd5b3d313a54b1ca500e261a3407c58/EGS_VALORANT_RiotGames_S1_2560x1440-025516f4cb4fb155dd5d96a60395780a'
  },
  'bloodborne': {
    poster: 'https://cdn2.steamgriddb.com/grid/6d9de8a97fb84537a236d95e8dfc4f70.png',
    banner: 'https://cdn2.steamgriddb.com/hero/6d9de8a97fb84537a236d95e8dfc4f70.png'
  },
  'roblox player': {
    poster: 'https://images.rbxcdn.com/f04473ef7c0c16999a0ff3c35f9919f2.png',
    banner: 'https://images.rbxcdn.com/1393661be4910e3d2319ef58df73a9eb.jpg'
  },
  'roblox player beta': {
    poster: 'https://images.rbxcdn.com/f04473ef7c0c16999a0ff3c35f9919f2.png',
    banner: 'https://images.rbxcdn.com/1393661be4910e3d2319ef58df73a9eb.jpg'
  },
  'the legend of zelda - breath of the wild': {
    poster: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.png',
    banner: 'https://images.igdb.com/igdb/image/upload/t_1080p/sc6t4c.jpg'
  },
  'crosshair': {
    poster: 'https://cdn1.epicgames.com/spt-assets/7fbf2f8a48b843d1a337836371cf7381/crosshair-v2-1f7x2.png',
    banner: 'https://cdn1.epicgames.com/spt-assets/7fbf2f8a48b843d1a337836371cf7381/crosshair-v2-1718z.png'
  }
};

/**
 * Builds direct Fastly CDN URLs for a given Steam AppID.
 */
export function buildSteamCdnUrls(appId: number): SteamCoversResult {
  const poster = `${STEAM_STATIC_CDN_BASE}/${appId}/library_600x900_2x.jpg`;
  const banner = `${STEAM_STATIC_CDN_BASE}/${appId}/library_hero.jpg`;
  return {
    posterUrl: poster,
    bannerUrl: banner,
    poster,
    banner,
  };
}

// ============================================================
// LIVE STEAM RESOLUTION (search + verify) — for games outside
// the curated dictionaries. All network calls are injectable
// via `fetchImpl` so tests run fully offline.
// ============================================================

const STEAM_SEARCH_URL = 'https://steamcommunity.com/actions/SearchApps/';
const STEAM_STORESEARCH_URL = 'https://store.steampowered.com/api/storesearch/';
const ISTORE_QUERY_URL = 'https://api.steampowered.com/IStoreQueryService/Query/v1/';
const STEAM_CLASSIC_CDN_BASE = 'https://shared.fastly.steamstatic.com/steam/apps';
const APPID_CACHE_FILE = 'steam-appid-cache.json';
const APP_CATALOG_FILE = 'steam-catalog-cache.json';
const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PROVIDER_RETRY_MS = 24 * 60 * 60 * 1000; // skip a failing provider for 24h
const APP_CATALOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CATALOG_TIMEOUT_MS = 60000; // full-catalog download is ~20MB
// Full Steam game catalog (appid + name), updated daily — community mirror
// of ISteamApps/GetAppList, served over global CDNs that stay reachable
// where steamcommunity.com / store.steampowered.com are ISP-blocked.
const APP_CATALOG_URLS = [
  'https://cdn.jsdelivr.net/gh/jsnli/steamappidlist@master/data/games_appid.json',
  'https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/games_appid.json',
];
const CHEAPSHARK_GAMES_URL = 'https://www.cheapshark.com/api/1.0/games';
const CHEAPSHARK_TIMEOUT_MS = 8000;
// Valve endpoints normally answer in <1s; 4s keeps the first search on a
// fully-blocked network from burning 16s on dead providers (they are then
// health-skipped for 24h).
const SEARCH_TIMEOUT_MS = 4000;
const CDN_TIMEOUT_MS = 8000;
const DEFAULT_THROTTLE_MS = 250;

export type FetchLike = (url: string, init?: any) => Promise<any>;

export interface SteamAppCandidate {
  appid: number;
  name: string;
}

export interface LiveResolveOptions {
  fetchImpl?: FetchLike;
  /** Override cache directory (defaults to Electron userData). Used by tests. */
  cacheDir?: string;
  /** Politeness delay between live lookups in bulk loops (ms). */
  throttleMs?: number;
}

export interface AppIdCacheEntry {
  appId: number | null;
  name?: string;
  resolvedAt: number;
}

const appIdCaches = new Map<string, Record<string, any>>();
const appIdCacheSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function loadAppIdCache(cacheDir: string): Record<string, any> {
  const existing = appIdCaches.get(cacheDir);
  if (existing) return existing;
  let cache: Record<string, any> = {};
  try {
    const file = path.join(cacheDir, APPID_CACHE_FILE);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed && typeof parsed === 'object') cache = parsed;
    }
  } catch {}
  appIdCaches.set(cacheDir, cache);
  return cache;
}

function saveAppIdCache(cacheDir: string): void {
  const cache = appIdCaches.get(cacheDir);
  if (!cache) return;
  try {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const file = path.join(cacheDir, APPID_CACHE_FILE);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  } catch {}
}

function scheduleAppIdCacheSave(cacheDir: string): void {
  if (appIdCacheSaveTimers.has(cacheDir)) return;
  const timer = setTimeout(() => {
    appIdCacheSaveTimers.delete(cacheDir);
    saveAppIdCache(cacheDir);
  }, 1500);
  if (typeof timer.unref === 'function') timer.unref();
  appIdCacheSaveTimers.set(cacheDir, timer);
}

/** Forces a pending debounced cache write to disk (used by tests + exit). */
export function flushAppIdCache(cacheDir?: string): void {
  const dirs = cacheDir ? [cacheDir] : [...appIdCaches.keys()];
  for (const dir of dirs) {
    const timer = appIdCacheSaveTimers.get(dir);
    if (timer) {
      clearTimeout(timer);
      appIdCacheSaveTimers.delete(dir);
    }
    saveAppIdCache(dir);
  }
}

// Don't lose the last cache writes when the process exits before the
// debounced save fires.
process.once('exit', () => {
  try {
    flushAppIdCache();
  } catch {}
});

/**
 * Scores a single Steam search candidate against the requested title.
 * exact=3 > result contains title=2 > title contains result=1 > typo tolerance=1.
 * Contains-based scoring requires the shorter side to be substantial so
 * 1-2 char names (e.g. the game "Z") never match everything.
 */
function scoreCandidate(titleNorm: string, nameNorm: string): number {
  if (nameNorm === titleNorm) return 3;
  // Name contains the full query — legit even with long subtitles/editions;
  // allow 2+ char prefixes ("ho" → Horizon) but reject 1-char noise.
  if (titleNorm.length >= 2 && nameNorm.includes(titleNorm)) return 2;
  // Title contains the name — the name must be a real chunk of the title.
  if (nameNorm.length >= 5 && nameNorm.length / titleNorm.length >= 0.6 && titleNorm.includes(nameNorm)) return 1;
  const dist = levenshteinDistance(titleNorm, nameNorm);
  if (dist / Math.max(titleNorm.length, nameNorm.length) <= 0.25) return 1;
  return 0;
}

/**
 * Picks the best matching Steam app from live search results.
 * Pure function — exported for tests.
 */
export function pickBestAppMatch(
  title: string,
  results: SteamAppCandidate[]
): SteamAppCandidate | null {
  const titleNorm = normalizeForMatch(title || '');
  if (!titleNorm) return null;

  let best: SteamAppCandidate | null = null;
  let bestScore = 0;
  for (const r of results || []) {
    if (!r || typeof r.appid !== 'number' || !r.appid || !r.name) continue;
    const nameNorm = normalizeForMatch(r.name);
    if (!nameNorm) continue;
    const score = scoreCandidate(titleNorm, nameNorm);
    if (score === 0) continue;
    if (!best || score > bestScore) {
      best = r;
      bestScore = score;
    } else if (score === bestScore && nameNorm.length < normalizeForMatch(best.name).length) {
      // Same score: prefer the shorter name (fewer extra words)
      best = r;
    }
  }
  return best;
}

/** fetch with timeout — returns null on network failure instead of throwing. */
async function timedFetch(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  init: any = {}
): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Provider 0: CheapShark deal API — a community mirror of the Steam
 * catalogue (steamAppID + title) served from CDNs that stay reachable
 * even where Valve's own search endpoints are ISP-blocked (e.g. Vietnam).
 * Requires a descriptive User-Agent. Returns null on network failure,
 * [] on a successful request with no candidates.
 */
async function providerCheapShark(
  clean: string,
  fetchImpl: FetchLike
): Promise<SteamAppCandidate[] | null> {
  const res = await timedFetch(
    `${CHEAPSHARK_GAMES_URL}?title=${encodeURIComponent(clean)}&limit=20`,
    fetchImpl,
    CHEAPSHARK_TIMEOUT_MS,
    {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'GameVault/1.0 (game library tracker)' },
    }
  );
  if (res === null) return null;
  if (!res.ok) return null;
  try {
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const out: SteamAppCandidate[] = [];
    const seen = new Set<number>();
    for (const item of data) {
      const appid = Number(item?.steamAppID);
      // CheapShark's /games endpoint names the game in `external` (ALL CAPS)
      // — there is no `title` field; check both to be safe
      const rawName = item?.title ?? item?.external;
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!appid || appid <= 0 || !name || seen.has(appid)) continue;
      seen.add(appid);
      out.push({ appid, name });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Provider 1: steamcommunity SearchApps — fast, precise, keyless.
 * Unreachable on ISPs that block steamcommunity.com (e.g. Vietnam).
 * Returns null on network failure (→ provider marked unhealthy),
 * [] on a successful request with no candidates.
 */
async function providerSteamCommunity(
  clean: string,
  fetchImpl: FetchLike
): Promise<SteamAppCandidate[] | null> {
  const res = await timedFetch(`${STEAM_SEARCH_URL}${encodeURIComponent(clean)}`, fetchImpl, SEARCH_TIMEOUT_MS, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (res === null) return null;
  if (!res.ok) return null; // HTTP error ≠ "no results" — provider is unhealthy, not definitive
  try {
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    return list
      .filter((r: any) => r && typeof r.appid === 'number' && r.appid > 0 && r.name)
      .map((r: any) => ({ appid: r.appid, name: r.name }));
  } catch {
    return [];
  }
}

/**
 * Provider 2: official store search — keyless, precise.
 * Unreachable on the same ISPs that block steamcommunity.com.
 */
async function providerStoreSearch(
  clean: string,
  fetchImpl: FetchLike
): Promise<SteamAppCandidate[] | null> {
  const res = await timedFetch(
    `${STEAM_STORESEARCH_URL}?term=${encodeURIComponent(clean)}&cc=US&l=en`,
    fetchImpl,
    SEARCH_TIMEOUT_MS,
    { method: 'GET' }
  );
  if (res === null) return null;
  if (!res.ok) return null; // HTTP error ≠ "no results" — provider is unhealthy, not definitive
  try {
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .filter((i: any) => i && typeof i.id === 'number' && i.id > 0 && i.name)
      .map((i: any) => ({ appid: i.id, name: i.name }));
  } catch {
    return [];
  }
}

/**
 * Provider 3: official Steam Web API store query — keyless and reachable
 * almost everywhere (api.steampowered.com is rarely ISP-blocked). The API
 * has no text-search filter, so we scan recent releases + top sellers and
 * match locally. Covers brand-new games (the common "game mới" case).
 */
async function providerStoreQuery(fetchImpl: FetchLike): Promise<SteamAppCandidate[] | null> {
  const candidates: SteamAppCandidate[] = [];
  const queries = [
    { query: { start: 0, count: 300, sort: 20, filter: { released_only: true, type_filters: { include_games: true } } } },
    { query: { start: 0, count: 300, sort: 21, filter: { global_top_n_sellers: 500, type_filters: { include_games: true } } } },
  ];
  let anyOk = false;
  for (const q of queries) {
    const input = { ...q, context: { country_code: 'US', elanguage: 0 }, data_request: { include_basic_info: true } };
    const res = await timedFetch(
      `${ISTORE_QUERY_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`,
      fetchImpl,
      SEARCH_TIMEOUT_MS,
      { method: 'GET' }
    );
    if (res === null) continue; // this sub-request failed; try the other one
    if (!res.ok) continue;
    anyOk = true;
    try {
      const data = await res.json();
      const items = data?.response?.store_items || [];
      for (const it of items) {
        if (it && typeof it.appid === 'number' && it.appid > 0 && it.name) {
          candidates.push({ appid: it.appid, name: it.name });
        }
      }
    } catch {}
  }
  return anyOk ? candidates : null;
}

/**
 * Provider 4: full Steam game catalog (201k+ games, appid + name) from a
 * daily-updated community mirror of ISteamApps/GetAppList, served over
 * CDNs that stay reachable where steamcommunity.com is ISP-blocked.
 * Downloaded once (~20MB) and cached to disk for 30 days.
 */
async function loadOrFetchAppCatalog(
  cacheDir: string,
  fetchImpl: FetchLike,
  options?: { allowFetch?: boolean }
): Promise<SteamAppCandidate[] | null> {
  const allowFetch = options?.allowFetch !== false;
  const file = path.join(cacheDir, APP_CATALOG_FILE);
  let cached: { fetchedAt: number; apps: SteamAppCandidate[] } | null = null;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed && Array.isArray(parsed.apps)) cached = parsed;
    }
  } catch {}
  if (cached && Date.now() - cached.fetchedAt < APP_CATALOG_TTL_MS) {
    return cached.apps;
  }

  // Searches must stay snappy — an uncached catalog download (up to 60s)
  // is the background warm-up's job, not a live search's.
  if (!allowFetch) {
    return cached ? cached.apps : null;
  }

  for (const url of APP_CATALOG_URLS) {
    const res = await timedFetch(url, fetchImpl, CATALOG_TIMEOUT_MS, { method: 'GET' });
    if (res === null || !res.ok) continue;
    try {
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      const apps: SteamAppCandidate[] = [];
      const have = new Set<number>();
      for (const e of list) {
        if (e && typeof e.appid === 'number' && e.appid > 0 && e.name && !have.has(e.appid)) {
          apps.push({ appid: e.appid, name: e.name });
          have.add(e.appid);
        }
      }
      if (apps.length === 0) continue;
      try {
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: Date.now(), apps }));
        fs.renameSync(tmp, file);
      } catch {}
      return apps;
    } catch {
      continue;
    }
  }
  return cached ? cached.apps : null;
}

/**
 * Narrows the full-catalog mirror (201k+ rows) down to candidates related
 * to the query before they enter the chain — otherwise the unfiltered list
 * would be concatenated wholesale and scored row-by-row.
 */
function filterCatalogByQuery(
  apps: SteamAppCandidate[],
  query: string,
  cap: number = 200
): SteamAppCandidate[] {
  const q = normalizeForMatch(query);
  if (!q) return [];
  const out: SteamAppCandidate[] = [];
  for (const a of apps) {
    const n = normalizeForMatch(a.name);
    if (!n) continue;
    if (n === q || n.includes(q) || q.includes(n)) {
      out.push(a);
      if (out.length >= cap) break;
    }
  }
  return out;
}

/**
 * Runs the provider chain with all live providers dispatched IN PARALLEL —
 * on networks where Valve's endpoints are blocked this cuts the first
 * search from ~11s (sequential dead-provider timeouts) down to the single
 * slowest provider (~4s). Providers that error are recorded in the cache
 * and skipped for 24h so a dead provider costs one timeout per day.
 *
 * The catalog mirror only joins in when it is already cached — a search
 * must never block on the ~20MB initial download (warmUpAppCatalog does
 * that in the background at app start).
 *
 * Returns the collected candidates plus whether a definitive text-search
 * provider (steamcommunity/storesearch) ran to empty — only those can
 * honestly say "this title doesn't exist on Steam"; the store-query and
 * catalog providers are just partial scans.
 */
async function collectLiveCandidates(
  clean: string,
  cacheDir: string,
  fetchImpl: FetchLike,
  options?: { allowCatalogFetch?: boolean; includeStoreQuery?: boolean }
): Promise<{ candidates: SteamAppCandidate[]; definitiveSearch: boolean }> {
  // UI searches must stay snappy: an uncached catalog download (up to 60s)
  // is the background warm-up's job, so searches only use the catalog when
  // it is already cached. Cover enrichment (resolveAppIdLive) runs in the
  // background itself, so it may fetch the catalog on demand. The store
  // query scan (2-5s for 600 partial rows) only earns its keep in the
  // background too — the cached catalog covers the same ground instantly.
  const allowCatalogFetch = options?.allowCatalogFetch !== false;
  const includeStoreQuery = options?.includeStoreQuery !== false;
  const cache = loadAppIdCache(cacheDir);
  const health = cache['#providerHealth'] || {};
  const isSkipped = (name: string) =>
    health[name] && Date.now() - health[name] < PROVIDER_RETRY_MS;
  const markFailed = (name: string) => {
    health[name] = Date.now();
    cache['#providerHealth'] = health;
    scheduleAppIdCacheSave(cacheDir);
  };

  const providers: Array<[string, boolean, () => Promise<SteamAppCandidate[] | null>]> = [
    // CheapShark: fastest provider that works on ISP-blocked networks,
    // but a subset of Steam — not definitive when it returns []
    ['cheapshark', false, () => providerCheapShark(clean, fetchImpl)],
    ['steamcommunity', true, () => providerSteamCommunity(clean, fetchImpl)],
    ['storesearch', true, () => providerStoreSearch(clean, fetchImpl)],
    ...(includeStoreQuery
      ? ([['storequery', false, () => providerStoreQuery(fetchImpl)]] as Array<[string, boolean, () => Promise<SteamAppCandidate[] | null>]>)
      : []),
    ['appcatalog', false, async () => {
      const apps = await loadOrFetchAppCatalog(cacheDir, fetchImpl, { allowFetch: allowCatalogFetch });
      // Not cached yet (or cache expired) → contribute nothing this round but
      // do NOT mark the provider unhealthy — warmUpAppCatalog fills it shortly
      if (!apps) return [];
      return filterCatalogByQuery(apps, clean);
    }],
  ];

  const active = providers.filter(([name]) => !isSkipped(name));
  const settled = await Promise.all(
    active.map(async ([name, definitive, run]): Promise<[string, boolean, SteamAppCandidate[] | null]> => {
      const t0 = Date.now();
      try {
        const res = await run();
        if (res === null) {
          console.warn(`[covers] provider ${name} FAILED for "${clean}" (${Date.now() - t0}ms) — marked unhealthy`);
          return [name, definitive, null];
        }
        console.log(`[covers] provider ${name} → ${res.length} candidates for "${clean}" (${Date.now() - t0}ms)`);
        return [name, definitive, res];
      } catch (err: any) {
        console.warn(`[covers] provider ${name} threw for "${clean}":`, err?.message || err);
        return [name, definitive, null];
      }
    })
  );

  let all: SteamAppCandidate[] = [];
  let definitiveSearch = false;
  for (const [name, definitive, res] of settled) {
    if (res === null) {
      markFailed(name);
      continue;
    }
    if (definitive) definitiveSearch = true;
    all = all.concat(res);
  }
  return { candidates: all, definitiveSearch };
}

/**
 * Resolves a Steam AppID for an arbitrary title via a provider chain
 * (steamcommunity search → store search → official store query → full
 * catalog mirror), with a persistent JSON cache. Positive entries live
 * forever (AppIDs are stable); negative entries are only written when a
 * definitive text-search provider ran to empty, and are retried after
 * 7 days. Network failures fail soft (never throw).
 */
export async function resolveAppIdLive(
  title: string,
  opts: LiveResolveOptions = {}
): Promise<{ appId: number; name: string } | null> {
  const clean = (title || '').trim();
  const key = normalizeForMatch(clean);
  if (!key) return null;

  const cacheDir = opts.cacheDir || app.getPath('userData');
  const cache = loadAppIdCache(cacheDir);
  const cached = cache[key];
  if (cached) {
    if (cached.appId && cached.appId > 0) {
      return { appId: cached.appId, name: cached.name || '' };
    }
    if (Date.now() - (cached.resolvedAt || 0) < NEGATIVE_CACHE_TTL_MS) {
      return null; // recently confirmed missing
    }
  }

  const fetchImpl = opts.fetchImpl || fetch;
  let match: SteamAppCandidate | null = null;
  let definitiveSearch = false;
  try {
    // Background cover enrichment may pay the one-time catalog download
    const collected = await collectLiveCandidates(clean, cacheDir, fetchImpl, {
      allowCatalogFetch: true,
      includeStoreQuery: true,
    });
    definitiveSearch = collected.definitiveSearch;
    match = pickBestAppMatch(clean, collected.candidates);
  } catch {
    // Offline / blocked — fail soft, don't write negative cache for network errors
    return null;
  }

  if (match || definitiveSearch) {
    cache[key] = {
      appId: match ? match.appid : null,
      name: match ? match.name : undefined,
      resolvedAt: Date.now(),
    };
    scheduleAppIdCacheSave(cacheDir);
  }

  return match ? { appId: match.appid, name: match.name } : null;
}

/**
 * Ranks accumulated chain candidates against the query and keeps the best
 * `limit` (deduped by AppID). Unranked partial-scan providers (store query,
 * catalog mirror) contribute hundreds of unrelated rows that would otherwise
 * crowd out real matches once sliced — scoring fixes that.
 */
function rankCandidates(
  query: string,
  candidates: SteamAppCandidate[],
  limit: number
): SteamAppCandidate[] {
  const titleNorm = normalizeForMatch(query);
  if (!titleNorm) return [];
  const scored = candidates
    .map((c) => ({ c, score: scoreCandidate(titleNorm, normalizeForMatch(c.name)) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.c.name.length - b.c.name.length);
  const seen = new Set<number>();
  const out: SteamAppCandidate[] = [];
  for (const { c } of scored) {
    if (seen.has(c.appid)) continue;
    seen.add(c.appid);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Multi-result Steam search powering the Wishlist search box and the
 * external-results section. Runs the full provider chain
 * (CheapShark → steamcommunity → storesearch → store query → catalog
 * mirror) with 24h health-skipping for unreachable providers, so it
 * keeps working on networks where Valve's own endpoints are blocked.
 * Candidates are ranked against the query; returns up to `limit`.
 * Network failures fail soft (empty list).
 */
export async function searchSteamApps(
  query: string,
  opts: LiveResolveOptions & { limit?: number } = {}
): Promise<SteamAppCandidate[]> {
  const clean = (query || '').trim();
  if (!clean) return [];

  const fetchImpl = opts.fetchImpl || fetch;
  const cacheDir = opts.cacheDir || app.getPath('userData');
  try {
    // Live search must not block on the ~20MB catalog download — it only
    // joins in once warmUpAppCatalog has cached it in the background. The
    // slow partial store-query scan is enrichment-only.
    const { candidates } = await collectLiveCandidates(clean, cacheDir, fetchImpl, {
      allowCatalogFetch: false,
      includeStoreQuery: false,
    });
    return rankCandidates(clean, candidates, opts.limit ?? 20);
  } catch {
    return [];
  }
}

/**
 * Pre-fetches the full Steam catalog mirror in the background so the first
 * search on an ISP-blocked network doesn't pay the ~20MB download latency.
 * Fire-and-forget — never throws.
 */
export async function warmUpAppCatalog(cacheDir?: string, fetchImpl?: FetchLike): Promise<boolean> {
  try {
    const dir = cacheDir || app.getPath('userData');
    const apps = await loadOrFetchAppCatalog(dir, fetchImpl || fetch);
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    return false;
  }
}

export interface VerifiedSteamUrls {
  posterUrl?: string;
  bannerUrl?: string;
  /** false = network was unreachable, URLs are best-guess (fail-open). */
  verified: boolean;
}

/**
 * HEAD-verifies Steam CDN assets for an AppID, falling back through
 * the asset chain. Distinguishes 404 (definitive "missing") from network
 * errors (fail-open with the classic unverified URLs so offline behavior
 * is preserved).
 */
export async function resolveVerifiedSteamUrls(
  appId: number,
  opts: LiveResolveOptions = {}
): Promise<VerifiedSteamUrls> {
  const id = Math.trunc(Number(appId));
  if (!Number.isFinite(id) || id <= 0) return { verified: true };

  const posterCandidates = [
    `${STEAM_STATIC_CDN_BASE}/${id}/library_600x900_2x.jpg`,
    `${STEAM_STATIC_CDN_BASE}/${id}/library_600x900.jpg`,
  ];
  const bannerCandidates = [
    `${STEAM_STATIC_CDN_BASE}/${id}/library_hero.jpg`,
    `${STEAM_STATIC_CDN_BASE}/${id}/header.jpg`,
    `${STEAM_STATIC_CDN_BASE}/${id}/capsule_616x353.jpg`,
    `${STEAM_CLASSIC_CDN_BASE}/${id}/header.jpg`,
    `${STEAM_CLASSIC_CDN_BASE}/${id}/capsule_616x353.jpg`,
  ];

  const fetchImpl = opts.fetchImpl || fetch;
  const headCheck = async (url: string): Promise<'ok' | 'missing' | 'error'> => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CDN_TIMEOUT_MS);
      let res: any;
      try {
        res = await fetchImpl(url, { method: 'HEAD', signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      return res && res.ok ? 'ok' : 'missing';
    } catch {
      return 'error';
    }
  };

  let anyDefinitive = false;
  let poster: string | undefined;
  for (const url of posterCandidates) {
    const r = await headCheck(url);
    if (r === 'ok') {
      poster = url;
      anyDefinitive = true;
      break;
    }
    if (r === 'missing') anyDefinitive = true;
  }

  let banner: string | undefined;
  for (const url of bannerCandidates) {
    const r = await headCheck(url);
    if (r === 'ok') {
      banner = url;
      anyDefinitive = true;
      break;
    }
    if (r === 'missing') anyDefinitive = true;
  }

  if (anyDefinitive) {
    return { posterUrl: poster, bannerUrl: banner, verified: true };
  }

  // All requests errored (offline): fail open with classic URLs
  const fallback = buildSteamCdnUrls(id);
  return {
    posterUrl: fallback.posterUrl,
    bannerUrl: fallback.bannerUrl,
    verified: false,
  };
}

// ============================================================
// COMING-SOON STORE ASSETS — unreleased games publish art with
// content-hashed filenames that cannot be guessed; the official
// store query API returns those hashed URLs in `assets`.
// ============================================================

const STORE_ASSETS_CDN = 'https://shared.fastly.steamstatic.com/store_item_assets/';
const COMING_SOON_CACHE_MS = 10 * 60 * 1000;
let comingSoonAssetsCache: { at: number; map: Map<number, { posterUrl?: string; bannerUrl?: string }> } | null = null;

/**
 * Fetches hashed art URLs for upcoming games (Steam store assets).
 * Returns a map appid → { bannerUrl } built from `library_hero` /
 * `hero_capsule` / `header` assets. Memoized for 10 minutes.
 */
export async function fetchComingSoonAssets(
  fetchImpl: FetchLike
): Promise<Map<number, { posterUrl?: string; bannerUrl?: string }>> {
  if (comingSoonAssetsCache && Date.now() - comingSoonAssetsCache.at < COMING_SOON_CACHE_MS) {
    return comingSoonAssetsCache.map;
  }
  const map = new Map<number, { posterUrl?: string; bannerUrl?: string }>();
  const input = {
    query: { start: 0, count: 300, sort: 20, filter: { coming_soon_only: true, type_filters: { include_games: true } } },
    context: { country_code: 'US', elanguage: 0 },
    data_request: { include_assets: true },
  };
  const res = await timedFetch(
    `${ISTORE_QUERY_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`,
    fetchImpl,
    SEARCH_TIMEOUT_MS,
    { method: 'GET' }
  );
  let fetched = false;
  if (res && res.ok) {
    fetched = true;
    try {
      const data = await res.json();
      const items = data?.response?.store_items || [];
      for (const it of items) {
        const assets = it?.assets;
        if (!it || typeof it.appid !== 'number' || it.appid <= 0 || !assets?.asset_url_format) continue;
        const make = (file?: string): string | undefined => {
          if (typeof file !== 'string' || !file) return undefined;
          return `${STORE_ASSETS_CDN}${assets.asset_url_format.replace('${FILENAME}', file)}`;
        };
        map.set(it.appid, {
          bannerUrl: make(assets.library_hero || assets.hero_capsule_2x || assets.hero_capsule || assets.header_2x || assets.header),
        });
      }
    } catch {}
  }
  // Only memoize successful scans — a failed scan must not poison the
  // cache with an empty map for the next 10 minutes.
  if (fetched) {
    comingSoonAssetsCache = { at: Date.now(), map };
  }
  return map;
}

/** Matches Steam CDN URLs (the only kind auto-repair is allowed to rewrite). */
export function isSteamStaticUrl(url?: string | null): boolean {
  return typeof url === 'string' && /steamstatic\.com/i.test(url);
}

// ============================================================
// WIKIPEDIA COVER ART — keyless, canonical per title. Covers the
// gap Steam can't: unreleased games with hash-only assets and
// games whose official cover art never ships as a library asset.
// ============================================================

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

/**
 * Fetches the official cover/box art for a title from its English
 * Wikipedia article (scaled to 600px). Returns a clean upload.wikimedia.org
 * URL, or null when the article has no usable cover file.
 */
export async function fetchWikipediaPoster(
  gameTitle: string,
  opts: LiveResolveOptions = {}
): Promise<string | null> {
  const clean = cleanTitleForLookup(gameTitle);
  if (!clean) return null;
  const fetchImpl = opts.fetchImpl || fetch;
  const headers = { 'User-Agent': 'GameVault/1.0 (game library tracker)' };
  try {
    const u1 = `${WIKI_API}?action=query&format=json&prop=images&imlimit=20&redirects=1&titles=${encodeURIComponent(clean)}`;
    const r1 = await timedFetch(u1, fetchImpl, SEARCH_TIMEOUT_MS, { method: 'GET', headers });
    if (!r1 || !r1.ok) return null;
    const j1 = await r1.json();
    const page = Object.values(j1?.query?.pages || {})[0] as any;
    const files = (page?.images || [])
      .map((i: any) => i?.title)
      .filter((t: any) => typeof t === 'string');
    const cover =
      files.find((f: string) => /cover|box ?art/i.test(f)) ||
      files.find((f: string) => /\.(jpe?g|png)$/i.test(f));
    if (!cover) return null;

    const u2 = `${WIKI_API}?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=600&redirects=1&titles=${encodeURIComponent(cover)}`;
    const r2 = await timedFetch(u2, fetchImpl, SEARCH_TIMEOUT_MS, { method: 'GET', headers });
    if (!r2 || !r2.ok) return null;
    const j2 = await r2.json();
    const p2 = Object.values(j2?.query?.pages || {})[0] as any;
    const url = p2?.imageinfo?.[0]?.thumburl;
    if (typeof url !== 'string' || !/^https?:\/\/upload\.wikimedia\.org\//i.test(url)) return null;
    return url.split('?')[0];
  } catch {
    return null;
  }
}

// ============================================================
// GOOGLE CUSTOM SEARCH (image) — keyless options can't cover
// non-Steam games or released games that only ship hashed
// assets; a user-provided Google API key + CSE id fills the gap.
// ============================================================

const GOOGLE_CSE_URL = 'https://www.googleapis.com/customsearch/v1';
const SETTINGS_FILE = 'settings.json';

export interface GoogleConfig {
  apiKey?: string;
  cseId?: string;
}

export interface WebImageCandidate {
  url: string;
  width?: number;
  height?: number;
  snippet?: string;
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export function getGoogleConfig(): GoogleConfig {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { apiKey: parsed.googleApiKey, cseId: parsed.googleCseId };
    }
  } catch {}
  return {};
}

export function setGoogleConfig(apiKey: string, cseId: string): GoogleConfig {
  const p = getSettingsPath();
  let settings: Record<string, unknown> = {};
  try {
    if (fs.existsSync(p)) settings = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {}
  settings.googleApiKey = apiKey;
  settings.googleCseId = cseId;
  try {
    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings));
    fs.renameSync(tmp, p);
  } catch {}
  return { apiKey, cseId };
}

// ============================================================
// IGDB — the industry-standard canonical poster source. Every
// cover in their catalog is vertical 2:3 by design, covers
// unreleased games, and is updated continuously (Twitch-backed).
// One-time Twitch app credentials; token auto-refreshed ~60 days.
// ============================================================

const IGDB_API = 'https://api.igdb.com/v4';
const IGDB_IMAGE_CDN = 'https://images.igdb.com/igdb/image/upload';
let igdbTokenCache: { token: string; expiresAt: number } | null = null;

export interface IgdbConfig {
  clientId?: string;
  clientSecret?: string;
}

export function getIgdbConfig(): IgdbConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    return { clientId: parsed.igdbClientId, clientSecret: parsed.igdbClientSecret };
  } catch {
    return {};
  }
}

export function setIgdbConfig(clientId: string, clientSecret: string): IgdbConfig {
  const p = getSettingsPath();
  let settings: Record<string, unknown> = {};
  try {
    if (fs.existsSync(p)) settings = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {}
  settings.igdbClientId = clientId;
  settings.igdbClientSecret = clientSecret;
  // Credentials changed → drop any cached token
  igdbTokenCache = null;
  delete settings.igdbToken;
  delete settings.igdbTokenExpiresAt;
  try {
    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings));
    fs.renameSync(tmp, p);
  } catch {}
  return { clientId, clientSecret };
}

/** Twitch OAuth client-credentials token, cached in memory + settings.json. */
async function igdbAccessToken(opts: LiveResolveOptions): Promise<{ clientId: string; token: string } | null> {
  const cfg = getIgdbConfig();
  if (!cfg.clientId || !cfg.clientSecret) return null;
  if (igdbTokenCache && Date.now() < igdbTokenCache.expiresAt) {
    return { clientId: cfg.clientId, token: igdbTokenCache.token };
  }
  // Reuse a persisted token from a previous run
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    if (typeof parsed.igdbToken === 'string' && typeof parsed.igdbTokenExpiresAt === 'number' && Date.now() < parsed.igdbTokenExpiresAt) {
      igdbTokenCache = { token: parsed.igdbToken, expiresAt: parsed.igdbTokenExpiresAt };
      return { clientId: cfg.clientId, token: parsed.igdbToken };
    }
  } catch {}

  const fetchImpl = opts.fetchImpl || fetch;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(cfg.clientId)}&client_secret=${encodeURIComponent(cfg.clientSecret)}&grant_type=client_credentials`;
  const res = await timedFetch(url, fetchImpl, SEARCH_TIMEOUT_MS, { method: 'POST' });
  if (!res || !res.ok) return null;
  try {
    const data = await res.json();
    if (typeof data?.access_token !== 'string' || typeof data?.expires_in !== 'number') return null;
    const expiresAt = Date.now() + Math.max(60, (data.expires_in - 3600)) * 1000; // refresh 1h early
    igdbTokenCache = { token: data.access_token, expiresAt };
    const p = getSettingsPath();
    try {
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(p)) settings = JSON.parse(fs.readFileSync(p, 'utf-8'));
      settings.igdbToken = data.access_token;
      settings.igdbTokenExpiresAt = expiresAt;
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(settings));
      fs.renameSync(tmp, p);
    } catch {}
    return { clientId: cfg.clientId, token: data.access_token };
  } catch {
    return null;
  }
}

async function igdbQuery(query: string, opts: LiveResolveOptions): Promise<any[] | null> {
  const auth = await igdbAccessToken(opts);
  if (!auth) return null;
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await timedFetch(`${IGDB_API}/games`, fetchImpl, SEARCH_TIMEOUT_MS, {
    method: 'POST',
    headers: {
      'Client-ID': auth.clientId,
      'Authorization': `Bearer ${auth.token}`,
      'Accept': 'application/json',
    },
    body: query,
  });
  if (!res || !res.ok) return null;
  try {
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Canonical vertical poster (2:3, 720p) from IGDB — matched via Steam
 * AppID (external_games category 1) when known, else by name search.
 */
export async function fetchIgdbPoster(
  gameTitle: string,
  appId: number | null,
  opts: LiveResolveOptions = {}
): Promise<string | null> {
  const clean = cleanTitleForLookup(gameTitle);
  if (!clean && appId === null) return null;
  const cfg = getIgdbConfig();
  if (!cfg.clientId || !cfg.clientSecret) return null;

  let coverId: string | undefined;

  if (appId !== null) {
    const rows = await igdbQuery(
      `fields name, cover.image_id; where external_games.category = 1 & external_games.uid = "${appId}"; limit 1;`,
      opts
    );
    coverId = rows?.[0]?.cover?.image_id;
  }

  if (!coverId) {
    const rows = await igdbQuery(
      `search "${clean.replace(/"/g, '')}"; fields name, cover.image_id; limit 5;`,
      opts
    );
    if (rows?.length) {
      const titleNorm = normalizeForMatch(clean);
      let best: { imageId: string; score: number } | null = null;
      for (const r of rows) {
        if (!r?.cover?.image_id) continue;
        const score = scoreCandidate(titleNorm, normalizeForMatch(r.name || ''));
        if (score > 0 && (!best || score > best.score)) {
          best = { imageId: r.cover.image_id, score };
        }
      }
      coverId = best?.imageId;
    }
  }

  if (!coverId) return null;
  return `${IGDB_IMAGE_CDN}/t_720p/${coverId}.jpg`;
}

/**
 * Web image search via Google Custom Search JSON API (user-provided
 * key + CSE id). Query keywords differ per slot: "game poster" for
 * the 2:3 cover, "game wallpaper 16:9" for the hero banner.
 */
export async function searchWebImages(
  gameTitle: string,
  kind: 'poster' | 'banner',
  opts: LiveResolveOptions = {}
): Promise<WebImageCandidate[]> {
  const cfg = getGoogleConfig();
  if (!cfg.apiKey || !cfg.cseId) {
    throw new Error('Chưa cấu hình Google API Key / CSE ID.');
  }
  const clean = cleanTitleForLookup(gameTitle);
  const query = kind === 'poster' ? `${clean} game poster` : `${clean} game wallpaper 16:9`;
  const fetchImpl = opts.fetchImpl || fetch;
  const url =
    `${GOOGLE_CSE_URL}?key=${encodeURIComponent(cfg.apiKey)}&cx=${encodeURIComponent(cfg.cseId)}` +
    `&q=${encodeURIComponent(query)}&searchType=image&num=8&safe=off&fileType=jpg%20png`;
  const res = await timedFetch(url, fetchImpl, SEARCH_TIMEOUT_MS, { method: 'GET' });
  if (!res || !res.ok) {
    const status = res ? String(res.status) : 'network';
    let hint = '';
    try {
      if (res) {
        const body = await res.text();
        if (body.includes('quotaExceeded')) hint = ' — hết quota ngày (100 query/ngày với key miễn phí)';
        if (body.includes('keyInvalid') || res.status === 400) hint = ' — kiểm tra lại API Key / CSE ID';
      }
    } catch {}
    throw new Error(`Google Image Search lỗi (${status})${hint}`);
  }
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .filter((i: any) => i && typeof i.link === 'string' && /^https?:/i.test(i.link))
    .map((i: any) => ({
      url: i.link,
      width: Number(i.image?.width) || undefined,
      height: Number(i.image?.height) || undefined,
      snippet: typeof i.snippet === 'string' ? i.snippet : undefined,
    }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves Steam AppID using user input or curated dictionary.
 */
export function resolveSteamAppId(gameTitle: string, steamId?: number): number | null {
  const sid = sanitizeSteamId(steamId);
  if (sid) {
    return sid;
  }

  if (!gameTitle) return null;

  const titleLower = gameTitle.trim().toLowerCase();
  if (CURATED_STEAM_APP_IDS[titleLower]) {
    return CURATED_STEAM_APP_IDS[titleLower];
  }

  // Alias resolution
  const alias = resolveFolderAlias(gameTitle).toLowerCase();
  if (CURATED_STEAM_APP_IDS[alias]) {
    return CURATED_STEAM_APP_IDS[alias];
  }

  // Normalized matching
  const normTitle = normalizeForMatch(gameTitle);
  for (const [key, id] of Object.entries(CURATED_STEAM_APP_IDS)) {
    if (normalizeForMatch(key) === normTitle) {
      return id;
    }
  }

  return null;
}

/**
 * Detects Steam AppID from game directory files (steam_appid.txt, Goldberg emulator config).
 */
export function detectSteamAppIdFromExe(exePath?: string | null): number | null {
  if (!exePath) return null;
  try {
    const dir = path.dirname(exePath);
    const candidates = [
      path.join(dir, 'steam_appid.txt'),
      path.join(dir, 'steam_settings', 'steam_appid.txt'),
      path.join(path.dirname(dir), 'steam_settings', 'steam_appid.txt'),
      path.join(path.dirname(dir), 'steam_appid.txt'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const content = fs.readFileSync(c, 'utf-8').trim();
        const id = parseInt(content, 10);
        if (sanitizeSteamId(id)) {
          return id;
        }
      }
    }
  } catch {}
  return null;
}

// Negative cache for folder probes: most games have no steam_appid.txt, and
// re-probing the same directory (often on a sleeping HDD) on every enrich
// cycle spins the disk back up for nothing. One failed probe per directory
// is remembered for 7 days, mirroring the network-side negative cache TTL.
const EXE_PROBE_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const exeProbeNegativeCache = new Map<string, number>();

/**
 * FS-probe wrapper with a per-directory negative cache. Use this everywhere
 * cover enrichment runs repeatedly (background enrich, AMD import) — direct
 * `detectSteamAppIdFromExe` stays for one-shot paths.
 */
export function detectSteamAppIdCached(exePath?: string | null): number | null {
  if (!exePath) return null;
  const dirKey = path.dirname(exePath).toLowerCase();
  const failedAt = exeProbeNegativeCache.get(dirKey);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < EXE_PROBE_NEGATIVE_TTL_MS) {
      return null;
    }
    exeProbeNegativeCache.delete(dirKey);
  }
  const detected = detectSteamAppIdFromExe(exePath);
  if (detected && detected > 0) {
    exeProbeNegativeCache.delete(dirKey);
  } else {
    exeProbeNegativeCache.set(dirKey, Date.now());
  }
  return detected;
}

/**
 * Steam stores sentinel "no steam" ids as INT32_MAX (AMD DB exports) — they
 * must never be trusted as a real AppID.
 */
export function sanitizeSteamId(id?: number | null): number | null {
  return typeof id === 'number' && id > 0 && id < 2147483647 ? id : null;
}

/**
 * Strips Windows shortcut artifacts from window-title-derived names, e.g.
 * "sekiro - Shortcut" → "sekiro".
 */
function cleanTitleForLookup(title: string): string {
  return (title || '').replace(/\s*[—–-]\s*shortcut\s*$/i, '').trim();
}

/**
 * Full Steam-art resolution for one title: explicit AppID → curated
 * dictionary → live provider chain → franchise fallback. A candidate AppID
 * that HEAD-verifies to NO art at all (sentinel ids, Goldberg stubs,
 * unreleased games) falls through to the next source instead of failing
 * the whole lookup — but if every source agrees on the same id, the id is
 * still returned (with empty URLs) so callers can show a precise message.
 */
async function resolveSteamArtForTitle(
  rawTitle: string,
  explicitId: number | null,
  opts: LiveResolveOptions
): Promise<{ appId: number | null; posterUrl?: string; bannerUrl?: string; verified: boolean }> {
  const title = cleanTitleForLookup(rawTitle);
  const normTitle = title.toLowerCase();
  const sid = sanitizeSteamId(explicitId);

  const tryId = async (
    id: number | null
  ): Promise<{ appId: number; posterUrl?: string; bannerUrl?: string; verified: boolean } | null> => {
    if (id === null) return null;
    const urls = await resolveVerifiedSteamUrls(id, opts);
    let posterUrl = urls.posterUrl;
    let bannerUrl = urls.bannerUrl;
    if (!posterUrl && !bannerUrl) {
      // No static library art — unreleased games publish hashed store
      // assets instead; grab the banner from the official store query.
      try {
        const comingSoon = await fetchComingSoonAssets(opts.fetchImpl || fetch);
        const extra = comingSoon.get(id);
        if (extra?.bannerUrl) bannerUrl = extra.bannerUrl;
      } catch {}
    }
    // Offline → fail open with classic URLs. Online with zero art → the id
    // itself is suspect (sentinel/stub/unreleased); signal with null.
    if (!urls.verified || posterUrl || bannerUrl) {
      return { appId: id, posterUrl, bannerUrl, verified: urls.verified };
    }
    return null;
  };

  let appId: number | null = null;
  let posterUrl: string | undefined;
  let bannerUrl: string | undefined;
  let verified = true;

  // Poster back-fill order: IGDB (guaranteed 2:3, user-configured) →
  // Wikipedia (keyless) — used whenever Steam has no vertical art.
  const backfillPoster = async (): Promise<void> => {
    if (posterUrl) return;
    const igdb = await fetchIgdbPoster(title, appId, opts);
    if (igdb) {
      posterUrl = igdb;
      return;
    }
    const wiki = await fetchWikipediaPoster(title, opts);
    if (wiki) posterUrl = wiki;
  };

  // Packages a Steam-art hit; when Steam has no vertical art (unreleased
  // games, hash-only key art) the poster is back-filled from IGDB
  // (guaranteed 2:3) then Wikipedia.
  const accept = async (
    id: number | null,
    p?: string,
    b?: string,
    v = true
  ): Promise<{ appId: number | null; posterUrl?: string; bannerUrl?: string; verified: boolean }> => {
    appId = id;
    posterUrl = p;
    bannerUrl = b;
    verified = v;
    await backfillPoster();
    return { appId, posterUrl, bannerUrl, verified };
  };

  // 1. Explicit AppID (DB steam_id / steam_appid.txt)
  if (sid) {
    const hit = await tryId(sid);
    if (hit) return accept(hit.appId, hit.posterUrl, hit.bannerUrl, hit.verified);
  }

  // 2. Curated dictionary / aliases (skips the sid so garbage ids can't mask it)
  const dictId = resolveSteamAppId(title, undefined);
  if (dictId && dictId !== sid) {
    const hit = await tryId(dictId);
    if (hit) return accept(hit.appId, hit.posterUrl, hit.bannerUrl, hit.verified);
    appId = dictId;
  } else if (dictId) {
    appId = dictId;
  }

  // 3. Live provider chain
  const live = await resolveAppIdLive(title, opts);
  if (live && live.appId > 0) {
    if (live.appId !== sid && live.appId !== dictId) {
      const hit = await tryId(live.appId);
      if (hit) return accept(hit.appId, hit.posterUrl, hit.bannerUrl, hit.verified);
      appId = live.appId;
    } else {
      appId = live.appId;
    }
  }

  // 4. Franchise fallback
  if (!appId && normTitle.includes('resident evil')) {
    const hit = await tryId(883710);
    if (hit) return accept(hit.appId, hit.posterUrl, hit.bannerUrl, hit.verified);
    appId = 883710;
  }

  // 5. Poster back-fill (IGDB → Wikipedia) — keyless/official art for games
  // Steam shows with hash-only assets, and for titles not on Steam at all.
  await backfillPoster();
  return { appId, posterUrl, bannerUrl, verified };
}

/**
 * Fast search for Steam cover art.
 * Returns direct CDN URLs for vertical 2:3 poster and 16:9 hero banner.
 * Resolution order: curated non-Steam map → Steam AppID (param → dictionary →
 * live search, with garbage-sid fall-through) → franchise fallback. CDN URLs
 * are HEAD-verified (fail-open when offline).
 */
export async function searchSteamCovers(
  gameTitle: string,
  steamId?: number,
  opts: LiveResolveOptions = {}
): Promise<SteamCoversResult> {
  const normTitle = (gameTitle || '').trim().toLowerCase();

  // 1. Check curated non-steam covers first (e.g. Requiem, Bloodborne, LoL, etc.)
  if (NON_STEAM_COVERS[normTitle]) {
    const item = NON_STEAM_COVERS[normTitle];
    return {
      posterUrl: item.poster,
      bannerUrl: item.banner,
      poster: item.poster,
      banner: item.banner,
    };
  }

  // 2. Check normalized match in NON_STEAM_COVERS
  const normMatch = normalizeForMatch(gameTitle);
  for (const [key, val] of Object.entries(NON_STEAM_COVERS)) {
    if (normalizeForMatch(key) === normMatch) {
      return {
        posterUrl: val.poster,
        bannerUrl: val.banner,
        poster: val.poster,
        banner: val.banner,
      };
    }
  }

  const art = await resolveSteamArtForTitle(gameTitle, sanitizeSteamId(steamId), opts);
  return {
    posterUrl: art.posterUrl,
    bannerUrl: art.bannerUrl,
    poster: art.posterUrl,
    banner: art.bannerUrl,
    appId: art.appId ?? undefined,
  };
}

/**
 * Uploads a custom cover art file from local disk.
 * Saves a copy in user data cache directory and links it to game.
 */
export async function uploadCustomCover(
  gameId: number,
  type: 'poster' | 'banner'
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: `Chọn ảnh làm ${type === 'poster' ? 'Poster (2:3)' : 'Hero Banner (16:9)'}`,
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  const ext = path.extname(selectedPath) || '.jpg';
  const coversDir = path.join(app.getPath('userData'), 'covers');

  if (!fs.existsSync(coversDir)) {
    fs.mkdirSync(coversDir, { recursive: true });
  }

  const fileName = `cover_${gameId}_${type}_${Date.now()}${ext}`;
  const targetPath = path.join(coversDir, fileName);

  fs.copyFileSync(selectedPath, targetPath);

  // Update game in SQLite database
  if (gameId > 0) {
    if (type === 'poster') {
      updateGame(gameId, { cover_url: targetPath });
    } else {
      updateGame(gameId, { banner_url: targetPath });
    }
  }

  return targetPath;
}

/**
 * Sets cover art from an existing screenshot in the game's media folder.
 * Automatically optimizes, compresses, and saves to SSD (userData/covers)
 * to eliminate lag caused by streaming large raw screenshots from HDD.
 */
export function setCoverFromScreenshot(
  gameId: number,
  type: 'poster' | 'banner',
  screenshotPath: string
): string {
  if (!fs.existsSync(screenshotPath)) {
    throw new Error(`Screenshot file not found: ${screenshotPath}`);
  }

  if (gameId > 0) {
    const coversDir = path.join(app.getPath('userData'), 'covers');
    const optimizedPath = optimizeAndSaveCover(screenshotPath, gameId, type, coversDir);

    if (type === 'poster') {
      updateGame(gameId, { cover_url: optimizedPath });
    } else {
      updateGame(gameId, { banner_url: optimizedPath });
    }

    return optimizedPath;
  }

  return screenshotPath;
}

/**
 * Per-game web cover resolution shared by the enrich loop and the repair
 * pass: folder AppID detection → curated non-Steam map → Steam dictionary
 * → live search → franchise fallback.
 */
async function resolveWebCoversForGame(
  db: any,
  g: any,
  opts: LiveResolveOptions
): Promise<{ poster?: string; banner?: string; verified: boolean }> {
  const cleanTitle = (g.title || '').toLowerCase().trim();

  // 1. Detect AppID: existing steam_id or steam_appid.txt in game folder
  let detectedAppId = typeof g.steam_id === 'number' && g.steam_id > 0 ? g.steam_id : null;
  if (!detectedAppId && g.exe_path) {
    // Cached probe: repeated enrichment cycles must not re-stat game folders
    // on a sleeping HDD when the file was already known absent
    detectedAppId = detectSteamAppIdCached(g.exe_path);
    if (detectedAppId) {
      try {
        db.prepare('UPDATE games SET steam_id = ? WHERE id = ?').run(detectedAppId, g.id);
      } catch {}
    }
  }

  // 2. Curated non-Steam map (e.g. Resident Evil Requiem, Bloodborne, LoL) — trusted hand-picked URLs
  if (NON_STEAM_COVERS[cleanTitle]) {
    return {
      poster: NON_STEAM_COVERS[cleanTitle].poster,
      banner: NON_STEAM_COVERS[cleanTitle].banner,
      verified: true,
    };
  }
  const normTitle = normalizeForMatch(g.title);
  for (const [key, val] of Object.entries(NON_STEAM_COVERS)) {
    if (normalizeForMatch(key) === normTitle) {
      return { poster: val.poster, banner: val.banner, verified: true };
    }
  }

  // 3. Steam art via the shared chain (explicit id → dict → live, with
  // garbage-sid fall-through and asset-less-app handling)
  const art = await resolveSteamArtForTitle(g.title, detectedAppId, opts);

  // 4. Write the resolved id back when the stored one was unset or garbage
  if (art.appId && art.appId !== detectedAppId) {
    try {
      db.prepare('UPDATE games SET steam_id = ? WHERE id = ?').run(art.appId, g.id);
    } catch {}
  }

  return { poster: art.posterUrl, banner: art.bannerUrl, verified: art.verified };
}

/** HEAD-checks any URL, treating network errors as unhealthy. */
async function isUrlHealthy(url: string, opts: LiveResolveOptions): Promise<boolean> {
  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CDN_TIMEOUT_MS);
    let res: any;
    try {
      res = await fetchImpl(url, { method: 'HEAD', signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

/**
 * Repairs saved Steam CDN cover URLs that no longer resolve (404), e.g.
 * URLs written blindly before verification existed. Re-resolves through
 * the full chain and replaces a dead field only with a VERIFIED URL —
 * never guesses while offline and never touches non-steamstatic URLs
 * (user-added covers) or local file paths.
 */
async function repairDeadSteamStaticCovers(db: any, opts: LiveResolveOptions): Promise<number> {
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  let repaired = 0;
  try {
    const rows = db
      .prepare(
        `SELECT id, title, exe_path, steam_id, cover_url, banner_url FROM games
         WHERE (cover_url IS NOT NULL AND cover_url != '' AND cover_url LIKE '%steamstatic%')
            OR (banner_url IS NOT NULL AND banner_url != '' AND banner_url LIKE '%steamstatic%')`
      )
      .all() as any[];

    for (const g of rows) {
      const deadFields: Array<'cover_url' | 'banner_url'> = [];
      if (isSteamStaticUrl(g.cover_url) && !(await isUrlHealthy(g.cover_url, opts))) {
        deadFields.push('cover_url');
      }
      if (isSteamStaticUrl(g.banner_url) && !(await isUrlHealthy(g.banner_url, opts))) {
        deadFields.push('banner_url');
      }
      if (deadFields.length === 0) continue;

      const resolved = await resolveWebCoversForGame(db, g, opts);
      if (throttleMs > 0) await sleep(throttleMs);
      if (!resolved.verified) continue; // offline: leave dead URL alone, retry next run

      const updates: Array<[string, string]> = [];
      if (deadFields.includes('cover_url') && resolved.poster) updates.push(['cover_url', resolved.poster]);
      if (deadFields.includes('banner_url') && resolved.banner) updates.push(['banner_url', resolved.banner]);
      if (updates.length === 0) continue;

      try {
        const setClause = updates.map(([col]) => `${col} = ?`).join(', ');
        db.prepare(`UPDATE games SET ${setClause}, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(
          ...updates.map(([, v]) => v),
          g.id
        );
        repaired++;
      } catch {}
    }
  } catch (err) {
    console.error('Error repairing dead steamstatic covers:', err);
  }
  return repaired;
}

/**
 * Automatically enriches all games in the database that lack cover art,
 * then repairs saved Steam CDN URLs that no longer resolve.
 * Resolution: Steam AppID (param, folder detection, curated dictionary) →
 * live steamcommunity search → verified Fastly CDN → E:\Game screenshot
 * fallback. Manually-set covers are never overwritten.
 */
export async function autoEnrichAllGameCovers(
  targetDb?: any,
  opts: LiveResolveOptions = {}
): Promise<number> {
  let db = targetDb;
  if (!db) {
    try {
      const { getDb } = require('./db.ts');
      db = getDb();
    } catch (err) {
      console.error('autoEnrichAllGameCovers: database unavailable:', err);
      return 0;
    }
  }

  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  let updated = 0;

  try {
    const games = db.prepare("SELECT id, title, exe_name, exe_path, steam_id, cover_url, banner_url FROM games WHERE cover_url IS NULL OR cover_url = ''").all() as any[];

    const updateStmt = db.prepare('UPDATE games SET cover_url = ?, banner_url = COALESCE(banner_url, ?) WHERE id = ?');
    const bannerOnlyStmt = db.prepare('UPDATE games SET banner_url = ? WHERE id = ?');

    for (const g of games) {
      const { poster, banner } = await resolveWebCoversForGame(db, g, opts);
      if (throttleMs > 0) await sleep(throttleMs);

      // Canonical URLs only — local screenshots are never auto-covers so
      // every user's library shows identical art (leaderboard-safe). Users
      // can still set personal art manually via the cover modal.
      if (poster) {
        updateStmt.run(poster, banner || poster, g.id);
        updated++;
      } else if (banner) {
        bannerOnlyStmt.run(banner, g.id);
        updated++;
      }
    }

    await repairDeadSteamStaticCovers(db, opts);
  } catch (err) {
    console.error('Error auto-enriching game covers:', err);
  }

  return updated;
}
