import fs from 'node:fs';
import path from 'node:path';
import { getDbDir } from './db.ts';

export const DISCORD_DETECTABLE_API_URL = 'https://discord.com/api/v10/applications/detectable';
export const DISCORD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generic executable names that are shared by many unrelated games/engines
 * and must NEVER be matched by filename alone without subpath, parent folder,
 * or PE title disambiguation.
 */
export const GENERIC_GAME_EXE_NAMES = new Set([
  'game.exe',
  'client.exe',
  'launcher.exe',
  'start.exe',
  'play.exe',
  'main.exe',
  'app.exe',
  'bin.exe',
  'shipping.exe',
  'engine.exe',
  'server.exe',
  'editor.exe',
  'win64-shipping.exe',
  'win32-shipping.exe',
]);

/** Non-game titles that sometimes appear in Discord's detectable list */
const DISCORD_NON_GAME_TITLE_REGEX =
  /^(?:antigravity(?:\s*-?\s*x\s*64)?|m\s*remote\s*ng|putty(?:\s*ng)?|ultra\s*viewer(?:[_\s]*desktop)?|visual\s*studio\s*code|cursor|windsurf|google\s*drive.*|riot\s*client.*|league\s*client.*|discord.*|spotify|vlc|ollama|blender|obs\s*studio|streamlabs.*|photoshop|premiere\s*pro|after\s*effects|crosshair(?:\s*v\d+)?)$/i;

export interface CompactDiscordApp {
  id: string;
  name: string;
  aliases?: string[];
  steamId?: number;
  exes: string[];
}

export interface DiscordDetectableCacheFile {
  version: number;
  updatedAt: number;
  entries: CompactDiscordApp[];
}

export interface DiscordMatchResult {
  id: string;
  title: string;
  steamId: number | null;
  confidence: 'subpath' | 'exe' | 'disambiguated';
}

interface IndexedRule {
  app: CompactDiscordApp;
  pattern: string;
  hasSubpath: boolean;
}

type FetchLike = typeof fetch;

let cachePathOverride: string | null = null;
let fetchOverride: FetchLike | null = null;
let loadedFromDisk = false;
let cacheUpdatedAt = 0;
let syncPromise: Promise<boolean> | null = null;

let byBasename = new Map<string, IndexedRule[]>();

export function configureDiscordDetectable(options: {
  cachePath?: string | null;
  fetchImpl?: FetchLike | null;
} = {}): void {
  if (options.cachePath !== undefined) {
    cachePathOverride = options.cachePath;
    loadedFromDisk = false;
  }
  if (options.fetchImpl !== undefined) {
    fetchOverride = options.fetchImpl;
  }
}

export function getDiscordDetectableCachePath(): string {
  if (cachePathOverride) return cachePathOverride;
  return path.join(getDbDir(), 'discord-detectable-cache.json');
}

function normalizeAlphaNum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeExePattern(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function isGenericExeName(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (GENERIC_GAME_EXE_NAMES.has(lower)) return true;
  if (lower.endsWith('-win64-shipping.exe') || lower.endsWith('-win32-shipping.exe')) {
    return true;
  }
  return false;
}

/**
 * Compacts raw Discord `/applications/detectable` payload into a small,
 * Windows-only lookup list excluding launchers and known non-game apps.
 */
export function compactDiscordApplications(rawList: unknown): CompactDiscordApp[] {
  if (!Array.isArray(rawList)) return [];
  const result: CompactDiscordApp[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, any>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const id = typeof raw.id === 'string' ? raw.id.trim() : String(raw.id || '');
    if (!name || !id) continue;
    if (DISCORD_NON_GAME_TITLE_REGEX.test(name)) continue;

    if (!Array.isArray(raw.executables)) continue;
    const exeSet = new Set<string>();
    for (const exe of raw.executables) {
      if (!exe || typeof exe !== 'object') continue;
      if (exe.os !== 'win32') continue;
      if (exe.is_launcher === true) continue;
      if (typeof exe.name !== 'string') continue;
      const pattern = normalizeExePattern(exe.name);
      if (!pattern.endsWith('.exe')) continue;
      exeSet.add(pattern);
    }

    if (exeSet.size === 0) continue;

    let steamId: number | undefined;
    if (Array.isArray(raw.third_party_skus)) {
      for (const sku of raw.third_party_skus) {
        if (sku && sku.distributor === 'steam' && sku.id) {
          const parsed = Number(sku.id);
          if (Number.isInteger(parsed) && parsed > 0) {
            steamId = parsed;
            break;
          }
        }
      }
    }

    const aliases = Array.isArray(raw.aliases)
      ? raw.aliases.filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0)
      : undefined;

    result.push({
      id,
      name,
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
      ...(steamId ? { steamId } : {}),
      exes: Array.from(exeSet),
    });
  }

  return result;
}

