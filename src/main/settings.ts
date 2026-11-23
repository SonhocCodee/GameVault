import path from 'node:path';
import fs from 'node:fs';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { getDb, getDbDir, getSetting, setSetting } from './db.ts';
import { DEFAULT_SCREENSHOTS_DIR, DEFAULT_MEDIA_DIR } from './sync-screenshots.ts';
import { SETTING_VAULT_ROOT, DEFAULT_VAULT_ROOT, setVaultRoot } from './save-manager.ts';
import type { AppSettings, F6ProcessStatus, PlaytimeWatchStatus } from '../shared/types.js';

const execAsync = promisify(exec);

/**
 * Runs a PowerShell script safely through cmd.exe's quoting hell: a raw
 * `-Command "..."` gets its multi-line script mangled by cmd.exe (exits 0
 * while executing nothing). Base64-encoded UTF-16LE passes through untouched.
 */
async function runPowerShellScript(psCmd: string): Promise<string> {
  const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
  const { stdout } = await execAsync(`powershell.exe -NoProfile -EncodedCommand ${encoded}`);
  return stdout;
}

export const DEFAULT_HOTKEY_NAME = 'F6';
export const DEFAULT_HOTKEY_VK = 0x75; // VK_F6

export const VK_MAP: Record<string, number> = {
  'F1': 0x70,
  'F2': 0x71,
  'F3': 0x72,
  'F4': 0x73,
  'F5': 0x74,
  'F6': 0x75,
  'F7': 0x76,
  'F8': 0x77,
  'F9': 0x78,
  'F10': 0x79,
  'F11': 0x7A,
  'F12': 0x7B,
  'PrintScreen': 0x2C,
  'ScrollLock': 0x91,
  'Pause': 0x13,
  'Insert': 0x2D,
  'Delete': 0x2E,
  'Home': 0x24,
  'End': 0x23,
  'PageUp': 0x21,
  'PageDown': 0x22,
};

// Known path to user's external F6 Screenshot script if installed
const KNOWN_F6_SCRIPT = 'C:\\Users\\MacPro\\Documents\\Codex\\2026-07-26\\ta\\outputs\\F6ScreenshotHotkey.ps1';
const KNOWN_START_SCRIPT = 'C:\\Users\\MacPro\\Documents\\Codex\\2026-07-26\\ta\\outputs\\Start-F6ScreenshotHotkey.ps1';
const KNOWN_STOP_SCRIPT = 'C:\\Users\\MacPro\\Documents\\Codex\\2026-07-26\\ta\\outputs\\Stop-F6ScreenshotHotkey.ps1';

/**
 * Loads all app settings from SQLite app_settings table with fallbacks.
 */
export function loadAppSettings(customDb?: DatabaseSync): AppSettings {
  const screenshotEnabledStr = getSetting('screenshot_enabled', customDb);
  const screenshotHotkey = getSetting('screenshot_hotkey', customDb) || DEFAULT_HOTKEY_NAME;
  const screenshotHotkeyVkStr = getSetting('screenshot_hotkey_vk', customDb);
  const screenshotsDir = getSetting('screenshots_dir', customDb) || DEFAULT_SCREENSHOTS_DIR;
  const mediaBaseDir = getSetting('media_base_dir', customDb) || DEFAULT_MEDIA_DIR;
  const vaultRoot = getSetting(SETTING_VAULT_ROOT, customDb) || DEFAULT_VAULT_ROOT;
  const autoDetectStr = getSetting('auto_detect_games', customDb);
  const pollIntervalStr = getSetting('poll_interval_seconds', customDb);
  const amdWatcherStr = getSetting('amd_watcher_enabled', customDb);
  const autoEnrichStr = getSetting('auto_enrich_covers', customDb);
  const closeToTrayStr = getSetting('close_to_tray', customDb);
  const appStartupStr = getSetting('app_startup_enabled', customDb);
  const setupCompletedStr = getSetting('setup_completed', customDb);
  const playtimeWatchStr = getSetting('playtime_watch_enabled', customDb);
  const hddModeStr = getSetting('hdd_mode', customDb);
  const googleApiKey = getSetting('google_api_key', customDb) || '';
  const googleCseId = getSetting('google_cse_id', customDb) || '';

  const vk = screenshotHotkeyVkStr
    ? parseInt(screenshotHotkeyVkStr, 10)
    : (VK_MAP[screenshotHotkey] || DEFAULT_HOTKEY_VK);

  return {
    screenshotEnabled: screenshotEnabledStr === null ? true : screenshotEnabledStr === 'true',
    screenshotHotkey,
    screenshotHotkeyVk: vk,
    screenshotsDir,
    mediaBaseDir,
    vaultRoot,
    autoDetectGames: autoDetectStr === null ? true : autoDetectStr === 'true',
    pollIntervalSeconds: pollIntervalStr ? parseInt(pollIntervalStr, 10) : 5,
    amdWatcherEnabled: amdWatcherStr === null ? true : amdWatcherStr === 'true',
    autoEnrichCovers: autoEnrichStr === null ? true : autoEnrichStr === 'true',
    // Close-to-tray defaults ON: the tracker only records while the app runs,
    // so silently quitting on window close would silently drop playtime
    closeToTray: closeToTrayStr === null ? true : closeToTrayStr === 'true',
    appStartupEnabled: appStartupStr === null ? false : appStartupStr === 'true',
    setupCompleted: setupCompletedStr === null ? false : setupCompletedStr === 'true',
    // Watchdog defaults ON: installed from first run, keeps counting playtime
    // while GameVault itself is closed
    playtimeWatchEnabled: playtimeWatchStr === null ? true : playtimeWatchStr === 'true',
    // HDD Mode defaults ON: buffers screenshots to protect spinning HDD drives.
    // When disabled (SSD mode), saves directly to game media folder to minimize SSD wear.
    hddMode: hddModeStr === null ? true : hddModeStr === 'true',
    googleApiKey,
    googleCseId,
  };
}

