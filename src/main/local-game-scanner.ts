import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import {
  createGame,
  getDb,
  setManualPlaytime,
  updateGame,
} from './db.ts';
import { canImportDeviceHistory } from './account-library.ts';
import { autoEnrichAllGameCovers, detectSteamAppIdCached } from './covers.ts';
import { matchDiscordDetectableGame } from './discord-detectable.ts';
import { DEFAULT_AMD_DB_PATH, extractTitleFromExe } from './importer.ts';
import {
  INSTALLER_OR_TOOL_EXE_REGEX,
  KNOWN_LAUNCHER_OR_CLIENT_REGEX,
  NON_GAME_TITLE_REGEX,
  hasElectronOrDesktopAppFingerprint,
  isIgnoredDesktopPath,
  isLikelyGame,
} from './tracker.ts';
import type { Game, LocalGameScanSource, LocalGameScanSummary } from '../shared/types.js';

const execFileAsync = promisify(execFile);

export interface ScannedGameCandidate {
  title: string;
  exeName?: string | null;
  exePath?: string | null;
  steamId?: number | null;
  playtimeMinutes: number;
  sources: LocalGameScanSource[];
}

export interface LocalGameScanOptions {
  targetDb?: DatabaseSync;
  steamRoot?: string | null;
  steamUserdataDir?: string | null;
  epicManifestsDir?: string | null;
  gogDbPath?: string | null;
  riotInstallsPath?: string | null;
  xboxDirs?: string[];
  amdDbPath?: string | null;
  includeWindowsGameConfigStore?: boolean;
  windowsExeCandidates?: string[];
  enrichCovers?: boolean;
}

const SKIP_STEAM_APP_IDS = new Set<number>([
  228980,  // Steamworks Common Redistributables
  250820,  // SteamVR
  218,     // Source SDK Base 2007
  1070560, // Steam Linux Runtime - Soldier
  1391110, // Steam Linux Runtime - Sniper
  1493710, // Proton Experimental
  1628350, // Steam Linux Runtime - Scout
  1826330, // Proton EasyAntiCheat Runtime
]);

const SKIP_STEAM_TITLE_REGEX = /^(?:steamworks\s+common|proton\s|steam\s+linux\s+runtime|steamvr\b|source\s+sdk)/i;

function normalizeTitleKey(title: string): string {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isUtilityExeOrTitle(title: string, exePath?: string | null): boolean {
  const cleanTitle = (title || '').trim();
  const lowerTitle = cleanTitle.toLowerCase();
  const lowerExe = (exePath || '').toLowerCase();
  const exeBase = exePath ? path.basename(exePath) : '';

  if (
    !cleanTitle ||
    NON_GAME_TITLE_REGEX.test(cleanTitle) ||
    lowerTitle.includes('codex_retention_probe') ||
    lowerTitle.includes('crash handler') ||
    lowerTitle.includes('streaming_client') ||
    lowerTitle.includes('remote play client') ||
    lowerTitle.includes('discord system helper')
  ) {
    return true;
  }

  if (exeBase && (KNOWN_LAUNCHER_OR_CLIENT_REGEX.test(exeBase) || INSTALLER_OR_TOOL_EXE_REGEX.test(exeBase))) {
    return true;
  }

  if (exePath && (isIgnoredDesktopPath(exePath) || hasElectronOrDesktopAppFingerprint(exePath))) {
    return true;
  }

  if (
    lowerExe.includes('crashhandler') ||
    lowerExe.includes('amdrssrc') ||
    lowerExe.includes('riotclient') ||
    lowerExe.includes('streaming_client')
  ) {
    return true;
  }

  return false;
}

/**
 * Parses Valve KeyValues (VDF / ACF) text into a nested plain object.
 * Keys are stored in lowercase at each level for case-insensitive lookup.
 */
export function parseVdfText(content: string): Record<string, any> {
  const root: Record<string, any> = {};
  const stack: Array<Record<string, any>> = [root];
  let i = 0;
  const len = content.length;

  const skipWhitespaceAndComments = () => {
    while (i < len) {
      const ch = content[i];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        i++;
      } else if (ch === '/' && content[i + 1] === '/') {
        while (i < len && content[i] !== '\n') i++;
      } else {
        break;
      }
    }
  };

  const readToken = (): string | null => {
    skipWhitespaceAndComments();
    if (i >= len) return null;
    const ch = content[i];
    if (ch === '{' || ch === '}') {
      i++;
      return ch;
    }
    if (ch === '"') {
      i++;
      let out = '';
      while (i < len) {
        const c = content[i++];
        if (c === '\\' && i < len) {
          const next = content[i++];
          if (next === 'n') out += '\n';
          else if (next === 't') out += '\t';
          else out += next;
        } else if (c === '"') {
          break;
        } else {
          out += c;
        }
      }
      return out;
    }
    let out = '';
    while (i < len) {
      const c = content[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '{' || c === '}') {
        break;
      }
      out += c;
      i++;
    }
    return out;
  };

  let pendingKey: string | null = null;
  while (i < len) {
    const token = readToken();
    if (token === null) break;
    if (token === '{') {
      const child: Record<string, any> = {};
      if (pendingKey !== null) {
        const parent = stack[stack.length - 1];
        parent[pendingKey.toLowerCase()] = child;
        pendingKey = null;
      }
      stack.push(child);
    } else if (token === '}') {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
    } else if (pendingKey === null) {
      pendingKey = token;
    } else {
      const current = stack[stack.length - 1];
      current[pendingKey.toLowerCase()] = token;
      pendingKey = null;
    }
  }

  return root;
}