/** Rebuilds the in-memory basename index from a compacted list. */
export function setDiscordDetectableEntries(entries: CompactDiscordApp[], updatedAt = Date.now()): void {
  const nextMap = new Map<string, IndexedRule[]>();

  for (const app of entries) {
    for (const pattern of app.exes) {
      const normalized = normalizeExePattern(pattern);
      if (!normalized.endsWith('.exe')) continue;
      const slashIdx = normalized.lastIndexOf('/');
      const basename = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
      const hasSubpath = slashIdx >= 0;

      let bucket = nextMap.get(basename);
      if (!bucket) {
        bucket = [];
        nextMap.set(basename, bucket);
      }
      bucket.push({ app, pattern: normalized, hasSubpath });
    }
  }

  byBasename = nextMap;
  cacheUpdatedAt = updatedAt;
  loadedFromDisk = true;
}

export function clearDiscordDetectableIndex(): void {
  byBasename = new Map();
  cacheUpdatedAt = 0;
  loadedFromDisk = false;
}

export function getDiscordDetectableStats(): {
  ruleCount: number;
  basenameCount: number;
  updatedAt: number;
} {
  let ruleCount = 0;
  for (const list of byBasename.values()) {
    ruleCount += list.length;
  }
  return {
    ruleCount,
    basenameCount: byBasename.size,
    updatedAt: cacheUpdatedAt,
  };
}

/** Synchronously loads the local Discord cache file if present. */
export function loadDiscordDetectableCacheFromDisk(): boolean {
  if (loadedFromDisk) return byBasename.size > 0;
  loadedFromDisk = true;
  try {
    const cachePath = getDiscordDetectableCachePath();
    if (!fs.existsSync(cachePath)) return false;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as DiscordDetectableCacheFile;
    if (!parsed || !Array.isArray(parsed.entries)) return false;
    setDiscordDetectableEntries(parsed.entries, Number(parsed.updatedAt) || 0);
    return byBasename.size > 0;
  } catch {
    return false;
  }
}

/**
 * Fetches Discord's public detectable applications list, compacts it,
 * writes it atomically to disk, and refreshes the in-memory index.
 */
