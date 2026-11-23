import path from 'node:path';
import fs from 'node:fs';
import electronModule from 'electron';
import { getGameById, getSetting, setSetting } from './db.ts';
import { normalizeForMatch } from './media.ts';
import type { Game, WebSaveCandidate, WebSearchSummary } from '../shared/types.js';

// Electron's net stack uses the real Chromium TLS fingerprint, which passes
// the bot checks of Bing/DuckDuckGo (verified live). Plain node fetch is the
// test fallback; tests inject fetchImpl anyway.
const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SEARCH_TIMEOUT_MS = 10000;
const PAGE_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_KEY_PREFIX = 'save_web_lookup_v1:';
const MAX_RESULT_PAGES = 3;

type FetchLike = (url: string, init?: any) => Promise<any>;

function defaultFetch(): FetchLike {
  const netFetch = electron?.net?.fetch;
  if (typeof netFetch === 'function') {
    return netFetch.bind(electron.net);
  }
  return fetch;
}

// ==========================================
// HTML → text + entities
// ==========================================

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

// Exported for tests/debugging
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\\u005c/gi, '\\');
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

// ==========================================
// Path extraction from plain text
// ==========================================

// Placeholder tokens (already normalized before extraction)
const PH_STEAM_ID = '<STEAMID>';
const PH_PATH_TO_GAME = '<PATHTOGAME>';
const PH_STEAM_FOLDER = '<STEAMFOLDER>';

function normalizePlaceholders(text: string): string {
  return text
    .replace(/<(your account id|steam ?id|user ?id|your user id|account ?id|steam id number)>/gi, PH_STEAM_ID)
    .replace(/<(path[- ]to[- ]game|game ?dir|install(ation)? ?dir(ectory)?|game folder|installed folder)>/gi, PH_PATH_TO_GAME)
    .replace(/<(steam ?folder|steam ?library|steam ?installation)>/gi, PH_STEAM_FOLDER)
    .replace(/%user ?profile%/gi, '%USERPROFILE%')
    .replace(/%app ?data%/gi, '%APPDATA%')
    .replace(/%local ?app ?data%/gi, '%LOCALAPPDATA%')
    .replace(/%program ?data%/gi, '%PROGRAMDATA%')
    .replace(/%system ?drive%/gi, '%SYSTEMDRIVE%');
}

const PATH_PREFIX =
  '(?:%USERPROFILE%|%APPDATA%|%LOCALAPPDATA%|%PROGRAMDATA%|%SYSTEMDRIVE%|' +
  '<PATHTOGAME>|<STEAMFOLDER>|' +
  '[A-Za-z]:\\\\Users|Documents\\\\|Saved Games\\\\|AppData\\\\|My Games\\\\|steamapps\\\\)';
// Space-containing segments must look like real folder names (each word
// capitalized/digit/parenthesized — "My Games", "Program Files (x86)"), so
// sentence glue like " on Windows" or " copy" is not swallowed.
const PATH_WORD = '[A-Z0-9(][A-Za-z0-9_\\-()]*';
// The space-containing (multiword) branch must come BEFORE the plain token
// branch, otherwise "Saved Games" matches as "Saved" and the rest is lost.
const PATH_SEGMENT = `(?:<STEAMID>|${PATH_WORD}(?: ${PATH_WORD}){0,4}|[A-Za-z0-9_\\-()]+)`;
// Debug helper: expose the raw pattern for tests
export const PATH_RE_SOURCE = `${PATH_PREFIX}(?:\\\\${PATH_SEGMENT}){1,7}`;
const PATH_RE = new RegExp(PATH_RE_SOURCE, 'gi');

// Sentence-glue words that snippets append to the last path segment
const TRIM_TAIL_WORDS = new Set([
  'copy', 'paste', 'that', 'this', 'the', 'a', 'an', 'on', 'in', 'into', 'and', 'or', 'to',
  'back', 'up', 'it', 'is', 'are', 'at', 'for', 'with', 'your', 'you', 'then', 'will', 'can',
  'windows', 'file', 'files', 'folder', 'explorer', 'read', 'more', 'address', 'addre',
  'stored', 'keeps', 'its', 'where', 'when', 'check', 'already', 'knows', 'of', 'from', 'as',
  'by', 'be', 'been', 'has', 'have', 'not', 'no', 'do', 'did', 'if', 'other', 'another',
  'current', 'default', 'located', 'location', 'previous', 'below', 'above', 'here', 'there',
  'whole', 'again', 'every', 'time', 'before', 'after', 'still', 'verdict', 'game',
]);
// Lowercase folder names that must never be trimmed
const KEEP_TAIL_WORDS = new Set(['saves', 'save', 'saved', 'data', 'games', 'game', 'profiles', 'settings', 'config', 'userdata', 'savegames']);