async function queryWindowsRegistryValue(keyPath: string, valueName: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'reg.exe',
      ['query', keyPath, '/v', valueName],
      { timeout: 1500, windowsHide: true }
    );
    const lines = String(stdout || '').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*\S+\s+REG_\w+\s+(.+?)\s*$/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch {}
  return null;
}

async function resolveSteamRoot(overrideRoot?: string | null): Promise<string | null> {
  if (overrideRoot !== undefined) {
    return overrideRoot && fs.existsSync(overrideRoot) ? overrideRoot : null;
  }

  const regCandidates = [
    await queryWindowsRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await queryWindowsRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    await queryWindowsRegistryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
  ];
  for (const candidate of regCandidates) {
    if (candidate) {
      const normalized = path.normalize(candidate);
      if (fs.existsSync(normalized)) return normalized;
    }
  }

  const fallbackRoots = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
  ];
  for (const candidate of fallbackRoots) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findBestGameExecutable(installPath: string, gameTitle: string): string | null {
  if (!installPath || !fs.existsSync(installPath)) return null;

  const titleTokens = normalizeTitleKey(gameTitle);
  const candidates: Array<{ exePath: string; score: number; size: number }> = [];

  const scanDir = (dir: string, depth: number) => {
    if (depth > 2 || candidates.length >= 40) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (candidates.length >= 40) break;
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (/^(?:_commonredist|redist|directx|dotnet|vcredist|easyanticheat|battleye|support|docs|soundtrack|artbook|extras)$/i.test(ent.name)) {
          continue;
        }
        scanDir(fullPath, depth + 1);
        continue;
      }
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.exe')) continue;
      if (INSTALLER_OR_TOOL_EXE_REGEX.test(ent.name) || KNOWN_LAUNCHER_OR_CLIENT_REGEX.test(ent.name)) continue;
      if (/(?:crash|report|redist|dxweb|unins|launcher|config|settings|editor|dedicatedserver|server)/i.test(ent.name)) {
        continue;
      }

      let size = 0;
      try {
        size = fs.statSync(fullPath).size;
      } catch {}
      const baseNorm = normalizeTitleKey(ent.name.replace(/\.exe$/i, ''));
      let score = depth === 0 ? 30 : depth === 1 ? 15 : 5;
      if (ent.name.toLowerCase().endsWith('-win64-shipping.exe')) score += 40;
      if (titleTokens && baseNorm && (baseNorm.includes(titleTokens) || titleTokens.includes(baseNorm))) {
        score += 50;
      }
      candidates.push({ exePath: fullPath, score, size });
    }
  };

  scanDir(installPath, 0);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score || b.size - a.size);
  return candidates[0].exePath;
}