/**
 * Saves updated settings to SQLite app_settings.
 */
export function saveAppSettings(patch: Partial<AppSettings>, customDb?: DatabaseSync): AppSettings {
  if (patch.screenshotEnabled !== undefined) {
    setSetting('screenshot_enabled', patch.screenshotEnabled ? 'true' : 'false', customDb);
  }
  if (patch.screenshotHotkey !== undefined) {
    setSetting('screenshot_hotkey', patch.screenshotHotkey, customDb);
    const vk = VK_MAP[patch.screenshotHotkey] || (patch.screenshotHotkeyVk || DEFAULT_HOTKEY_VK);
    setSetting('screenshot_hotkey_vk', String(vk), customDb);
  }
  if (patch.screenshotHotkeyVk !== undefined && !patch.screenshotHotkey) {
    setSetting('screenshot_hotkey_vk', String(patch.screenshotHotkeyVk), customDb);
  }
  if (patch.screenshotsDir !== undefined) {
    setSetting('screenshots_dir', patch.screenshotsDir, customDb);
  }
  if (patch.mediaBaseDir !== undefined) {
    setSetting('media_base_dir', patch.mediaBaseDir, customDb);
  }
  if (patch.vaultRoot !== undefined) {
    try {
      setVaultRoot(patch.vaultRoot);
    } catch {}
    setSetting(SETTING_VAULT_ROOT, patch.vaultRoot, customDb);
  }
  if (patch.autoDetectGames !== undefined) {
    setSetting('auto_detect_games', patch.autoDetectGames ? 'true' : 'false', customDb);
  }
  if (patch.pollIntervalSeconds !== undefined) {
    setSetting('poll_interval_seconds', String(patch.pollIntervalSeconds), customDb);
  }
  if (patch.amdWatcherEnabled !== undefined) {
    setSetting('amd_watcher_enabled', patch.amdWatcherEnabled ? 'true' : 'false', customDb);
  }
  if (patch.autoEnrichCovers !== undefined) {
    setSetting('auto_enrich_covers', patch.autoEnrichCovers ? 'true' : 'false', customDb);
  }
  if (patch.closeToTray !== undefined) {
    setSetting('close_to_tray', patch.closeToTray ? 'true' : 'false', customDb);
  }
  if (patch.appStartupEnabled !== undefined) {
    setSetting('app_startup_enabled', patch.appStartupEnabled ? 'true' : 'false', customDb);
  }
  if (patch.setupCompleted !== undefined) {
    setSetting('setup_completed', patch.setupCompleted ? 'true' : 'false', customDb);
  }
  if (patch.playtimeWatchEnabled !== undefined) {
    setSetting('playtime_watch_enabled', patch.playtimeWatchEnabled ? 'true' : 'false', customDb);
  }
  if (patch.hddMode !== undefined) {
    setSetting('hdd_mode', patch.hddMode ? 'true' : 'false', customDb);
  }
  if (patch.googleApiKey !== undefined) {
    setSetting('google_api_key', patch.googleApiKey, customDb);
  }
  if (patch.googleCseId !== undefined) {
    setSetting('google_cse_id', patch.googleCseId, customDb);
  }

  return loadAppSettings(customDb);
}

/**
 * Checks whether the external PowerShell F6 screenshot script is currently running
 * and whether Windows startup shortcut is active.
 */