function trimTrailingGlue(segment: string): string {
  const words = segment.split(' ').filter((w) => w.length > 0);
  if (words.length <= 1) return segment;
  let cut = words.length;
  while (cut > 1) {
    const last = words[cut - 1].toLowerCase().replace(/[.:,]+$/, '');
    if (TRIM_TAIL_WORDS.has(last) && !KEEP_TAIL_WORDS.has(last)) {
      cut--;
    } else {
      break;
    }
  }
  return words.slice(0, cut).join(' ');
}

function isGlueSegment(segment: string): boolean {
  // A lone stopword segment ("copy", "on") next to a backslash is snippet glue
  const word = segment.trim().toLowerCase().replace(/[.:,]+$/, '');
  return TRIM_TAIL_WORDS.has(word) && !KEEP_TAIL_WORDS.has(word);
}

export function extractRawPaths(text: string): string[] {
  const found: string[] = [];
  const normalized = normalizePlaceholders(text);
  let match: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((match = PATH_RE.exec(normalized)) !== null) {
    if (found.length >= 40) break;
    let raw = match[0];
    if (raw.length > 200) continue;
    // Clean per-segment: trim, strip trailing punctuation, cut sentence glue.
    // A bare drive letter ("C:") must keep its colon — it IS the path syntax.
    const segments = raw
      .split('\\')
      .map((seg) => {
        const trimmed = seg.trim();
        if (/^[A-Za-z]:$/.test(trimmed)) return trimmed;
        return trimTrailingGlue(trimmed.replace(/[.,:;]+$/, ''));
      })
      .filter(
        (seg) =>
          seg.length > 0 &&
          !/^\.*$/.test(seg) &&
          !seg.startsWith('.') &&
          !isGlueSegment(seg)
      );
    if (segments.length < 2) continue; // prefix + at least one folder
    raw = segments.join('\\');
    if (raw.length >= 5 && !found.includes(raw)) {
      found.push(raw);
    }
  }
  return found;
}

// ==========================================
// Result link extraction
// ==========================================

function extractResultUrls(html: string): Array<{ url: string; domain: string }> {
  const urls: Array<{ url: string; domain: string }> = [];
  const seen = new Set<string>();

  const pushUrl = (candidate: string) => {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
      const host = parsed.hostname.replace(/^www\./, '');
      // Skip the search engines themselves and their asset/redirect hosts
      if (/^(bing|microsoft|duckduckgo|google|gstatic)\./.test(host) || /r\.bing\.com$/.test(parsed.hostname)) return;
      if (seen.has(host + parsed.pathname)) return;
      seen.add(host + parsed.pathname);
      urls.push({ url: parsed.toString(), domain: host });
    } catch {
      // not a real URL
    }
  };

  // DuckDuckGo html: class="result__a" href="//duckduckgo.com/l/?uddg=<encoded>"
  const ddgRe = /class="result__a"[^>]*href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = ddgRe.exec(html)) !== null) {
    const uddg = /[?&]uddg=([^&"]+)/.exec(m[1]);
    if (uddg) pushUrl(decodeURIComponent(uddg[1]));
  }

  // Bing: results are inside <li class="b_algo"> blocks with <a href="https://...">
  const algoRe = /class="b_algo"[\s\S]{0,600}?<a[^>]+href="(https?:\/\/[^"]+)"/g;
  while ((m = algoRe.exec(html)) !== null) {
    pushUrl(m[1]);
  }

  return urls;
}

// ==========================================
// Variable expansion → absolute paths
// ==========================================

export interface LookupEnv {
  userProfile?: string;
  appData?: string;
  localAppData?: string;
  programData?: string;
  systemDrive?: string;
  documentsDir?: string;
  savedGamesDir?: string;
  exePath?: string;
  steamFolder?: string;
}