function readSteamLocalPlaytimeMap(steamRoot: string, overrideUserdataDir?: string | null): Map<number, number> {
  const playtimeMap = new Map<number, number>();
  const userdataDir = overrideUserdataDir !== undefined
    ? overrideUserdataDir
    : path.join(steamRoot, 'userdata');
  if (!userdataDir || !fs.existsSync(userdataDir)) return playtimeMap;

  let userDirs: fs.Dirent[] = [];
  try {
    userDirs = fs.readdirSync(userdataDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return playtimeMap;
  }

  let latestConfigPath: string | null = null;
  let latestMtime = -1;
  for (const dir of userDirs) {
    const candidate = path.join(userdataDir, dir.name, 'config', 'localconfig.vdf');
    try {
      if (!fs.existsSync(candidate)) continue;
      const mtime = fs.statSync(candidate).mtimeMs;
      if (mtime > latestMtime) {
        latestMtime = mtime;
        latestConfigPath = candidate;
      }
    } catch {}
  }

  if (!latestConfigPath) return playtimeMap;

  try {
    const raw = fs.readFileSync(latestConfigPath, 'utf8');
    const parsed = parseVdfText(raw);
    const apps = parsed?.userlocalconfigstore?.software?.valve?.steam?.apps;
    if (apps && typeof apps === 'object') {
      for (const [appIdStr, info] of Object.entries(apps)) {
        const appId = parseInt(appIdStr, 10);
        if (!Number.isFinite(appId) || appId <= 0 || !info || typeof info !== 'object') continue;
        const mins = parseInt(String((info as any).playtime ?? '0'), 10);
        if (Number.isFinite(mins) && mins > 0) {
          playtimeMap.set(appId, mins);
        }
      }
    }
  } catch {}

  return playtimeMap;
}

/**
 * Scans locally installed Steam games (libraryfolders.vdf + appmanifest_*.acf)
 * and reads local playtime minutes from Steam's localconfig.vdf when available.
 */
export async function scanSteamGames(options: LocalGameScanOptions = {}): Promise<ScannedGameCandidate[]> {
  const steamRoot = await resolveSteamRoot(options.steamRoot);
  if (!steamRoot) return [];

  const libraryPaths = new Set<string>([path.normalize(steamRoot)]);
  const libVdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(libVdfPath)) {
    try {
      const parsed = parseVdfText(fs.readFileSync(libVdfPath, 'utf8'));
      const folders = parsed?.libraryfolders || {};
      for (const value of Object.values(folders)) {
        if (value && typeof value === 'object' && typeof (value as any).path === 'string') {
          libraryPaths.add(path.normalize((value as any).path));
        } else if (typeof value === 'string' && /^[a-zA-Z]:[\\/]/.test(value)) {
          libraryPaths.add(path.normalize(value));
        }
      }
    } catch {}
  }

  const playtimeMap = readSteamLocalPlaytimeMap(steamRoot, options.steamUserdataDir);
  const results: ScannedGameCandidate[] = [];

  for (const libPath of libraryPaths) {
    const steamAppsDir = path.join(libPath, 'steamapps');
    if (!fs.existsSync(steamAppsDir)) continue;

    let files: string[] = [];
    try {
      files = fs.readdirSync(steamAppsDir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const parsed = parseVdfText(fs.readFileSync(path.join(steamAppsDir, file), 'utf8'));
        const appState = parsed?.appstate;
        if (!appState || typeof appState !== 'object') continue;

        const steamId = parseInt(String(appState.appid || ''), 10);
        const title = String(appState.name || '').trim();
        const installDir = String(appState.installdir || '').trim();
        if (!Number.isFinite(steamId) || steamId <= 0 || !title || !installDir) continue;
        if (SKIP_STEAM_APP_IDS.has(steamId) || SKIP_STEAM_TITLE_REGEX.test(title)) continue;

        const installPath = path.join(steamAppsDir, 'common', installDir);
        if (!fs.existsSync(installPath)) continue;

        const exePath = findBestGameExecutable(installPath, title);
        const exeName = exePath ? path.basename(exePath) : null;
        if (isUtilityExeOrTitle(title, exePath)) continue;

        results.push({
          title,
          exeName,
          exePath,
          steamId,
          playtimeMinutes: playtimeMap.get(steamId) || 0,
          sources: ['steam'],
        });
      } catch {}
    }
  }

  return results;
}

/**
 * Scans Epic Games Launcher manifests (*.item).
 */
