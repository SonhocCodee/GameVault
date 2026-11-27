import { app, type BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import type { AppUpdateStatus } from '../shared/types.js';

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

  try {
    await autoUpdater.checkForUpdates();
  } catch (err: any) {
    broadcast({
      state: 'error',
      currentVersion: app.getVersion(),
      message: err?.message || 'Không thể kiểm tra cập nhật.',
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
      percent: Math.round(progress.percent),
      message: `Đang tải bản cập nhật (${Math.round(progress.percent)}%)...`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      state: 'downloaded',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      percent: 100,
      message: `Bản v${info.version} đã tải xong. Khởi động lại để cài đặt!`,
    });
  });

  autoUpdater.on('error', (err) => {
    broadcast({
      state: 'error',
      currentVersion: app.getVersion(),
      message: err?.message || 'Lỗi khi kiểm tra cập nhật.',
    });
  });

  // Initial check 8s after launch so startup stays fast, then every 4 hours
  setTimeout(() => {
    void checkForUpdates();
  }, 8000);

  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    void checkForUpdates();
  }, 4 * 60 * 60 * 1000);
}
