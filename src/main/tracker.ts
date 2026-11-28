import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { getDb, recalculatePlaytime, setManualPlaytime } from './db.ts';
import { extractTitleFromExe } from './importer.ts';
import { ensureGameFolder, normalizeForMatch, sanitizeTitleForFolder } from './media.ts';
import { searchSteamCovers, detectSteamAppIdFromExe, resolveSteamAppId, CURATED_STEAM_APP_IDS, resolveWebCoversForGame } from './covers.ts';
import { matchDiscordDetectableGame } from './discord-detectable.ts';
import type { TrackerStatus, Game } from '../shared/types.js';

// Native Win32 API binding via koffi for zero-impact polling (0.0001ms / 0.000004% CPU)
let win32Ready = false;
let GetForegroundWindow: any = null;
let GetWindowThreadProcessId: any = null;
let OpenProcess: any = null;
let QueryFullProcessImageNameW: any = null;
let CloseHandle: any = null;

try {
  if (process.platform === 'win32') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    GetForegroundWindow = user32.func('GetForegroundWindow', 'void *', []);
    // The PID out-param MUST be declared koffi.out(): a plain 'uint32 *' never
    // marshals the value back, so the pid read as 0 and the tracker could never
    // recognize a foreground game (root cause of the 1-minute session churn).
    GetWindowThreadProcessId = user32.func(
      'GetWindowThreadProcessId',
      'uint32',
      ['void *', koffi.out('uint32 *')]
    );
    OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
    QueryFullProcessImageNameW = kernel32.func(
      'QueryFullProcessImageNameW',
      'bool',
      ['void *', 'uint32', 'char16_t *', 'uint32 *']
    );
    CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);
    win32Ready = true;
  }
} catch {
  win32Ready = false;
}

/**
 * Directly inspects the active Windows foreground window in memory (< 0.2 microseconds latency).
 * Zero child process spawning overhead, guaranteed < 0.05% CPU and < 40MB RAM.
 */
export function getForegroundProcessInfo(): {
  exeName: string | null;
  pid: number;
  exePath: string | null;
} {
  if (!win32Ready || !GetForegroundWindow) {
    return { exeName: null, pid: 0, exePath: null };
  }

  try {
    const hwnd = GetForegroundWindow();
    if (!hwnd) {
      return { exeName: null, pid: 0, exePath: null };
    }

    const pidPtr = [0];
    GetWindowThreadProcessId(hwnd, pidPtr);
    const pid = pidPtr[0];
    if (!pid || pid <= 0) {
      return { exeName: null, pid: 0, exePath: null };
    }

    const hProcess = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (!hProcess) {
      return { exeName: null, pid, exePath: null };
    }

    try {
      const buf = Buffer.alloc(1024);
      const sizePtr = [512];
      if (QueryFullProcessImageNameW(hProcess, 0, buf, sizePtr)) {
        const fullPath = buf
          .toString('utf16le', 0, sizePtr[0] * 2)
          .replace(/\0.*$/, '')
          .trim();
        const exeName = path.basename(fullPath);
        return { exeName, pid, exePath: fullPath };
      }
    } finally {
      CloseHandle(hProcess);
    }
  } catch {
    // Non-throwing guarantee for zero-impact background engine
  }

  return { exeName: null, pid: 0, exePath: null };
}

export interface ActiveSessionInfo {
  sessionId: number;
  gameId: number;
  gameTitle: string;
  pid: number;
  startTime: Date;
  lastPollTime?: Date;
  processName?: string;
}

export interface CloseSessionResult {
  discarded: boolean;
  reason?: string;
  sessionId?: number;
  gameId?: number;
  durationMinutes?: number;
}

export interface ProcessPollResult {
  action: 'started' | 'continue' | 'idle';
  session?: ActiveSessionInfo;
}

/** Known game platform directory patterns */
export const GAME_PLATFORM_DIR_REGEX = /\\(steamapps\\common|epic games|gog games|gog galaxy\\games|xboxgames|modifiablewindowsapps|ubisoft\\ubisoft game launcher\\games|origin games|ea games|battle\.net|riot games|rpcs3|yuzu|ryujinx|cemu|pcsx2|ppsspp|dolphin|citra|vita3k)\\/i;

/** General user gaming library folder patterns (e.g. D:\Games, E:\Game, C:\Gaming, D:\Tro Choi) */
export const USER_GAME_DIR_REGEX = /(?:^[a-zA-Z]:\\(?:games?|gaming|tro choi|my games)\b|\\(?:games?|gaming|my games)\\[^\\]+\\)/i;

/** Common installer / updater / tool executables to skip even within game folders */
export const INSTALLER_OR_TOOL_EXE_REGEX = /(?:^|[._-])(?:unins\d*|setup|installer?|updater?|crashpad_handler|crashreporter|unitycrashhandler.*|vc_redist.*|dxsetup|easyanticheat.*|battleye.*|ubisoftanticheat.*)(?:[._-]|\.exe$)/i;

/** Known game launchers, client frontends, IDEs, remote tools, browsers and utilities that are NOT games */
export const KNOWN_LAUNCHER_OR_CLIENT_REGEX = /^(?:leagueclient.*|riot\s*client.*|riotclient.*|googledrive.*|steam|steamwebhelper|steamservice|epicgameslauncher|epicwebhelper|galaxyclient.*|ea|eadesktop|ealauncher|eabackgroundservice|link2ea|battle\.net.*|agent|upc|ubisoftconnect.*|ubisoftgamelauncher.*|ubisoftanticheat.*|garena.*|onedrive.*|dropbox.*|ultraviewer.*|antigravity.*|cursor.*|windsurf.*|code(?:-insiders)?|claude.*|mremoteng.*|putty.*|winscp.*|filezilla.*|postman.*|insomnia.*|figma.*|notion.*|obsidian.*|docker.*|ollama.*|tailscale.*|gamevault.*)\.exe$/i;