export function scanEpicGames(options: LocalGameScanOptions = {}): ScannedGameCandidate[] {
  const manifestsDir = options.epicManifestsDir !== undefined
    ? options.epicManifestsDir
    : path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  if (!manifestsDir || !fs.existsSync(manifestsDir)) return [];

  let files: string[] = [];
  try {
    files = fs.readdirSync(manifestsDir).filter((f) => f.toLowerCase().endsWith('.item'));
  } catch {
    return [];
  }

  const results: ScannedGameCandidate[] = [];
  for (const file of files) {
    try {
      const item = JSON.parse(fs.readFileSync(path.join(manifestsDir, file), 'utf8'));
      if (!item || item.bIsIncompleteInstall) continue;
      const appName = String(item.AppName || '').trim();
      if (appName.startsWith('UE_')) continue;

      const title = String(item.DisplayName || '').trim();
      const installLocation = String(item.InstallLocation || '').trim();
      if (!title || !installLocation || !fs.existsSync(installLocation)) continue;

      const launchRel = String(item.LaunchExecutable || '').trim();
      const candidateExe = launchRel ? path.join(installLocation, launchRel) : null;
      const exePath = candidateExe && fs.existsSync(candidateExe)
        ? candidateExe
        : findBestGameExecutable(installLocation, title);
      const exeName = exePath ? path.basename(exePath) : null;

      if (isUtilityExeOrTitle(title, exePath)) continue;

      results.push({
        title,
        exeName,
        exePath,
        steamId: null,
        playtimeMinutes: 0,
        sources: ['epic'],
      });
    } catch {}
  }

  return results;
}

/**
 * Scans GOG Galaxy local database (galaxy-2.0.db) for installed games & playtime.
 */
export function scanGogGames(options: LocalGameScanOptions = {}): ScannedGameCandidate[] {
  const gogDbPath = options.gogDbPath !== undefined
    ? options.gogDbPath
    : path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db');
  if (!gogDbPath || !fs.existsSync(gogDbPath)) return [];

  let gogDb: DatabaseSync | null = null;
  try {
    gogDb = new DatabaseSync(gogDbPath, { readOnly: true });

    let installed: Array<{ productId: number; installationPath: string }> = [];
    try {
      installed = gogDb.prepare('SELECT productId, installationPath FROM InstalledBaseProducts').all() as any[];
    } catch {
      installed = [];
    }
    if (installed.length === 0) return [];

    const titleByProductId = new Map<number, string>();
    try {
      const rows = gogDb.prepare('SELECT productId, title FROM LimitedDetails').all() as any[];
      for (const r of rows) {
        if (r?.productId && r?.title) titleByProductId.set(Number(r.productId), String(r.title).trim());
      }
    } catch {}

    const exeByProductId = new Map<number, string>();
    try {
      const rows = gogDb.prepare(`
        SELECT pt.gameReleaseKey AS releaseKey, ptlp.executablePath AS exePath
        FROM PlayTasks pt
        JOIN PlayTaskLaunchParameters ptlp ON ptlp.playTaskId = pt.id
        WHERE pt.isPrimary = 1
      `).all() as any[];
      for (const r of rows) {
        const match = String(r?.releaseKey || '').match(/(\d+)$/);
        if (match && r?.exePath) {
          exeByProductId.set(Number(match[1]), String(r.exePath));
        }
      }
    } catch {}

    const minutesByProductId = new Map<number, number>();
    try {
      const rows = gogDb.prepare('SELECT releaseKey, minutesInGame FROM GameTimes').all() as any[];
      for (const r of rows) {
        const match = String(r?.releaseKey || '').match(/(\d+)$/);
        const mins = Number(r?.minutesInGame) || 0;
        if (match && mins > 0) {
          const pid = Number(match[1]);
          minutesByProductId.set(pid, Math.max(minutesByProductId.get(pid) || 0, Math.round(mins)));
        }
      }
    } catch {}

    const results: ScannedGameCandidate[] = [];
    for (const row of installed) {
      const productId = Number(row.productId);
      const installPath = String(row.installationPath || '').trim();
      if (!installPath || !fs.existsSync(installPath)) continue;

      const rawExe = exeByProductId.get(productId);
      const candidateExe = rawExe
        ? (path.isAbsolute(rawExe) ? rawExe : path.join(installPath, rawExe))
        : null;
      let title = titleByProductId.get(productId) || path.basename(installPath);
      const exePath = candidateExe && fs.existsSync(candidateExe)
        ? candidateExe
        : findBestGameExecutable(installPath, title);
      if (!titleByProductId.has(productId) && exePath) {
        title = extractTitleFromExe(exePath);
      }
      if (!title || isUtilityExeOrTitle(title, exePath)) continue;

      results.push({
        title,
        exeName: exePath ? path.basename(exePath) : null,
        exePath,
        steamId: null,
        playtimeMinutes: minutesByProductId.get(productId) || 0,
        sources: ['gog'],
      });
    }

    return results;
  } catch {
    return [];
  } finally {
    if (gogDb) {
      try { gogDb.close(); } catch {}
    }
  }
}