export async function getF6ProcessStatus(): Promise<F6ProcessStatus> {
  const result: F6ProcessStatus = {
    installed: fs.existsSync(KNOWN_F6_SCRIPT),
    isRunning: false,
    startupEnabled: false,
    scriptPath: KNOWN_F6_SCRIPT,
  };

  if (process.platform !== 'win32') {
    return result;
  }

  // Check if process is running
  try {
    const cmd = `Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*F6ScreenshotHotkey.ps1*" } | Select-Object -ExpandProperty ProcessId`;
    const { stdout } = await execAsync(`powershell.exe -NoProfile -Command "${cmd}"`);
    const pids = stdout.trim().split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
    if (pids.length > 0) {
      result.isRunning = true;
      result.pid = pids[0];
    }
  } catch {
    // Non-throwing check
  }

  // Check if startup shortcut exists
  try {
    const appData = process.env.APPDATA || '';
    if (appData) {
      const shortcut = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'F6 Screenshot Hotkey.lnk');
      result.startupEnabled = fs.existsSync(shortcut);
    }
  } catch {}

  return result;
}

/**
 * Starts or stops the external F6 screenshot tool process.
 */
export async function toggleF6Process(start: boolean): Promise<boolean> {
  if (process.platform !== 'win32') return false;

  try {
    if (start) {
      if (fs.existsSync(KNOWN_START_SCRIPT)) {
        await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${KNOWN_START_SCRIPT}"`);
        return true;
      }
      if (fs.existsSync(KNOWN_F6_SCRIPT)) {
        spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', KNOWN_F6_SCRIPT],
          { detached: true, stdio: 'ignore' }
        ).unref();
        return true;
      }
    } else {
      if (fs.existsSync(KNOWN_STOP_SCRIPT)) {
        await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${KNOWN_STOP_SCRIPT}"`);
        return true;
      }
      // Fallback process kill
      const killCmd = `Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*F6ScreenshotHotkey.ps1*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      await runPowerShellScript(killCmd);
      return true;
    }
  } catch (err) {
    console.error('[settings] Failed to toggle F6 process:', err);
    return false;
  }
  return false;
}

/**
 * Toggles Windows startup for F6 Screenshot Hotkey.
 */
export async function toggleF6Startup(enable: boolean): Promise<boolean> {
  if (process.platform !== 'win32') return false;

  const appData = process.env.APPDATA || '';
  if (!appData) return false;
  const linkPath = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'F6 Screenshot Hotkey.lnk');

  try {
    if (enable) {
      if (!fs.existsSync(KNOWN_F6_SCRIPT)) return false;
      const psCmd = `
        $ws = New-Object -ComObject WScript.Shell
        $link = $ws.CreateShortcut('${linkPath.replace(/'/g, "''")}')
        $link.TargetPath = "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${KNOWN_F6_SCRIPT.replace(/'/g, "''")}"'
        $link.WorkingDirectory = '${path.dirname(KNOWN_F6_SCRIPT).replace(/'/g, "''")}'
        $link.WindowStyle = 7
        $link.Save()
      `;
      await runPowerShellScript(psCmd);
      return fs.existsSync(linkPath);
    } else {
      if (fs.existsSync(linkPath)) {
        fs.unlinkSync(linkPath);
      }
      return true;
    }
  } catch (err) {
    console.error('[settings] Failed to toggle startup shortcut:', err);
    return false;
  }
}

export interface AppStartupLaunchInfo {
  targetPath: string;
  args: string;
  workingDir: string;
  iconPath?: string;
}

/**
 * Toggles Windows startup for GameVault itself by creating/removing
 * a GameVault.lnk in the user's Startup folder. Launch details are passed
 * in by main.ts (they differ between dev electron and a packaged build).
 */
export async function toggleAppStartup(enable: boolean, launch?: AppStartupLaunchInfo): Promise<boolean> {
  if (process.platform !== 'win32') return false;

  const appData = process.env.APPDATA || '';
  if (!appData) return false;
  const linkPath = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'GameVault.lnk');

  try {
    if (enable) {
      const target = launch?.targetPath || process.execPath;
      const args = launch?.args || '';
      const workDir = launch?.workingDir || path.dirname(target);
      const esc = (s: string) => s.replace(/'/g, "''");
      const iconLine = launch?.iconPath
        ? `\n        $link.IconLocation = '${esc(launch.iconPath)}, 0'`
        : '';
      const psCmd = `
        $ws = New-Object -ComObject WScript.Shell
        $link = $ws.CreateShortcut('${esc(linkPath)}')
        $link.TargetPath = '${esc(target)}'
        $link.Arguments = '${esc(args)}'
        $link.WorkingDirectory = '${esc(workDir)}'${iconLine}
        $link.Description = 'GameVault - Kho Game & Theo Doi Playtime'
        $link.WindowStyle = 7
        $link.Save()
      `;
      await runPowerShellScript(psCmd);
      return fs.existsSync(linkPath);
    } else {
      if (fs.existsSync(linkPath)) {
        fs.unlinkSync(linkPath);
      }
      return true;
    }
  } catch (err) {
    console.error('[settings] Failed to toggle app startup shortcut:', err);
    return false;
  }
}

// ==========================================
// Playtime Watchdog (independent background playtime counter)
// ==========================================

export const PLAYTIME_WATCH_LNK_NAME = 'PlaytimeWatch.lnk';

function getPlaytimeWatchScriptPath(): string {
  // Bundled into dist-electron — the script ships in resources/ like fps-helper.ps1
  return path.join(__dirname, '..', 'resources', 'playtime-watch.ps1');
}

function getPlaytimeWatchLogPath(): string {
  return path.join(getDbDir(), 'playtime-watch.json');
}

function getPlaytimeWatchLnkPath(): string {
  const appData = process.env.APPDATA || '';
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', PLAYTIME_WATCH_LNK_NAME);
}

/** Spawns the watchdog detached — the script's own mutex exits duplicates. */
function startPlaytimeWatchProcess(): void {
  const scriptPath = getPlaytimeWatchScriptPath();
  if (!fs.existsSync(scriptPath)) return;
  try {
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        scriptPath,
        '-LogPath',
        getPlaytimeWatchLogPath(),
      ],
      { detached: true, stdio: 'ignore' }
    ).unref();
  } catch (err) {
    console.warn('[settings] Failed to start playtime watchdog:', err);
  }
}

async function stopPlaytimeWatchProcess(): Promise<void> {
  try {
    const killCmd = `Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*playtime-watch.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    await runPowerShellScript(killCmd);
  } catch {}
}