function getEnvDirectories(options: LookupEnv): Required<Omit<LookupEnv, 'exePath' | 'steamFolder'>> & { exePath: string | null; steamFolder: string | null } {
  const profile = options.userProfile || process.env.USERPROFILE || process.env.HOME || '';
  const systemDrive = options.systemDrive || process.env.SYSTEMDRIVE || 'C:';
  return {
    userProfile: profile,
    appData: options.appData || process.env.APPDATA || path.join(profile, 'AppData', 'Roaming'),
    localAppData: options.localAppData || process.env.LOCALAPPDATA || path.join(profile, 'AppData', 'Local'),
    programData: options.programData || path.join(systemDrive, 'ProgramData'),
    systemDrive,
    documentsDir: options.documentsDir || path.join(profile, 'Documents'),
    savedGamesDir: options.savedGamesDir || path.join(profile, 'Saved Games'),
    exePath: options.exePath !== undefined ? options.exePath : null,
    steamFolder: options.steamFolder || (options.exePath && options.exePath.includes('steamapps')
      ? path.resolve(options.exePath.split('steamapps')[0])
      : path.join(systemDrive, 'Program Files (x86)', 'Steam')),
  };
}

function resolvePathToGame(exePath: string | null): string | null {
  if (!exePath) return null;
  try {
    if (!fs.existsSync(exePath)) return null;
    let dir = path.dirname(exePath);
    const launcherDirs = new Set(['bin', 'binaries', 'x64', 'win64', 'x86', 'release', 'game', 'launch']);
    for (let i = 0; i < 4; i++) {
      const base = path.basename(dir).toLowerCase();
      const parent = path.dirname(dir);
      if (launcherDirs.has(base) && parent !== dir) {
        dir = parent;
      } else {
        break;
      }
    }
    return dir;
  } catch {
    return null;
  }
}

export function expandPath(raw: string, env: ReturnType<typeof getEnvDirectories>): string | null {
  // Split into prefix + segments
  const segments = raw.split('\\');
  let prefix: string | null = null;
  let rest = segments;

  const first = segments[0];
  if (/^%USERPROFILE%$/i.test(first)) {
    prefix = env.userProfile;
    rest = segments.slice(1);
  } else if (/^%APPDATA%$/i.test(first)) {
    prefix = env.appData;
    rest = segments.slice(1);
  } else if (/^%LOCALAPPDATA%$/i.test(first)) {
    prefix = env.localAppData;
    rest = segments.slice(1);
  } else if (/^%PROGRAMDATA%$/i.test(first)) {
    prefix = env.programData;
    rest = segments.slice(1);
  } else if (/^%SYSTEMDRIVE%$/i.test(first)) {
    prefix = env.systemDrive;
    rest = segments.slice(1);
  } else if (/^<PATHTOGAME>$/i.test(first)) {
    prefix = resolvePathToGame(env.exePath);
    rest = segments.slice(1);
  } else if (/^<STEAMFOLDER>$/i.test(first)) {
    prefix = env.steamFolder;
    rest = segments.slice(1);
  } else if (/^steamapps$/i.test(first)) {
    prefix = env.steamFolder;
    rest = segments;
  } else if (/^[A-Za-z]:$/.test(first) && /^Users$/.test(segments[1] || '')) {
    // "C:\Users\Somebody\Documents\..." — the drive-letter + Users prefix spans
    // two split segments, and the snippet author's username is unknowable;
    // restart expansion from the first known folder segment.
    const restartIdx = segments.slice(2).findIndex((seg) =>
      /^(Documents|Saved Games|My Games|AppData)$/i.test(seg)
    );
    if (restartIdx === -1) return null;
    return expandPath(segments.slice(2 + restartIdx).join('\\'), env);
  } else if (/^Documents$/i.test(first)) {
    prefix = env.documentsDir;
    rest = segments.slice(1);
  } else if (/^Saved Games$/i.test(first)) {
    prefix = env.savedGamesDir;
    rest = segments.slice(1);
  } else if (/^My Games$/i.test(first)) {
    prefix = path.join(env.documentsDir, 'My Games');
    rest = segments.slice(1);
  } else if (/^AppData$/i.test(first)) {
    // "AppData\Roaming\..." or "AppData\Local\..." style
    const branch = segments[1];
    if (/^Roaming$/i.test(branch || '')) {
      prefix = env.appData;
      rest = segments.slice(2);
    } else if (/^Local$/i.test(branch || '')) {
      prefix = env.localAppData;
      rest = segments.slice(2);
    } else {
      prefix = env.userProfile;
      rest = segments;
    }
  }

  if (prefix === null || prefix === undefined) return null;

  // Placeholder handling: a trailing <STEAMID> means a per-user subfolder —
  // back up the parent instead (it contains every user's saves). Placeholders
  // anywhere else make the path unexpandable.
  const lastSegment = rest.length > 0 ? rest[rest.length - 1] : '';
  const trailingPlaceholder = /<STEAMID>|<PATHTOGAME>|<STEAMFOLDER>/i.test(lastSegment);
  if (rest.some((seg) => /<STEAMID>|<PATHTOGAME>|<STEAMFOLDER>/i.test(seg)) && !trailingPlaceholder) {
    return null; // mid-path placeholder — cannot guess the missing level
  }
  if (trailingPlaceholder && !/^<STEAMID>$/i.test(lastSegment)) {
    return null; // only <SteamID> at the end is safely collapsible to its parent
  }
  const cleanedRest = rest.filter((seg) => !/^<STEAMID>$/i.test(seg));

  let joined = prefix;
  for (const seg of cleanedRest) {
    joined = path.join(joined, seg);
  }
  // Normalize Windows separators
  joined = path.resolve(joined);

  // If the documented path ends in <SteamID> but the parent exists, prefer the parent
  if (trailingPlaceholder) {
    return joined; // parent (placeholders stripped)
  }
  return joined;
}