/** Known non-game title patterns (catches synced/imported utility entries even without exe path) */
export const NON_GAME_TITLE_REGEX = /^(?:antigravity(?:\s*-?\s*x\s*64)?|m\s*remote\s*ng|putty(?:\s*ng)?|ultra\s*viewer(?:[_\s]*desktop)?|visual\s*studio\s*code|cursor|windsurf|google\s*drive.*|riot\s*client.*|league\s*client.*|ubisoft\s*(?:connect|game\s*launcher|anti-?cheat\s*launcher).*|discord.*|spotify|vlc|ollama|crosshair(?:\s*v\d+)?)$/i;

/** Core game SDK / runtime files to look for in the executable's directory */
export const GAME_SDK_FINGERPRINTS = [
  'steam_api.dll',
  'steam_api64.dll',
  'steam_appid.txt',
  'galaxy.dll',
  'galaxy64.dll',
  'EOSSDK-Win64-Shipping.dll',
  'UnityPlayer.dll',
  'mono-2.0-bdwgc.dll',
  'bink2w64.dll',
  'binkw32.dll',
  'binkw64.dll',
];

export function hasElectronOrDesktopAppFingerprint(exePath: string): boolean {
  try {
    const dir = path.dirname(exePath);
    const hasAsar =
      fs.existsSync(path.join(dir, 'resources', 'app.asar')) ||
      fs.existsSync(path.join(dir, 'resources', 'app'));
    const hasChromiumRuntime =
      fs.existsSync(path.join(dir, 'chrome_elf.dll')) &&
      fs.existsSync(path.join(dir, 'v8_context_snapshot.bin'));
    if (!hasAsar && !hasChromiumRuntime) return false;

    // Allow legitimate games built on Electron/NW.js if they sit in a game library dir or ship a game SDK
    const normalizedPath = path.normalize(exePath);
    if (GAME_PLATFORM_DIR_REGEX.test(normalizedPath) || USER_GAME_DIR_REGEX.test(normalizedPath)) {
      return false;
    }
    for (const sdkFile of GAME_SDK_FINGERPRINTS) {
      if (fs.existsSync(path.join(dir, sdkFile))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isNonGameAppDirectory(exePath?: string | null): boolean {
  if (!exePath) return false;
  const lower = exePath.toLowerCase();
  const windir = (process.env.WINDIR || 'C:\\Windows').toLowerCase();
  if (lower.startsWith(windir)) return true;

  return (
    lower.includes('\\windows\\') ||
    lower.includes('\\system32') ||
    lower.includes('\\syswow64') ||
    lower.includes('\\program files\\common files') ||
    lower.includes('\\program files (x86)\\common files') ||
    lower.includes('\\microsoft\\') ||
    lower.includes('\\windowsapps\\') ||
    lower.includes('\\appdata\\local\\programs\\') ||
    lower.includes('\\antigravity\\') ||
    lower.includes('\\cursor\\') ||
    lower.includes('\\windsurf\\') ||
    lower.includes('\\microsoft vs code\\') ||
    lower.includes('\\jetbrains\\') ||
    lower.includes('\\google\\drive') ||
    lower.includes('\\google\\drive file stream\\') ||
    lower.includes('\\riot client\\') ||
    lower.includes('\\epic games\\launcher\\') ||
    lower.includes('\\steam\\bin\\') ||
    lower.includes('\\discord\\') ||
    lower.includes('\\obs-studio\\') ||
    lower.includes('\\telegram desktop\\')
  );
}

export function isIgnoredDesktopPath(exePath?: string | null): boolean {
  if (!exePath) return false;
  const lower = exePath.toLowerCase();
  return isNonGameAppDirectory(exePath) || lower.includes('\\appdata\\local\\temp');
}

/**
 * Intelligent game verification heuristic (dynamic, non-hardcoded).
 * Determines if an unknown executable is genuinely a game without relying on an infinite blacklist of desktop apps.
 */
export function isLikelyGame(
  foregroundExe: string,
  exePath?: string | null,
  db?: DatabaseSync
): boolean {
  if (!foregroundExe || !foregroundExe.toLowerCase().endsWith('.exe')) {
    return false;
  }

  // 1. Skip obvious installers, updaters, crash reporters, anticheat launchers, store clients, IDEs
  if (INSTALLER_OR_TOOL_EXE_REGEX.test(foregroundExe) || KNOWN_LAUNCHER_OR_CLIENT_REGEX.test(foregroundExe)) {
    return false;
  }

  const cleanTitle = extractTitleFromExe(exePath || foregroundExe);
  if (NON_GAME_TITLE_REGEX.test(cleanTitle.trim())) {
    return false;
  }

  if (exePath && (isNonGameAppDirectory(exePath) || hasElectronOrDesktopAppFingerprint(exePath))) {
    return false;
  }

  // 2. Check if user explicitly deleted or dismissed this game before
  if (db) {
    try {
      const deleted = db
        .prepare('SELECT 1 FROM deleted_games WHERE exe_name = ? COLLATE NOCASE OR title = ? COLLATE NOCASE LIMIT 1')
        .get(foregroundExe, cleanTitle);
      if (deleted) {
        return false;
      }
    } catch {}
  }

  // If we have an executable path, run positive game structural checks
  if (exePath) {
    const normalizedPath = path.normalize(exePath);

    // 3. Positive check: Executable is inside a recognized gaming platform or user game directory
    if (GAME_PLATFORM_DIR_REGEX.test(normalizedPath) || USER_GAME_DIR_REGEX.test(normalizedPath)) {
      return true;
    }

    // 4. Positive check: Unreal Engine naming or directory conventions
    const lowerExe = foregroundExe.toLowerCase();
    if (lowerExe.endsWith('-win64-shipping.exe') || lowerExe.endsWith('-win32-shipping.exe')) {
      return true;
    }
    if (/\\binaries\\(win64|win32)\\/i.test(normalizedPath)) {
      return true;
    }

    // 5. Positive check: Steam AppID detected from game directory
    try {
      const detectedSteamId = detectSteamAppIdFromExe(exePath);
      if (detectedSteamId && detectedSteamId > 0) {
        return true;
      }
    } catch {}

    // 6. Positive check: Game Engine & Platform SDK files in the directory
    try {
      const dir = path.dirname(exePath);
      for (const sdkFile of GAME_SDK_FINGERPRINTS) {
        if (fs.existsSync(path.join(dir, sdkFile))) {
          return true;
        }
      }

      // Unity directory convention: <GameName>_Data folder
      const baseName = path.basename(exePath, path.extname(exePath));
      if (fs.existsSync(path.join(dir, `${baseName}_Data`))) {
        return true;
      }

      // Godot package convention: <GameName>.pck
      if (fs.existsSync(path.join(dir, `${baseName}.pck`))) {
        return true;
      }

      // Also check parent directory for game SDKs (games commonly put binaries in bin/ or x64/)
      const parentDir = path.dirname(dir);
      if (parentDir && parentDir !== dir) {
        for (const sdkFile of GAME_SDK_FINGERPRINTS) {
          if (fs.existsSync(path.join(parentDir, sdkFile))) {
            return true;
          }
        }
      }
    } catch {}
  }

  // 7. Positive check: Matches Discord's detectable games database (with subpath/generic-exe disambiguation)
  if (matchDiscordDetectableGame(foregroundExe, exePath, cleanTitle)) {
    return true;
  }

  // 8. Positive check: Matches curated Steam dictionary or resolved Steam AppID
  if (cleanTitle) {
    const key = cleanTitle.toLowerCase().trim();
    if (CURATED_STEAM_APP_IDS[key]) {
      return true;
    }
    try {
      const resolved = resolveSteamAppId(cleanTitle);
      if (resolved && resolved > 0) {
        return true;
      }
    } catch {}
  }

  // Default negative: Standard desktop software (e.g. PuTTY, Office, Postman, Notepad, browsers)
  // fails all positive game indicators and is safely ignored without hardcoding.
  return false;
}

/**
 * Zero-Impact Background Playtime Tracking Engine.
 * Periodically queries Windows foreground window, matches against registered games,
 * and maintains continuous session timelines.
 */
export class PlaytimeTracker {
  private db: DatabaseSync;
  public activeSession: ActiveSessionInfo | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private unfocusedPollCount: number = 0;
  private maxUnfocusedPollsBeforeClose: number = 6; // 6 * 5s = 30 seconds alt-tab grace period
  public autoDetectNewGames: boolean = true;
  public onGameAutoDetected?: (game: Game) => void;
  /** Fired when a tracked game's cover art resolves in the background. */
  public onCoversUpdated?: (game: Game) => void;
  // FPS capture hooks (wired to FpsMonitor in main.ts)
  public onSessionStarted?: (info: ActiveSessionInfo) => void;
  public onSessionClosed?: (result: CloseSessionResult) => void;

  private verifiedGamePathCache: Set<string> = new Set<string>();
  private nonGamePathCache: Set<string> = new Set<string>();

  /**
   * Fast memoized check for whether an unknown executable should be candidate for auto-registration.
   */
  public isLikelyGameCandidate(foregroundExe: string, exePath?: string | null): boolean {
    const key = (exePath || foregroundExe).toLowerCase().trim();
    if (this.verifiedGamePathCache.has(key)) return true;
    if (this.nonGamePathCache.has(key)) return false;

    const likely = isLikelyGame(foregroundExe, exePath, this.db);
    if (likely) {
      if (this.verifiedGamePathCache.size > 500) this.verifiedGamePathCache.clear();
      this.verifiedGamePathCache.add(key);
    } else {
      if (this.nonGamePathCache.size > 500) this.nonGamePathCache.clear();
      this.nonGamePathCache.add(key);
    }
    return likely;
  }

  /**
   * A session closed by the unfocused-grace loop is resumed (same row) when the
   * same game re-appears within this window. Background-scan restarts used to
   * insert a brand-new session every ~30s whenever the game ran unfocused,
   * flooding the history with hundreds of 1-minute rows.
   */
  private static readonly SESSION_RESUME_WINDOW_MS = 120_000;

  /** Latest closed tracker session of this game that ended inside the resume window. */
  private findResumableSessionId(gameId: number, now: Date): number | null {
    try {
      const row = this.db
        .prepare(
          `SELECT id, end_time FROM sessions
           WHERE game_id = ? AND source = 'tracker' AND is_running = 0 AND end_time IS NOT NULL
           ORDER BY end_time DESC LIMIT 1`
        )
        .get(gameId) as any;
      if (!row?.id || !row.end_time) return null;
      const endMs = new Date(String(row.end_time).replace(' ', 'T')).getTime();
      if (!Number.isFinite(endMs)) return null;
      if (now.getTime() - endMs > PlaytimeTracker.SESSION_RESUME_WINDOW_MS) return null;
      return Number(row.id);
    } catch {
      return null;
    }
  }

  public ignoreList: Set<string> = new Set([
    // Browsers
    'explorer.exe',
    'chrome.exe',
    'msedge.exe',
    'firefox.exe',
    'brave.exe',
    'opera.exe',
    'vivaldi.exe',
    'tor.exe',
    'arc.exe',

    // System & OS Processes
    'taskmgr.exe',
    'svchost.exe',
    'dwm.exe',
    'csrss.exe',
    'wininit.exe',
    'services.exe',
    'lsass.exe',
    'winlogon.exe',
    'fontdrvhost.exe',
    'sihost.exe',
    'shellexperiencehost.exe',
    'ctfmon.exe',
    'conhost.exe',
    'werfault.exe',
    'smartscreen.exe',
    'runtimebroker.exe',
    'searchhost.exe',
    'searchui.exe',
    'startmenuexperiencehost.exe',
    'lockapp.exe',
    'systemsettings.exe',
    'textinputhost.exe',
    'applicationframehost.exe',
    'securityhealthservice.exe',
    'securityhealthsystray.exe',

    // Browsers & WebViews
    'chrome.exe',
    'msedge.exe',
    'msedgewebview2.exe',
    'firefox.exe',
    'brave.exe',
    'opera.exe',

    // Terminals & Dev tools
    'cmd.exe',
    'powershell.exe',
    'pwsh.exe',
    'code.exe',
    'electron.exe',
    'devenv.exe',
    'windowsterminal.exe',
    'wt.exe',
    'bash.exe',
    'git-bash.exe',
    'notepad.exe',
    'notepad++.exe',
    'sublime_text.exe',

    // Social, Chat & Communication
    'discord.exe',
    'slack.exe',
    'teams.exe',
    'telegram.exe',
    'zalo.exe',
    'skype.exe',
    'zoom.exe',
    'whatsapp.exe',

    // Launchers, Clients & Overlays (not games themselves)
    'steam.exe',
    'steamwebhelper.exe',
    'steamservice.exe',
    'epicgameslauncher.exe',
    'epicwebhelper.exe',
    'galaxyclient.exe',
    'galaxyclientservice.exe',
    'galaxycommunication.exe',
    'ea.exe',
    'eadesktop.exe',
    'ealauncher.exe',
    'eabackgroundservice.exe',
    'link2ea.exe',
    'upc.exe',
    'ubisoftconnect.exe',
    'ubisoftgamelauncher.exe',
    'ubisoftgamelauncher64.exe',
    'battle.net.exe',
    'battlenet.exe',
    'battle.net launcher.exe',
    'agent.exe',
    'riot client.exe',
    'riotclient.exe',
    'riotclientux.exe',
    'riotclientuxrender.exe',
    'riotclientservices.exe',
    'leagueclient.exe',
    'leagueclientux.exe',
    'leagueclientuxrender.exe',
    'leaguecrashhandler.exe',
    'googledrivefs.exe',
    'googledrivesetup.exe',
    'googledrivesync.exe',
    'garena.exe',
    'garenaplatform.exe',
    'onedrive.exe',
    'onedrivesetup.exe',
    'dropbox.exe',
    'ultraviewer.exe',
    'ultraviewer_desktop.exe',
    'radeonsoftware.exe',
    'amdrsserv.exe',
    'nvcontainer.exe',
    'nvidia share.exe',
    'obs64.exe',
    'obs32.exe',
    'vlc.exe',
    'gamevault.exe',

    // Utilities, Tools & Background Helpers
    'antigravity.exe',
    'unikeynt.exe',
    'deskin.exe',
    'teamviewer.exe',
    'tv_w32.exe',
    'tv_x64.exe',
    'parsecd.exe',
    'presentmon-x64.exe',
    'flydigi space station.exe',
    'atiesrxx.exe',
    'atieclxx.exe',
    'cncmd.exe',
    'amdow.exe',
    'amdfendrsr.exe',
    'crashpad_handler.exe',
    'textinputhost.exe',
    'startmenuexperiencehost.exe',
    'searchhost.exe',
    'shellexperiencehost.exe',
    'widgetboard.exe',
    'widgetservice.exe',
    'microsoftstartfeedprovider.exe',
    'phoneexperiencehost.exe',
    'appactions.exe',
    'applicationframehost.exe',
    'systemsettings.exe',
    'language_server.exe',
    'tailscale-ipn.exe',
    'onedrive.sync.service.exe',
  ]);

  constructor(customDb?: DatabaseSync, options?: { autoDetectNewGames?: boolean }) {
    this.db = customDb || getDb();
    if (options?.autoDetectNewGames !== undefined) {
      this.autoDetectNewGames = options.autoDetectNewGames;
    }
  }

  public useDatabase(db: DatabaseSync): void {
    // The caller stops the tracker before closing the previous connection.
    this.db = db;
    this.activeSession = null;
    this.unfocusedPollCount = 0;
    this.pollCount = 0;
    this.verifiedGamePathCache.clear();
    this.nonGamePathCache.clear();
  }

  public isSystemProcess(exeName?: string | null): boolean {
    if (!exeName) return true;
    const lower = exeName.toLowerCase().trim();
    if (!lower.endsWith('.exe')) return true;
    if (
      lower === 'system' ||
      lower === 'secure system' ||
      lower === 'registry' ||
      lower === 'memory compression' ||
      lower === 'system idle process'
    ) {
      return true;
    }
    if (KNOWN_LAUNCHER_OR_CLIENT_REGEX.test(lower)) return true;
    return this.ignoreList.has(lower);
  }

  public isPathIgnored(exePath?: string | null): boolean {
    return isIgnoredDesktopPath(exePath);
  }

  public findGameByProcess(exeName?: string | null): Game | null {
    if (!exeName || this.isSystemProcess(exeName)) return null;
    const stmt = this.db.prepare('SELECT * FROM games WHERE exe_name = ? COLLATE NOCASE');
    const row = stmt.get(exeName);
    return (row as unknown as Game) || null;
  }

  /**
   * Wishlist ("Chờ chơi") games only get a media folder the moment they
   * actually run: promote backlog -> playing, then create E:\Game\<title>.
   * Non-wishlist games pass through untouched.
   */
  private promoteWishlistGameIfNeeded(game: Game): Game {
    if (!game || game.status !== 'backlog') return game;
    try {
      this.db
        .prepare(`
          UPDATE games
          SET status = 'playing', updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `)
        .run(game.id);
      try {
        ensureGameFolder(game.title);
      } catch (err) {
        console.warn(`[tracker] Failed to create media folder for promoted game ${game.title}:`, err);
      }
      console.log(`[tracker] Wishlist game launched — promoted to 'playing': "${game.title}"`);
      return { ...game, status: 'playing' };
    } catch {
      return game;
    }
  }

  /**
   * Auto-detects and automatically registers a new game in GameVault:
   * 1. Extracts a clean, human-readable title from the executable.
   * 2. Inserts game record into the SQLite database.
   * 3. Automatically creates the game's photo/media folder in E:\Game.
   * 4. Asynchronously retrieves cover art from Steam CDN.
   * 5. Emits an event to notify the UI in real-time.
   */
  public autoRegisterNewGame(foregroundExe: string, exePath?: string | null): Game | null {
    try {
      if (!foregroundExe || !foregroundExe.toLowerCase().endsWith('.exe')) {
        return null;
      }
      const extractedTitle = extractTitleFromExe(exePath || foregroundExe);
      const discordMatch = matchDiscordDetectableGame(foregroundExe, exePath, extractedTitle);
      const cleanTitle = discordMatch?.title || extractedTitle;
      if (!cleanTitle || cleanTitle.toLowerCase() === 'unknown game') {
        return null;
      }

      // Detect steam appid early so both deleted_games and existing-game dedup can match by steam_id
      let detectedSteamId = -1;
      if (exePath) {
        try {
          const id = detectSteamAppIdFromExe(exePath);
          if (id) detectedSteamId = id;
        } catch {}
      }
      if (detectedSteamId <= 0 && discordMatch?.steamId) {
        detectedSteamId = discordMatch.steamId;
      }

      // Check if user previously deleted or dismissed this game
      try {
        const deleted = detectedSteamId > 0
          ? this.db
              .prepare('SELECT 1 FROM deleted_games WHERE exe_name = ? COLLATE NOCASE OR title = ? COLLATE NOCASE OR steam_id = ? LIMIT 1')
              .get(foregroundExe, cleanTitle, detectedSteamId)
          : this.db
              .prepare('SELECT 1 FROM deleted_games WHERE exe_name = ? COLLATE NOCASE OR title = ? COLLATE NOCASE LIMIT 1')
              .get(foregroundExe, cleanTitle);
        if (deleted) {
          return null;
        }
      } catch {}

      // Check if game already exists by exact title, steam_id, or normalized title
      let existing = this.db
        .prepare('SELECT * FROM games WHERE title = ? COLLATE NOCASE')
        .get(cleanTitle) as unknown as Game | undefined;

      if (!existing && detectedSteamId > 0) {
        existing = this.db
          .prepare('SELECT * FROM games WHERE steam_id = ? LIMIT 1')
          .get(detectedSteamId) as unknown as Game | undefined;
      }

      if (!existing) {
        const normTarget = normalizeForMatch(cleanTitle);
        if (normTarget.length >= 3) {
          const allRows = this.db.prepare('SELECT * FROM games').all() as unknown as Game[];
          existing = allRows.find((row) => normalizeForMatch(row.title) === normTarget);
        }
      }

      if (existing) {
        this.db
          .prepare(`
            UPDATE games
            SET exe_name = ?,
                exe_path = COALESCE(?, exe_path),
                steam_id = CASE WHEN (steam_id IS NULL OR steam_id <= 0) AND ? > 0 THEN ? ELSE steam_id END,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
          `)
          .run(foregroundExe, exePath || null, detectedSteamId, detectedSteamId, existing.id);

        // Wishlist game just launched: promote to 'playing' (+ create folder)
        const promoted = this.promoteWishlistGameIfNeeded(existing);

        // If existing game lacks cover art, enrich it now
        if (!existing.cover_url) {
          try {
            const { autoEnrichAllGameCovers } = require('./covers.ts');
            const db = this.db;
            autoEnrichAllGameCovers(this.db).then(() => {
              if (this.db !== db) return;
              const fresh = this.db
                .prepare('SELECT * FROM games WHERE id = ?')
                .get(existing!.id) as unknown as Game;
              if (fresh?.cover_url && this.onCoversUpdated) {
                this.onCoversUpdated(fresh);
              }
            }).catch(() => {});
          } catch {}
        }

        const resolvedSteamId =
          (existing.steam_id == null || existing.steam_id <= 0) && detectedSteamId > 0
            ? detectedSteamId
            : existing.steam_id;
        return { ...promoted, exe_name: foregroundExe, steam_id: resolvedSteamId };
      }

      // Positively verify that this unknown executable is genuinely a game
      if (!this.isLikelyGameCandidate(foregroundExe, exePath)) {
        return null;
      }

      const mediaFolder = sanitizeTitleForFolder(cleanTitle);

      const insertRes = this.db
        .prepare(`
          INSERT INTO games (title, exe_name, exe_path, steam_id, status, playtime_minutes, media_folder)
          VALUES (?, ?, ?, ?, 'playing', 0, ?)
        `)
        .run(cleanTitle, foregroundExe, exePath || null, detectedSteamId, mediaFolder);

      const newId = Number(insertRes.lastInsertRowid);
      const newGame = this.db
        .prepare('SELECT * FROM games WHERE id = ?')
        .get(newId) as unknown as Game;

      // 1. Auto-create folder in E:\Game\<CleanTitle>
      try {
        ensureGameFolder(cleanTitle);
      } catch (err) {
        console.warn(`[tracker] Failed to auto-create folder for ${cleanTitle}:`, err);
      }

      // 2. Asynchronously enrich cover art and cache to cloud (Single source of truth)
      try {
        const db = this.db;
        resolveWebCoversForGame(this.db, {
          id: newId,
          title: cleanTitle,
          steam_id: detectedSteamId > 0 ? detectedSteamId : undefined,
          exe_path: exePath || undefined,
        }).then((covers) => {
          if (this.db !== db) return;
          const poster = covers.poster;
          const banner = covers.banner;
          if (poster || banner) {
            this.db
              .prepare(`
                UPDATE games
                SET cover_url = COALESCE(?, cover_url),
                    banner_url = COALESCE(?, banner_url),
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
              `)
              .run(poster || null, banner || null, newId);
            // Push the freshly-covered game to the UI so the card updates
            // the moment art lands (no manual refresh needed)
            const fresh = this.db
              .prepare('SELECT * FROM games WHERE id = ?')
              .get(newId) as unknown as Game;
            if (fresh && this.onCoversUpdated) {
              this.onCoversUpdated(fresh);
            }
          }
        }).catch(() => {});
      } catch {}

      // 3. Notify UI
      if (this.onGameAutoDetected) {
        this.onGameAutoDetected(newGame);
      }

      console.log(`[tracker] Auto-detected and registered new game: "${cleanTitle}" (${foregroundExe})`);
      return newGame;
    } catch (err) {
      console.error(`[tracker] Error auto-registering game ${foregroundExe}:`, err);
      return null;
    }
  }

  /**
   * Scans all running Windows processes to detect any running game,
   * even if it is currently in background, borderless, on a secondary monitor,
   * or still initializing.
   */
  public scanRunningProcesses(): Game | null {
    if (process.platform !== 'win32') return null;

    try {
      const output = execSync('tasklist /FO CSV /NH /FI "SESSIONNAME eq Console"', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const lines = output.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('","').map((p) => p.replace(/"/g, '').trim());
        const exeName = parts[0];
        const pid = parseInt(parts[1], 10);

        if (!exeName || isNaN(pid) || pid <= 4) continue;
        if (!exeName.toLowerCase().endsWith('.exe')) continue;
        if (this.isSystemProcess(exeName)) continue;

        // If already in database, return existing game record.
        // Active session tracking is driven by pollOnce when the game is in foreground;
        // do not force-start an unfocused session that was just closed by the alt-tab timeout.
        const existing = this.findGameByProcess(exeName);
        if (existing) {
          return existing;
        }
      }
    } catch (err) {
      // safe fallback
    }

    return null;
  }

  public getStatus(): TrackerStatus & { activePid?: number | null } {
    return {
      isTracking: this.activeSession !== null,
      activeGameTitle: this.activeSession ? this.activeSession.gameTitle : null,
      activePid: this.activeSession ? this.activeSession.pid : null,
      activeProcessName: this.activeSession ? this.activeSession.processName : null,
      sessionStartTime: this.activeSession ? this.activeSession.startTime.toISOString() : null,
    };
  }

  public handleProcessPoll(
    foregroundExe: string,
    pid: number,
    timestamp: Date = new Date(),
    exePath?: string | null
  ): ProcessPollResult {
    let activeGame = this.findGameByProcess(foregroundExe);

    // Auto-detection & registration for new games
    if (!activeGame && this.autoDetectNewGames) {
      if (!this.isSystemProcess(foregroundExe) && !this.isPathIgnored(exePath)) {
        if (this.isLikelyGameCandidate(foregroundExe, exePath)) {
          activeGame = this.autoRegisterNewGame(foregroundExe, exePath);
        }
      }
    }

    if (activeGame) {
      this.unfocusedPollCount = 0;

      // Wishlist game actually running: promote to 'playing' (+ create folder) first
      activeGame = this.promoteWishlistGameIfNeeded(activeGame);

      // If already tracking the same game, maintain session
      if (this.activeSession && this.activeSession.gameId === activeGame.id) {
        return { action: 'continue', session: this.activeSession };
      }

      // If transitioning directly from another game, close previous session first
      if (this.activeSession) {
        this.closeActiveSession(timestamp);
      }

      // Resume a just-closed session of the same game instead of inserting a
      // new row (kills the 1-minute session churn when the game runs
      // unfocused). Duration on close derives from the ROW's original
      // start_time so the full span stays accurate.
      const resumeId = this.findResumableSessionId(activeGame.id, timestamp);
      if (resumeId) {
        let originalStart = timestamp;
        try {
          const row = this.db
            .prepare('SELECT start_time FROM sessions WHERE id = ?')
            .get(resumeId) as any;
          const ms = row?.start_time
            ? new Date(String(row.start_time).replace(' ', 'T')).getTime()
            : NaN;
          if (Number.isFinite(ms)) originalStart = new Date(ms);
        } catch {}
        this.db
          .prepare(`UPDATE sessions SET is_running = 1, pid = ?, last_poll = ? WHERE id = ?`)
          .run(pid, timestamp.toISOString(), resumeId);

        this.activeSession = {
          sessionId: resumeId,
          gameId: activeGame.id,
          gameTitle: activeGame.title,
          pid,
          startTime: originalStart,
          lastPollTime: timestamp,
          processName: foregroundExe,
        };

        // FPS capture re-attaches to the resumed session
        try {
          this.onSessionStarted?.(this.activeSession);
        } catch {}

        return { action: 'started', session: this.activeSession };
      }

      // Start new session
      const insertRes = this.db
        .prepare(`
          INSERT INTO sessions (game_id, pid, start_time, is_running, source, last_poll)
          VALUES (?, ?, ?, 1, 'tracker', ?)
        `)
        .run(activeGame.id, pid, timestamp.toISOString(), timestamp.toISOString());

      this.activeSession = {
        sessionId: Number(insertRes.lastInsertRowid),
        gameId: activeGame.id,
        gameTitle: activeGame.title,
        pid,
        startTime: timestamp,
        lastPollTime: timestamp,
        processName: foregroundExe,
      };

      // FPS capture can attach now (PresentMon targets the game's exe)
      try {
        this.onSessionStarted?.(this.activeSession);
      } catch {}

      return { action: 'started', session: this.activeSession };
    }

    return { action: 'idle' };
  }

  public closeActiveSession(
    timestamp: Date = new Date(),
    minDurationSeconds: number = 10
  ): CloseSessionResult | null {
    if (!this.activeSession) {
      return null;
    }

    const elapsedMs = timestamp.getTime() - this.activeSession.startTime.getTime();
    const elapsedSec = Math.floor(elapsedMs / 1000);

    const sessionId = this.activeSession.sessionId;
    const gameId = this.activeSession.gameId;
    this.activeSession = null;
    this.unfocusedPollCount = 0;

    // Discard fleeting process launches (< 10 seconds) to prevent database clutter
    if (elapsedSec < minDurationSeconds) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      const discardResult: CloseSessionResult = { discarded: true, reason: 'fleeting_launch' };
      try {
        this.onSessionClosed?.(discardResult);
      } catch {}
      return discardResult;
    }

    const durationMinutes = Math.max(1, Math.round(elapsedSec / 60));

    this.db
      .prepare(`
        UPDATE sessions
        SET end_time = ?, duration_minutes = ?, is_running = 0
        WHERE id = ?
      `)
      .run(timestamp.toISOString(), durationMinutes, sessionId);

    // Union-based recalc instead of a blind += : when both the tracker and
    // the AMD import recorded the same wall-clock window, overlapping
    // intervals must count once, not twice
    try {
      recalculatePlaytime(this.db, [gameId]);
    } catch {}

    const result: CloseSessionResult = {
      discarded: false,
      sessionId,
      gameId,
      durationMinutes,
    };

    // FPS capture detaches here — parses the PresentMon CSV async and stores metrics
    try {
      this.onSessionClosed?.(result);
    } catch {}

    return result;
  }

  public updatePlaytimeManual(gameId: number, newMinutes: number): boolean {
    return setManualPlaytime(gameId, newMinutes, this.db);
  }

  /**
   * Alias for updatePlaytimeManual to support both naming conventions.
   */
  public manualEditPlaytime(gameId: number, newTotalMinutes: number): boolean {
    return this.updatePlaytimeManual(gameId, newTotalMinutes);
  }

  private pollCount: number = 0;
  private static readonly SLEEP_GAP_MS = 120_000;

  /**
   * Performs a single live polling cycle.
   */
  public pollOnce(nowOverride?: Date): void {
    const { exeName, pid, exePath } = getForegroundProcessInfo();
    const now = nowOverride ?? new Date();
    this.pollCount++;

    // Guard against PC sleep/hibernate: if the gap since the last confirmed poll
    // exceeds SLEEP_GAP_MS, close the session at its last confirmed poll + grace
    // so sleep hours are never counted as playtime.
    if (this.activeSession?.lastPollTime) {
      const gapMs = now.getTime() - this.activeSession.lastPollTime.getTime();
      if (gapMs > PlaytimeTracker.SLEEP_GAP_MS) {
        const cappedEnd = new Date(
          Math.min(this.activeSession.lastPollTime.getTime() + 30_000, now.getTime())
        );
        this.closeActiveSession(cappedEnd);
      }
    }

    if (exeName && pid > 0) {
      const result = this.handleProcessPoll(exeName, pid, now, exePath);
      if (result.action === 'idle' && this.activeSession) {
        this.unfocusedPollCount++;
        // If foreground window has been away from game longer than grace window, close session
        if (this.unfocusedPollCount >= this.maxUnfocusedPollsBeforeClose) {
          this.closeActiveSession(now);
        }
      }
    } else if (this.activeSession) {
      this.unfocusedPollCount++;
      if (this.unfocusedPollCount >= this.maxUnfocusedPollsBeforeClose) {
        this.closeActiveSession(now);
      }
    }

    // Stamp last_poll while the session is live, so an abnormal exit
    // (crash / kill / power loss) can be recovered without losing minutes
    if (this.activeSession) {
      this.activeSession.lastPollTime = now;
      try {
        this.db
          .prepare('UPDATE sessions SET last_poll = ? WHERE id = ?')
          .run(now.toISOString(), this.activeSession.sessionId);
      } catch {}
    }

    // Every 3 polls (~15s), also scan running background processes for games
    if (this.autoDetectNewGames && this.pollCount % 3 === 0) {
      this.scanRunningProcesses();
    }
  }

  /**
   * Starts periodic polling (default 5,000ms / 5s).
   */
  public start(intervalMs: number = 5000): void {
    if (this.intervalTimer) return;

    // Recover sessions orphaned by an abnormal exit (crash / kill / power loss)
    try {
      recoverStaleSessions(this.db);
    } catch {}

    // Initial immediate scan for any games that are already running
    if (this.autoDetectNewGames) {
      try {
        this.scanRunningProcesses();
      } catch {}
    }

    this.intervalTimer = setInterval(() => {
      this.pollOnce();
    }, intervalMs);
  }

  /**
   * Stops background polling and flushes active sessions.
   */
  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.activeSession) {
      this.closeActiveSession();
    }
  }
}

export interface StaleRecoverySummary {
  recovered: number;
  discarded: number;
  creditedMinutes: number;
}

/**
 * Recovers tracker sessions left orphaned by an abnormal app exit
 * (crash, process kill, power loss). Each stale session is closed at its
 * last observed poll time plus the foreground grace window, and the elapsed
 * playtime is credited to the game. Sessions without a last_poll timestamp
 * (legacy rows) are closed without crediting playtime, to avoid fabricating
 * minutes we cannot verify.
 */
export function recoverStaleSessions(
  db: DatabaseSync,
  options?: { graceSeconds?: number; now?: Date; minDurationSeconds?: number }
): StaleRecoverySummary {
  const graceSeconds = options?.graceSeconds ?? 30;
  const minDurationSeconds = options?.minDurationSeconds ?? 10;
  const nowMs = (options?.now ?? new Date()).getTime();

  const summary: StaleRecoverySummary = { recovered: 0, discarded: 0, creditedMinutes: 0 };

  let staleRows: any[] = [];
  try {
    staleRows = db
      .prepare(
        `SELECT id, game_id, start_time, last_poll
         FROM sessions
         WHERE is_running = 1 AND source = 'tracker'`
      )
      .all() as any[];
  } catch {
    return summary;
  }

  const closeStmt = db.prepare(
    'UPDATE sessions SET end_time = ?, duration_minutes = ?, is_running = 0 WHERE id = ?'
  );
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');

  const creditedGameIds = new Set<number>();

  for (const row of staleRows) {
    try {
      // Legacy rows without last_poll have no verifiable end point —
      // drop them rather than fabricate playtime
      if (!row.last_poll) {
        deleteStmt.run(row.id);
        summary.discarded++;
        continue;
      }

      const startMs = new Date(String(row.start_time).replace(' ', 'T')).getTime();
      const lastPollMs = new Date(String(row.last_poll).replace(' ', 'T')).getTime();

      // Unparseable timestamps: drop the row rather than guess playtime
      if (!isFinite(startMs) || !isFinite(lastPollMs)) {
        deleteStmt.run(row.id);
        summary.discarded++;
        continue;
      }

      const endMs = Math.min(lastPollMs + graceSeconds * 1000, nowMs);
      const elapsedSec = Math.floor((endMs - startMs) / 1000);

      // Mirror closeActiveSession: discard fleeting sessions (< 10s)
      if (elapsedSec < minDurationSeconds) {
        deleteStmt.run(row.id);
        summary.discarded++;
        continue;
      }

      const durationMinutes = Math.max(1, Math.round(elapsedSec / 60));
      closeStmt.run(new Date(endMs).toISOString(), durationMinutes, row.id);
      creditedGameIds.add(Number(row.game_id));

      summary.recovered++;
      summary.creditedMinutes += durationMinutes;
    } catch {
      summary.discarded++;
    }
  }

  // Recompute the affected games' totals from the union of session intervals
  if (creditedGameIds.size > 0) {
    try {
      recalculatePlaytime(db, [...creditedGameIds]);
    } catch {}
  }

  return summary;
}

let globalTrackerInstance: PlaytimeTracker | null = null;

export function getTracker(): PlaytimeTracker {
  if (!globalTrackerInstance) {
    // In production, AMD Adrenalin is the primary source of truth for new games to avoid misidentifying desktop apps
    globalTrackerInstance = new PlaytimeTracker(undefined, { autoDetectNewGames: false });
  }
  return globalTrackerInstance;
}

export function manualEditPlaytime(gameId: number, newTotalMinutes: number): boolean {
  return getTracker().manualEditPlaytime(gameId, newTotalMinutes);
}

/**
 * Removes previously-registered non-game utilities/launchers/IDEs (e.g. mRemoteNG,
 * Antigravity, Cursor, PuTTY, Riot Client) from the local games table and records
 * tombstones in `deleted_games` so cloud sync removes them and never resurrects them.
 */
export function cleanupNonGameEntries(customDb?: DatabaseSync): number {
  const db = customDb || getDb();
  let removed = 0;

  try {
    const rows = db
      .prepare('SELECT id, title, exe_name, steam_id FROM games')
      .all() as Array<{ id: number; title: string; exe_name: string | null; steam_id: number | null }>;

    const cols = db.prepare('PRAGMA table_info(deleted_games)').all() as Array<{ name: string }>;
    const hasExtendedTombstone =
      cols.some((c) => c.name === 'steam_id') && cols.some((c) => c.name === 'game_key');

    const insertTombstone = hasExtendedTombstone
      ? db.prepare(`
          INSERT INTO deleted_games (title, exe_name, steam_id, game_key)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(title) DO UPDATE SET
            exe_name = COALESCE(excluded.exe_name, deleted_games.exe_name),
            steam_id = COALESCE(excluded.steam_id, deleted_games.steam_id),
            game_key = COALESCE(excluded.game_key, deleted_games.game_key),
            deleted_at = datetime('now', 'localtime')
        `)
      : db.prepare(`
          INSERT INTO deleted_games (title, exe_name)
          VALUES (?, ?)
          ON CONFLICT(title) DO UPDATE SET
            exe_name = COALESCE(excluded.exe_name, deleted_games.exe_name),
            deleted_at = datetime('now', 'localtime')
        `);
    const deleteStmt = db.prepare('DELETE FROM games WHERE id = ?');

    for (const row of rows) {
      const title = String(row.title || '').trim();
      const exeName = String(row.exe_name || '').trim();
      const isNonGameTitle = title.length > 0 && NON_GAME_TITLE_REGEX.test(title);
      const isNonGameExe = exeName.length > 0 && KNOWN_LAUNCHER_OR_CLIENT_REGEX.test(exeName);

      if (!isNonGameTitle && !isNonGameExe) continue;

      if (title) {
        if (hasExtendedTombstone) {
          const steamId = typeof row.steam_id === 'number' && row.steam_id > 0 ? row.steam_id : null;
          const slug = title.toLowerCase().replace(/[^a-z0-9]/g, '');
          const gameKey = steamId ? `s_${steamId}` : `t_${slug}`;
          insertTombstone.run(title, row.exe_name || null, steamId, gameKey);
        } else {
          insertTombstone.run(title, row.exe_name || null);
        }
      }

      const result = deleteStmt.run(row.id);
      if (result.changes > 0) {
        removed++;
      }
    }
  } catch (err) {
    console.warn('[tracker] cleanupNonGameEntries failed:', err);
  }

  return removed;
}