/**
 * Scans Riot Games installations from RiotClientInstalls.json.
 */
export function scanRiotGames(options: LocalGameScanOptions = {}): ScannedGameCandidate[] {
  const installsPath = options.riotInstallsPath !== undefined
    ? options.riotInstallsPath
    : path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Riot Games', 'RiotClientInstalls.json');
  if (!installsPath || !fs.existsSync(installsPath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(installsPath, 'utf8'));
    const associated = parsed?.associated_client;
    if (!associated || typeof associated !== 'object') return [];

    const results: ScannedGameCandidate[] = [];
    for (const rawTarget of Object.keys(associated)) {
      const targetPath = path.normalize(rawTarget);
      if (!fs.existsSync(targetPath)) continue;

      const lower = targetPath.toLowerCase();
      if (lower.includes('riot client')) continue;

      let title = '';
      let exePath: string | null = null;
      if (lower.includes('valorant')) {
        title = 'VALORANT';
        const shipping = path.join(targetPath, 'ShooterGame', 'Binaries', 'Win64', 'VALORANT-Win64-Shipping.exe');
        if (fs.existsSync(shipping)) exePath = shipping;
      } else if (lower.includes('league of legends')) {
        title = 'League of Legends';
        const lolExe = path.join(targetPath, 'Game', 'League of Legends.exe');
        if (fs.existsSync(lolExe)) exePath = lolExe;
      } else {
        const cleanDir = targetPath.replace(/[\\/]live[\\/]?$/i, '');
        title = path.basename(cleanDir);
      }

      if (!exePath) {
        exePath = findBestGameExecutable(targetPath, title);
      }
      if (!title || isUtilityExeOrTitle(title, exePath)) continue;

      results.push({
        title,
        exeName: exePath ? path.basename(exePath) : null,
        exePath,
        steamId: null,
        playtimeMinutes: 0,
        sources: ['riot'],
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Scans Xbox / Microsoft Store PC games under <Drive>:\XboxGames.
 */
export function scanXboxGames(options: LocalGameScanOptions = {}): ScannedGameCandidate[] {
  const roots = options.xboxDirs !== undefined
    ? options.xboxDirs
    : ['C', 'D', 'E', 'F', 'G', 'H'].map((d) => `${d}:\\XboxGames`).filter((p) => fs.existsSync(p));

  const results: ScannedGameCandidate[] = [];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    let gameFolders: fs.Dirent[] = [];
    try {
      gameFolders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }

    for (const folder of gameFolders) {
      const contentDir = path.join(root, folder.name, 'Content');
      const configPath = path.join(contentDir, 'MicrosoftGame.Config');
      if (!fs.existsSync(configPath)) continue;

      try {
        const xml = fs.readFileSync(configPath, 'utf8');
        const dispMatch = xml.match(/DefaultDisplayName\s*=\s*"([^"]+)"/i);
        const rawDisplay = dispMatch?.[1]?.trim() || '';
        const title = rawDisplay && !rawDisplay.startsWith('ms-resource:')
          ? rawDisplay
          : folder.name.trim();

        const exeMatch = xml.match(/<Executable\b[^>]*\bName\s*=\s*"([^"]+\.exe)"/i);
        const exeRel = exeMatch?.[1]?.trim();
        const candidateExe = exeRel ? path.join(contentDir, exeRel) : null;
        const exePath = candidateExe && fs.existsSync(candidateExe)
          ? candidateExe
          : findBestGameExecutable(contentDir, title);

        if (!title || isUtilityExeOrTitle(title, exePath)) continue;

        results.push({
          title,
          exeName: exePath ? path.basename(exePath) : null,
          exePath,
          steamId: null,
          playtimeMinutes: 0,
          sources: ['xbox'],
        });
      } catch {}
    }
  }

  return results;
}

/**
 * Scans AMD Adrenalin's RGStats.db + gmdb.blb in read-only mode to recover
 * previously played games and lifetime minutes as personal baseline playtime.
 */
export function scanAmdInstalledGames(options: LocalGameScanOptions = {}): ScannedGameCandidate[] {
  const amdDbPath = options.amdDbPath !== undefined ? options.amdDbPath : DEFAULT_AMD_DB_PATH;
  if (!amdDbPath || !fs.existsSync(amdDbPath)) return [];

  let amdDb: DatabaseSync | null = null;
  let rawGames: any[] = [];
  try {
    amdDb = new DatabaseSync(amdDbPath, { readOnly: true });
    rawGames = amdDb.prepare('SELECT Title, ExePath, SteamID, PlayTotal FROM InstalledGames').all() as any[];
  } catch {
    rawGames = [];
  } finally {
    if (amdDb) {
      try { amdDb.close(); } catch {}
    }
  }

  if (rawGames.length === 0) return [];

  const blbMap = new Map<string, number>();
  try {
    const blbPath = path.join(path.dirname(amdDbPath), 'gmdb.blb');
    if (fs.existsSync(blbPath)) {
      const blbJson = JSON.parse(fs.readFileSync(blbPath, 'utf8'));
      if (Array.isArray(blbJson?.games)) {
        for (const bg of blbJson.games) {
          const t = String(bg?.title || '').toLowerCase().trim();
          const mins = parseInt(bg?.total_played_mins, 10) || 0;
          if (t && mins > 0) {
            blbMap.set(t, Math.max(blbMap.get(t) || 0, mins));
          }
        }
      }
    }
  } catch {}

  const results: ScannedGameCandidate[] = [];
  for (const g of rawGames) {
    const rawTitle = g.Title ? String(g.Title).trim() : '';
    const exePath = g.ExePath ? String(g.ExePath).trim() : '';
    const title = rawTitle || (exePath ? extractTitleFromExe(exePath) : '');
    if (!title || title === 'Unknown Game') continue;
    if (isUtilityExeOrTitle(title, exePath)) continue;

    const rawPlayTotal = Number(g.PlayTotal) || 0;
    const blbMinutes = blbMap.get(title.toLowerCase().trim()) || (rawTitle ? blbMap.get(rawTitle.toLowerCase().trim()) : 0) || 0;
    const playtimeMinutes = Math.max(0, Math.round(Math.max(rawPlayTotal, blbMinutes)));

    const existsOnDisk = exePath ? fs.existsSync(exePath) : false;
    if (!existsOnDisk && playtimeMinutes <= 0) continue;

    let steamId = typeof g.SteamID === 'number' && g.SteamID > 0 ? g.SteamID : null;
    if (!steamId && existsOnDisk && exePath) {
      try {
        const detected = detectSteamAppIdCached(exePath);
        if (detected && detected > 0) steamId = detected;
      } catch {}
    }

    results.push({
      title,
      exeName: exePath ? path.basename(exePath) : null,
      exePath: exePath || null,
      steamId,
      playtimeMinutes,
      sources: ['amd'],
    });
  }

  return results;
}

/**
 * Queries Windows GameConfigStore (HKCU\System\GameConfigStore\Children)
 * for previously launched games across NVIDIA, AMD, and Intel GPUs, accepting
 * only executables verified as real games (Discord detectable / Steam AppID / game SDK).
 */
export async function scanWindowsGameConfigStore(
  options: LocalGameScanOptions = {},
  db?: DatabaseSync
): Promise<ScannedGameCandidate[]> {
  let exePaths: string[] = [];
  if (options.windowsExeCandidates !== undefined) {
    exePaths = options.windowsExeCandidates;
  } else if (options.includeWindowsGameConfigStore !== false && process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'reg.exe',
        ['query', 'HKCU\\System\\GameConfigStore\\Children', '/s', '/v', 'MatchedExeFullPath'],
        { timeout: 2000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
      );
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const m = line.match(/^\s*MatchedExeFullPath\s+REG_\w+\s+(.+?\.exe)\s*$/i);
        if (m && m[1]) exePaths.push(path.normalize(m[1].trim()));
      }
    } catch {}
  }

  const seen = new Set<string>();
  const results: ScannedGameCandidate[] = [];
  for (const exePath of exePaths) {
    const normalized = path.normalize(exePath);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (!fs.existsSync(normalized)) continue;
    const exeName = path.basename(normalized);
    const rawTitle = extractTitleFromExe(normalized);
    if (isUtilityExeOrTitle(rawTitle, normalized)) continue;

    const discordMatch = matchDiscordDetectableGame(exeName, normalized);
    let steamId = discordMatch?.steamId && discordMatch.steamId > 0 ? discordMatch.steamId : null;
    if (!steamId) {
      try {
        const detected = detectSteamAppIdCached(normalized);
        if (detected && detected > 0) steamId = detected;
      } catch {}
    }

    const verifiedGame = Boolean(discordMatch || steamId || isLikelyGame(exeName, normalized, db));
    if (!verifiedGame) continue;

    const title = discordMatch?.title || rawTitle;
    if (!title || title === 'Unknown Game' || isUtilityExeOrTitle(title, normalized)) continue;

    results.push({
      title,
      exeName,
      exePath: normalized,
      steamId,
      playtimeMinutes: 0,
      sources: ['windows'],
    });
  }

  return results;
}