export async function getPlaytimeWatchStatus(): Promise<PlaytimeWatchStatus> {
  const scriptPath = getPlaytimeWatchScriptPath();
  const logPath = getPlaytimeWatchLogPath();
  const lnkPath = getPlaytimeWatchLnkPath();
  const installed = fs.existsSync(scriptPath) && fs.existsSync(lnkPath);

  let isRunning = false;
  try {
    const out = await runPowerShellScript(
      `(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*playtime-watch.ps1*' } | Measure-Object).Count`
    );
    isRunning = parseInt(out.trim(), 10) > 0;
  } catch {}

  let lastLogActivity: string | null = null;
  let logExists = false;
  try {
    const st = fs.statSync(logPath);
    logExists = true;
    lastLogActivity = st.mtime.toISOString();
  } catch {}

  return { installed, isRunning, scriptPath, logPath, logExists, lastLogActivity };
}

/**
 * Installs/removes the watchdog's Startup shortcut and starts/stops the
 * background counter. The watchdog keeps counting playtime even while
 * GameVault is closed; the app imports its log on every launch.
 */
export async function togglePlaytimeWatch(enable: boolean): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const scriptPath = getPlaytimeWatchScriptPath();
  if (!fs.existsSync(scriptPath)) {
    console.warn('[settings] playtime-watch.ps1 not found at', scriptPath);
    return false;
  }
  const lnkPath = getPlaytimeWatchLnkPath();
  const escLocal = (s: string) => s.replace(/'/g, "''");

  try {
    if (enable) {
      const logPath = getPlaytimeWatchLogPath();
      const psCmd = `
        $ws = New-Object -ComObject WScript.Shell
        $link = $ws.CreateShortcut('${escLocal(lnkPath)}')
        $link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${escLocal(scriptPath)}" -LogPath "${escLocal(logPath)}"'
        $link.WorkingDirectory = '${escLocal(path.dirname(scriptPath))}'
        $link.Description = 'GameVault Playtime Watchdog - dem gio cho ngam'
        $link.WindowStyle = 7
        $link.Save()
      `;
      await runPowerShellScript(psCmd);
      if (!fs.existsSync(lnkPath)) return false;
      startPlaytimeWatchProcess();
      return true;
    } else {
      if (fs.existsSync(lnkPath)) {
        fs.unlinkSync(lnkPath);
      }
      await stopPlaytimeWatchProcess();
      return true;
    }
  } catch (err) {
    console.error('[settings] Failed to toggle playtime watch:', err);
    return false;
  }
}

/** Idempotent startup ensure: refresh the lnk and let the script's mutex dedupe. */
export async function ensurePlaytimeWatch(): Promise<void> {
  try {
    await togglePlaytimeWatch(true);
  } catch {}
}