// ==========================================
// Main search
// ==========================================

async function fetchText(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const init = {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: controller.signal,
    };
    const resp = await fetchImpl(url, init);
    clearTimeout(timer);
    if (!resp || !resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function buildQueries(game: Game): string[] {
  const title = game.title.replace(/"/g, '').trim();
  const queries = [
    `"${title}" save game data location`,
    `"${title}" save file location PC`,
  ];
  const exeName = (game.exe_name || '').replace(/\.exe$/i, '');
  if (exeName && normalizeForMatch(exeName) !== normalizeForMatch(title)) {
    queries.push(`"${exeName}" save game data location`);
  }
  return queries.slice(0, 2);
}

function pickSourceWeight(domain: string): number {
  if (/pcgamingwiki\.com$/.test(domain)) return 3;
  if (/(wikitop|savelocation|savegame|gamepressure|techradar|pcgamer|gamespot|reddit)\./.test(domain)) return 2;
  return 1;
}

function scoreConfidence(exists: boolean, weight: number, occurrences: number): 'high' | 'medium' | 'low' {
  if (exists && (weight >= 2 || occurrences >= 2)) return 'high';
  if (exists || weight >= 3 || occurrences >= 2) return 'medium';
  return 'low';
}

/**
 * Searches the web for the save-game location of a game when local heuristics
 * find nothing. DuckDuckGo + Bing snippets and the top result pages are
 * scraped for Windows-style save paths, which are then expanded against the
 * real user directories and checked for existence.
 */
export async function searchSaveLocationsWeb(
  gameId: number,
  options: LookupEnv & { fetchImpl?: FetchLike; forceRefresh?: boolean } = {}
): Promise<WebSearchSummary> {
  const game = getGameById(gameId);
  if (!game) {
    throw new Error(`Game with id ${gameId} not found`);
  }

  const errors: string[] = [];
  const slug = normalizeForMatch(game.title);
  const cacheKey = `${CACHE_KEY_PREFIX}${slug}`;

  if (!options.forceRefresh) {
    const cachedRaw = getSetting(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (Date.now() - Number(cached?.ts || 0) < CACHE_TTL_MS) {
          return { query: cached.query, candidates: cached.candidates, cached: true, errors: [] };
        }
      } catch {
        // corrupt cache entry — fall through to a fresh search
      }
    }
  }

  const fetchImpl = options.fetchImpl || defaultFetch();
  const queries = buildQueries(game);
  const query = queries[0];

  // Fan out over engines in parallel (each result keeps its source URL)
  const engineTasks = queries.map(async (q) => {
    const encoded = encodeURIComponent(q);
    return Promise.all([
      fetchText(fetchImpl, `https://html.duckduckgo.com/html/?q=${encoded}`, SEARCH_TIMEOUT_MS).then((html) => ({
        url: 'https://html.duckduckgo.com',
        html,
      })),
      fetchText(fetchImpl, `https://www.bing.com/search?q=${encoded}&count=15`, SEARCH_TIMEOUT_MS).then((html) => ({
        url: 'https://www.bing.com',
        html,
      })),
    ]);
  });
  const engineResults = (await Promise.all(engineTasks)).flat();
  const searchPages = engineResults.filter((page): page is { url: string; html: string } => Boolean(page.html));
  if (searchPages.length === 0) {
    errors.push('Không kết nối được Bing/DuckDuckGo (mạng hoặc bị chặn)');
  }

  // Collect raw paths from snippets + result page URLs
  const rawPaths = new Map<string, { count: number; domains: Set<string>; url: string }>();
  const recordPath = (raw: string, domain: string, url: string) => {
    const existing = rawPaths.get(raw);
    if (existing) {
      existing.count++;
      existing.domains.add(domain);
      return;
    }
    rawPaths.set(raw, { count: 1, domains: new Set([domain]), url });
  };

  const resultLinks: Array<{ url: string; domain: string }> = [];
  for (const page of searchPages) {
    const links = extractResultUrls(page.html);
    for (const link of links) {
      if (!resultLinks.some((l) => l.domain === link.domain && l.url === link.url)) {
        resultLinks.push(link);
      }
    }
    // Strip tags BEFORE decoding entities: `&lt;your account id&gt;` is text,
    // but decoding first would turn it into `<your account id>` and the tag
    // stripper would delete it as if it were markup
    const text = decodeEntities(htmlToText(page.html));
    const extracted = extractRawPaths(text);
    if (process.env.GAMEVAULT_DEBUG_LOOKUP) {
      console.log('[save-lookup] page', page.url, 'links:', links.length, 'paths:', JSON.stringify(extracted));
    }
    for (const raw of extracted) {
      recordPath(raw, 'search-snippet', page.url);
    }
  }

  // Fetch the top result pages (best effort) for full, untruncated paths
  const topPages = resultLinks
    .sort((a, b) => pickSourceWeight(b.domain) - pickSourceWeight(a.domain))
    .slice(0, MAX_RESULT_PAGES);
  const pageResults = await Promise.all(
    topPages.map(async (link) => {
      const html = await fetchText(fetchImpl, link.url, PAGE_TIMEOUT_MS);
      return { link, html };
    })
  );
  for (const { link, html } of pageResults) {
    if (!html) {
      errors.push(`${link.domain}: không tải được trang`);
      continue;
    }
    const text = decodeEntities(htmlToText(html));
    for (const raw of extractRawPaths(text)) {
      recordPath(raw, link.domain, link.url);
    }
  }

  // Expand + rank
  const env = getEnvDirectories({
    exePath: game.exe_path || options.exePath,
    userProfile: options.userProfile,
    appData: options.appData,
    localAppData: options.localAppData,
    programData: options.programData,
    systemDrive: options.systemDrive,
    documentsDir: options.documentsDir,
    savedGamesDir: options.savedGamesDir,
    steamFolder: options.steamFolder,
  });

  const candidates: WebSaveCandidate[] = [];
  const seenResolved = new Set<string>();
  for (const [raw, meta] of rawPaths) {
    const resolved = expandPath(raw, env);
    const hasPlaceholder = /<STEAMID>|<PATHTOGAME>|<STEAMFOLDER>/i.test(raw);
    if (process.env.GAMEVAULT_DEBUG_LOOKUP) {
      console.log('[save-lookup] raw-segments:', JSON.stringify(raw.split('\\')), '→ resolved:', JSON.stringify(resolved));
    }
    // Snippet-only paths that neither resolve nor carry a documented
    // placeholder are regex noise — drop them
    if (meta.domains.size === 1 && meta.domains.has('search-snippet') && !resolved && !hasPlaceholder) continue;
    const dedupeKey = (resolved || raw).toLowerCase();
    if (seenResolved.has(dedupeKey)) continue;
    seenResolved.add(dedupeKey);

    const domain = Array.from(meta.domains).find((d) => d !== 'search-snippet') || 'search-snippet';
    const exists = resolved ? fs.existsSync(resolved) : false;
    const weight = Math.max(...Array.from(meta.domains).map(pickSourceWeight));
    candidates.push({
      rawPath: raw,
      resolvedPath: resolved || raw,
      exists,
      source: domain,
      url: meta.url,
      confidence: scoreConfidence(exists, weight, meta.count),
      // expandPath returns null exactly when the path still carries an
      // unexpandable placeholder — those are display-only hints
      selectable: resolved !== null,
    });
  }

  const confidenceRank = { high: 0, medium: 1, low: 2 };
  candidates.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    const rankDiff = confidenceRank[a.confidence] - confidenceRank[b.confidence];
    if (rankDiff !== 0) return rankDiff;
    return a.rawPath.length - b.rawPath.length;
  });
  const top = candidates.slice(0, 15);

  const summary: WebSearchSummary = { query, candidates: top, cached: false, errors };

  try {
    setSetting(cacheKey, JSON.stringify({ ts: Date.now(), query, candidates: top }));
  } catch {
    // caching is best-effort
  }

  return summary;
}