/**
 * Deduplicates and merges game candidates across all local sources.
 */
export function mergeScannedCandidates(candidates: ScannedGameCandidate[]): ScannedGameCandidate[] {
  const merged: ScannedGameCandidate[] = [];
  const bySteamId = new Map<number, ScannedGameCandidate>();
  const byExePath = new Map<string, ScannedGameCandidate>();
  const byTitleKey = new Map<string, ScannedGameCandidate>();

  for (const item of candidates) {
    const titleKey = normalizeTitleKey(item.title);
    const exeKey = item.exePath ? path.normalize(item.exePath).toLowerCase() : '';
    const steamId = item.steamId && item.steamId > 0 ? item.steamId : null;

    const existing =
      (steamId ? bySteamId.get(steamId) : undefined) ||
      (exeKey ? byExePath.get(exeKey) : undefined) ||
      (titleKey ? byTitleKey.get(titleKey) : undefined);

    if (!existing) {
      const clone: ScannedGameCandidate = {
        ...item,
        steamId,
        sources: [...new Set(item.sources)],
      };
      merged.push(clone);
      if (steamId) bySteamId.set(steamId, clone);
      if (exeKey) byExePath.set(exeKey, clone);
      if (titleKey) byTitleKey.set(titleKey, clone);
      continue;
    }

    existing.playtimeMinutes = Math.max(existing.playtimeMinutes, item.playtimeMinutes || 0);
    if (!existing.steamId && steamId) {
      existing.steamId = steamId;
      bySteamId.set(steamId, existing);
    }
    if (!existing.exePath && item.exePath) {
      existing.exePath = item.exePath;
      existing.exeName = item.exeName || path.basename(item.exePath);
      byExePath.set(path.normalize(item.exePath).toLowerCase(), existing);
    }
    if (!existing.exeName && item.exeName) {
      existing.exeName = item.exeName;
    }
    for (const s of item.sources) {
      if (!existing.sources.includes(s)) existing.sources.push(s);
    }
  }

  return merged;
}