export async function syncDiscordDetectableCache(options: {
  force?: boolean;
  maxAgeMs?: number;
  timeoutMs?: number;
} = {}): Promise<boolean> {
  loadDiscordDetectableCacheFromDisk();
  const maxAgeMs = options.maxAgeMs ?? DISCORD_CACHE_MAX_AGE_MS;
  if (!options.force && cacheUpdatedAt > 0 && Date.now() - cacheUpdatedAt < maxAgeMs && byBasename.size > 0) {
    return true;
  }
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      const doFetch = fetchOverride || fetch;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
      let resp: Response;
      try {
        resp = await doFetch(DISCORD_DETECTABLE_API_URL, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!resp.ok) return false;
      const raw = await resp.json();
      const entries = compactDiscordApplications(raw);
      if (entries.length === 0) return false;

      const updatedAt = Date.now();
      const payload: DiscordDetectableCacheFile = {
        version: 1,
        updatedAt,
        entries,
      };

      const cachePath = getDiscordDetectableCachePath();
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const tmpPath = `${cachePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmpPath, cachePath);

      setDiscordDetectableEntries(entries, updatedAt);
      return true;
    } catch {
      return false;
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

/** Initializes the local cache and triggers a background refresh if stale/missing. */
export function initDiscordDetectable(): void {
  loadDiscordDetectableCacheFromDisk();
  syncDiscordDetectableCache().catch(() => {});
}

function doesAppMatchContext(app: CompactDiscordApp, contextStrings: string[]): boolean {
  if (contextStrings.length === 0) return false;
  const candidates = [app.name, ...(app.aliases || [])]
    .map(normalizeAlphaNum)
    .filter((s) => s.length >= 3);
  if (candidates.length === 0) return false;

  for (const ctx of contextStrings) {
    const normCtx = normalizeAlphaNum(ctx);
    if (normCtx.length < 3) continue;
    for (const cand of candidates) {
      if (normCtx === cand || normCtx.includes(cand) || cand.includes(normCtx)) {
        return true;
      }
    }
  }
  return false;
}

function collectContextStrings(exePath?: string | null, cleanTitle?: string | null): string[] {
  const contexts: string[] = [];
  if (cleanTitle && cleanTitle.trim()) {
    contexts.push(cleanTitle.trim());
  }
  if (exePath) {
    const parts = path.normalize(exePath).split(path.sep).filter(Boolean);
    // Parent folder and grandparent folder (handles e.g. GameTitle/bin/win64/Game.exe)
    for (let i = parts.length - 2; i >= Math.max(0, parts.length - 4); i--) {
      const seg = parts[i];
      if (!seg || /^[a-zA-Z]:$/.test(seg)) continue;
      if (/^(?:bin|x64|x86|win64|win32|binaries|retail|_retail_|game|client)$/i.test(seg)) continue;
      contexts.push(seg);
    }
  }
  return contexts;
}

function pickUniqueApp(rules: IndexedRule[]): CompactDiscordApp | null {
  const unique = new Map<string, CompactDiscordApp>();
  for (const r of rules) {
    unique.set(r.app.id, r.app);
  }
  if (unique.size === 1) {
    return unique.values().next().value || null;
  }
  return null;
}

/**
 * Matches a running Windows executable against the cached Discord Detectable list.
 * Avoids false positives on generic names (`Game.exe`, `Client.exe`, etc.) by
 * requiring subpath, parent folder, or PE title disambiguation.
 */
export function matchDiscordDetectableGame(
  foregroundExe: string,
  exePath?: string | null,
  cleanTitle?: string | null
): DiscordMatchResult | null {
  if (!foregroundExe) return null;
  loadDiscordDetectableCacheFromDisk();
  if (byBasename.size === 0) return null;

  const base = path.basename(foregroundExe.trim()).toLowerCase();
  if (!base.endsWith('.exe')) return null;

  const rules = byBasename.get(base);
  if (!rules || rules.length === 0) return null;

  const normalizedFullPath = exePath ? normalizeExePattern(exePath) : null;
  const contexts = collectContextStrings(exePath, cleanTitle);

  // 1. Subpath match (e.g. "_retail_/wow.exe" or "bin/x64/witcher3.exe")
  if (normalizedFullPath) {
    const subpathMatches = rules.filter(
      (r) => r.hasSubpath && normalizedFullPath.endsWith(`/${r.pattern}`)
    );
    if (subpathMatches.length > 0) {
      const uniqueSubpathApp = pickUniqueApp(subpathMatches);
      if (uniqueSubpathApp) {
        return {
          id: uniqueSubpathApp.id,
          title: uniqueSubpathApp.name,
          steamId: uniqueSubpathApp.steamId ?? null,
          confidence: 'subpath',
        };
      }
      const contextMatched = subpathMatches.find((r) => doesAppMatchContext(r.app, contexts));
      if (contextMatched) {
        return {
          id: contextMatched.app.id,
          title: contextMatched.app.name,
          steamId: contextMatched.app.steamId ?? null,
          confidence: 'disambiguated',
        };
      }
    }
  }

  // 2. Basename match (for rules without a required subpath, or when exePath is unavailable)
  const basenameRules = normalizedFullPath ? rules.filter((r) => !r.hasSubpath) : rules;
  const uniqueApp = pickUniqueApp(basenameRules);
  if (uniqueApp && !isGenericExeName(base)) {
    return {
      id: uniqueApp.id,
      title: uniqueApp.name,
      steamId: uniqueApp.steamId ?? null,
      confidence: 'exe',
    };
  }

  // 3. Ambiguous or generic exe name: require parent folder or PE title disambiguation
  const disambiguated = basenameRules.find((r) => doesAppMatchContext(r.app, contexts));
  if (disambiguated) {
    return {
      id: disambiguated.app.id,
      title: disambiguated.app.name,
      steamId: disambiguated.app.steamId ?? null,
      confidence: 'disambiguated',
    };
  }

  return null;
}
