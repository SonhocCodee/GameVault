import { app, type BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { getSetting, setSetting } from './db.js';
import type { AppUpdateStatus, PostUpdateInfo, RemoteReleaseNote } from '../shared/types.js';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

let currentStatus: AppUpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion(),
};

let getWindowRef: (() => BrowserWindow | null) | null = null;
let onBeforeInstallRef: (() => void) | null = null;
let initialized = false;
let checkTimer: NodeJS.Timeout | null = null;

function broadcast(next: AppUpdateStatus): void {
  currentStatus = next;
  const win = getWindowRef?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', currentStatus);
  }
}

function formatUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();

  if (lower.includes('latest.yml') && (lower.includes('404') || lower.includes('cannot find'))) {
    return 'Bản cập nhật mới đang được phát hành trên máy chủ. Vui lòng thử lại sau vài phút.';
  }
  if (
    lower.includes('err_internet_disconnected') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('net::')
  ) {
    return 'Không thể kết nối tới máy chủ cập nhật. Vui lòng kiểm tra kết nối mạng.';
  }

  const firstLine = raw.split(/\r?\n/)[0]?.trim();
  if (!firstLine) return 'Không thể kiểm tra cập nhật.';
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function extractReleaseNotes(notes: unknown): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === 'string') {
    const cleaned = notes.replace(/<[^>]+>/g, '').trim();
    return cleaned || undefined;
  }
  if (Array.isArray(notes)) {
    const joined = notes
      .map((item: any) => {
        const noteStr = typeof item?.note === 'string' ? item.note.replace(/<[^>]+>/g, '').trim() : '';
        return item?.version && noteStr ? `v${item.version}: ${noteStr}` : noteStr;
      })
      .filter(Boolean)
      .join('\n\n');
    return joined || undefined;
  }
  return undefined;
}

export function getPostUpdateInfo(): PostUpdateInfo {
  const currentVersion = app.getVersion();
  const lastSeen = getSetting('last_seen_version');
  if (lastSeen === null) {
    setSetting('last_seen_version', currentVersion);
    return {
      justUpdated: false,
      previousVersion: null,
      currentVersion,
    };
  }
  if (lastSeen !== currentVersion) {
    return {
      justUpdated: true,
      previousVersion: lastSeen,
      currentVersion,
    };
  }
  return {
    justUpdated: false,
    previousVersion: lastSeen,
    currentVersion,
  };
}

export function acknowledgePostUpdate(version?: string): boolean {
  const target = (version || app.getVersion()).replace(/^v/i, '').trim() || app.getVersion();
  setSetting('last_seen_version', target);
  return true;
}

export async function fetchGitHubReleases(): Promise<RemoteReleaseNote[]> {
  try {
    const res = await fetch('https://api.github.com/repos/SonhocCodee/GameVault/releases?per_page=8', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `GameVault/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return [];
    return data
      .filter((r) => !r.draft)
      .map((r) => ({
        version: String(r.tag_name || '').replace(/^v/i, ''),
        name: String(r.name || r.tag_name || ''),
        body: String(r.body || '').trim(),
        publishedAt: String(r.published_at || r.created_at || ''),
        url: String(r.html_url || ''),
      }));
  } catch {
    return [];
  }
}

export function getUpdateStatus(): AppUpdateStatus {
  return currentStatus;
}

export async function checkForUpdates(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    broadcast({
      state: 'dev',
      currentVersion: app.getVersion(),
      message: 'Đang chạy bản dev — auto-update chỉ hoạt động trên bản cài đặt (.exe).',
    });
    return currentStatus;
  }

  if (currentStatus.state === 'downloading' || currentStatus.state === 'downloaded') {
    return currentStatus;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (err: any) {
    broadcast({
      state: 'error',
      currentVersion: app.getVersion(),
      message: formatUpdateError(err),
    });
  }
  return currentStatus;
}

export function installUpdate(): boolean {
  if (!app.isPackaged || currentStatus.state !== 'downloaded') {
    return false;
  }
  onBeforeInstallRef?.();
  autoUpdater.quitAndInstall(false, true);
  return true;
}

export function initAutoUpdater(
  getWindow: () => BrowserWindow | null,
  onBeforeInstall: () => void
): void {
  getWindowRef = getWindow;
  onBeforeInstallRef = onBeforeInstall;

  if (initialized) return;
  initialized = true;

  currentStatus = {
    state: 'idle',
    currentVersion: app.getVersion(),
  };

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    broadcast({
      state: 'checking',
      currentVersion: app.getVersion(),
      message: 'Đang kiểm tra bản cập nhật mới...',
    });
  });

  autoUpdater.on('update-available', (info) => {
    broadcast({
      state: 'available',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseNotes: extractReleaseNotes((info as any)?.releaseNotes),
      message: `Có bản mới v${info.version}, đang tải xuống...`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    broadcast({
      state: 'not-available',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      message: `Bạn đang dùng bản mới nhất (v${app.getVersion()}).`,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      state: 'downloading',
      currentVersion: app.getVersion(),
      latestVersion: currentStatus.latestVersion,
      releaseNotes: currentStatus.releaseNotes,
      percent: Math.round(progress.percent),
      message: `Đang tải bản cập nhật (${Math.round(progress.percent)}%)...`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      state: 'downloaded',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      releaseNotes: extractReleaseNotes((info as any)?.releaseNotes) ?? currentStatus.releaseNotes,
      percent: 100,
      message: `Bản v${info.version} đã tải xong. Khởi động lại để cài đặt!`,
    });
  });

  autoUpdater.on('error', (err) => {
    broadcast({
      state: 'error',
      currentVersion: app.getVersion(),
      message: formatUpdateError(err),
    });
  });

  // Discord-style background auto-update: check shortly after launch, then every 30 minutes
  setTimeout(() => {
    void checkForUpdates();
  }, 1500);

  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    void checkForUpdates();
  }, 30 * 60 * 1000);
}