/**
 * Scans the PC for installed games across Steam, Epic, GOG, Riot, Xbox,
 * AMD Adrenalin, and Windows GameConfigStore, then imports newly discovered
 * titles and baseline personal playtime (recorded_playtime_minutes = 0).
 */
export async function scanAndImportLocalGames(
  options: LocalGameScanOptions = {}
): Promise<LocalGameScanSummary> {
  const db = options.targetDb || getDb();
  const emptySummary: LocalGameScanSummary = {
    scannedSources: [],
    detectedCount: 0,
    importedGames: 0,
    updatedGames: 0,
    skippedGames: 0,
    gamesWithPlaytime: 0,
    totalPlaytimeMinutes: 0,
    importedTitles: [],
  };

  if (!canImportDeviceHistory(db)) {
    return emptySummary;
  }

  const [steamGames, windowsGames] = await Promise.all([
    scanSteamGames(options),
    scanWindowsGameConfigStore(options, db),
  ]);
  const epicGames = scanEpicGames(options);
  const gogGames = scanGogGames(options);
  const riotGames = scanRiotGames(options);
  const xboxGames = scanXboxGames(options);
  const amdGames = scanAmdInstalledGames(options);

  const allCandidates = mergeScannedCandidates([
    ...steamGames,
    ...epicGames,
    ...gogGames,
    ...riotGames,
    ...xboxGames,
    ...amdGames,
    ...windowsGames,
  ]);

  const scannedSources = Array.from(
    new Set(allCandidates.flatMap((c) => c.sources))
  ) as LocalGameScanSource[];

  const deletedTitles = new Set<string>();
  const deletedExes = new Set<string>();
  const deletedSteamIds = new Set<number>();
  try {
    const deletedRows = db.prepare('SELECT title, exe_name, steam_id FROM deleted_games').all() as any[];
    for (const row of deletedRows) {
      if (row.title) deletedTitles.add(normalizeTitleKey(String(row.title)));
      if (row.exe_name) deletedExes.add(String(row.exe_name).toLowerCase());
      if (typeof row.steam_id === 'number' && row.steam_id > 0) deletedSteamIds.add(row.steam_id);
    }
  } catch {}

  const existingGames = db.prepare('SELECT * FROM games').all() as unknown as Game[];
  const bySteam = new Map<number, Game>();
  const byExePath = new Map<string, Game>();
  const byExeName = new Map<string, Game>();
  const byTitle = new Map<string, Game>();
  for (const g of existingGames) {
    if (g.steam_id && g.steam_id > 0) bySteam.set(Number(g.steam_id), g);
    if (g.exe_path) byExePath.set(path.normalize(g.exe_path).toLowerCase(), g);
    if (g.exe_name) byExeName.set(g.exe_name.toLowerCase(), g);
    if (g.title) byTitle.set(normalizeTitleKey(g.title), g);
  }

  let importedGames = 0;
  let updatedGames = 0;
  let skippedGames = 0;
  let gamesWithPlaytime = 0;
  let totalPlaytimeMinutes = 0;
  const importedTitles: string[] = [];

  for (const candidate of allCandidates) {
    const titleKey = normalizeTitleKey(candidate.title);
    const exeNameLower = candidate.exeName ? candidate.exeName.toLowerCase() : '';
    const exePathKey = candidate.exePath ? path.normalize(candidate.exePath).toLowerCase() : '';
    const steamId = candidate.steamId && candidate.steamId > 0 ? candidate.steamId : null;

    if (
      (titleKey && deletedTitles.has(titleKey)) ||
      (exeNameLower && deletedExes.has(exeNameLower)) ||
      (steamId && deletedSteamIds.has(steamId))
    ) {
      skippedGames++;
      continue;
    }

    const existing =
      (steamId ? bySteam.get(steamId) : undefined) ||
      (exePathKey ? byExePath.get(exePathKey) : undefined) ||
      (exeNameLower ? byExeName.get(exeNameLower) : undefined) ||
      (titleKey ? byTitle.get(titleKey) : undefined);

    if (existing) {
      let didUpdate = false;
      const patch: Partial<Game> = {};
      if (!existing.exe_path && candidate.exePath) patch.exe_path = candidate.exePath;
      if (!existing.exe_name && candidate.exeName) patch.exe_name = candidate.exeName;
      if ((!existing.steam_id || existing.steam_id <= 0) && steamId) patch.steam_id = steamId;

      if (Object.keys(patch).length > 0) {
        try {
          updateGame(existing.id, patch);
          didUpdate = true;
        } catch {}
      }

      if ((existing.playtime_minutes || 0) === 0 && candidate.playtimeMinutes > 0) {
        try {
          setManualPlaytime(existing.id, candidate.playtimeMinutes, db);
          gamesWithPlaytime++;
          totalPlaytimeMinutes += candidate.playtimeMinutes;
          didUpdate = true;
        } catch {}
      }

      if (didUpdate) updatedGames++;
      else skippedGames++;
      continue;
    }

    const created = createGame({
      title: candidate.title,
      exe_name: candidate.exeName ?? undefined,
      exe_path: candidate.exePath ?? undefined,
      steam_id: steamId ?? -1,
      status: 'playing',
      playtime_minutes: candidate.playtimeMinutes,
      // Baseline local hours belong to personal total only — never credit
      // community ranked playtime (`recorded_playtime_minutes`).
      recorded_playtime_minutes: 0,
    });

    if (created.steam_id && created.steam_id > 0) bySteam.set(Number(created.steam_id), created);
    if (created.exe_path) byExePath.set(path.normalize(created.exe_path).toLowerCase(), created);
    if (created.exe_name) byExeName.set(created.exe_name.toLowerCase(), created);
    byTitle.set(titleKey, created);

    importedGames++;
    importedTitles.push(created.title);
    if (candidate.playtimeMinutes > 0) {
      gamesWithPlaytime++;
      totalPlaytimeMinutes += candidate.playtimeMinutes;
    }
  }

  if (options.enrichCovers !== false && (importedGames > 0 || updatedGames > 0)) {
    try {
      await autoEnrichAllGameCovers(db);
    } catch {}
  }

  return {
    scannedSources,
    detectedCount: allCandidates.length,
    importedGames,
    updatedGames,
    skippedGames,
    gamesWithPlaytime,
    totalPlaytimeMinutes,
    importedTitles,
  };
}
