import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {
  initDb,
  closeDb,
  getGames,
  getGameById,
  getGameByTitle,
  createGame,
  updateGame,
  deleteGame,
  getSessions,
  setPlaytime,
  getFpsLeaderboard,
  recalculatePlaytime,
  mergeFragmentedSessions,
  getDb,
  getSetting,
  setSetting,
} from './db.js';
import { importAMDDatabase } from './importer.js';
import { syncScreenshots } from './sync-screenshots.js';
import { getTracker, manualEditPlaytime } from './tracker.js';
import { getFpsMonitor } from './fps-monitor.js';
import { getHardwareInfo } from './hardware.js';
import {
  registerMediaProtocolScheme,
  registerMediaProtocolHandler,
} from './protocol.js';
import {
  openMediaFolder,
  getGameMedia,
  getGameFolderPath,
  setMediaBaseDir,
  normalizeForMatch,
} from './media.js';
import { getPlaytimeWatchImporter } from './ptwatch.js';
import {
  searchSteamCovers,
  uploadCustomCover,
  setCoverFromScreenshot,
  autoEnrichAllGameCovers,
  warmUpAppCatalog,
  searchWebImages,
  getGoogleConfig,
  setGoogleConfig,
  getIgdbConfig,
  setIgdbConfig,
} from './covers.js';
import {
  searchWishlistGames,
  addWishlistGame,
} from './wishlist.js';
import { getF6CaptureManager } from './f6-capture.js';
import { getAMDWatcher } from './amd-watcher.js';
import { getAuthStatus, login, logout, getValidSessionToken, getCloudConfig, getWorkerBaseUrl } from './auth.js';
import {
  detectGoogleDriveDesktop,
  applyGoogleDriveDesktopStorage,
} from './google-drive-desktop.js';
import {
  uploadBackupToDrive,
  uploadMediaToDrive,
  downloadMediaFromDrive,
  getDriveMediaStats,
  listDriveGameBackups,
  getDriveStorageQuota,
  getActiveMediaSyncStatus,
} from './drive.js';
import {
  submitReview,
  deleteMyReview,
  getGameReviews,
  getLeaderboard,
  getMyHardwareProfile,
  setMyHardwareProfile,
  getCurrentPick,
  votePick,
  unvotePick,
  syncLibraryWithCloud,
  getCloudLibrary,
  adminGetCloudCovers,
  adminUpdateCloudCover,
  adminDeleteCloudCover,
  adminUploadCloudCover,
} from './cloud-db.js';
import {
  getSavesList,
  detectSaveLocations,
  addSavePath,
  removeSavePath,
  setSavePathEnabled,
  backupSavesNow,
  restoreSaveBackup,
  deleteSaveBackup,
  openSaveBackupFolder,
  getVaultInfo,
  setVaultRoot,
  initSaveVault,
  getSaveProfileInfo,
  setSaveProfileInfo,
  switchToMySave,
  revertToHostSave,
  applySaveBackup,
  updateSaveBackupMetadata,
  downloadAndAdoptDriveBackup,
  isGameRunning,
} from './save-manager.js';
import { searchSaveLocationsWeb } from './save-lookup-web.js';
import {
  loadAppSettings,
  saveAppSettings,
  maskSettingsSecrets,
  testStorageConnection,
  getF6ProcessStatus,
  toggleF6Process,
  toggleF6Startup,
  toggleAppStartup,
  getPlaytimeWatchStatus,
  togglePlaytimeWatch,
  ensurePlaytimeWatch,
  type AppStartupLaunchInfo,
} from './settings.js';
import type { GameFilter, Game, Session, AddWishlistPayload, AppSettings } from '../shared/types.js';

// Register privileged scheme before app ready
registerMediaProtocolScheme();

let mainWindow: BrowserWindow | null = null;

// Tray / background state: closing the window hides it instead of quitting so
// playtime tracking, AMD sync and screenshot sync keep running out of sight
let tray: Tray | null = null;
let forceQuit = false;
let closeToTrayEnabled = true;

// Single instance: a second launch (double-clicking the exe while the app
// sits in the tray) must focus the running window, never spawn a duplicate
// tracker/watcher pair
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// Handle second instance if another process is launched
app.on('second-instance', () => {
  showMainWindow();
});

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) return;
  if (process.platform !== 'win32') return;
  const iconPath = path.join(__dirname, '../assets/icon.ico');
  if (!fs.existsSync(iconPath)) return;

  tray = new Tray(iconPath);
  tray.setToolTip('GameVault — đang chạy ngầm, theo dõi giờ chơi');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở GameVault', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Thoát hoàn toàn',
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => showMainWindow());
}

/** Launch details for the Windows Startup shortcut (dev vs packaged differ). */
function getAppStartupLaunchInfo(): AppStartupLaunchInfo {
  const iconPath = path.join(__dirname, '../assets/icon.ico');
  if (app.isPackaged) {
    const exePath = app.getPath('exe');
    return {
      targetPath: exePath,
      args: '--hidden',
      workingDir: path.dirname(exePath),
      iconPath: fs.existsSync(iconPath) ? iconPath : undefined,
    };
  }
  // Dev: mirror the user's desktop shortcut (electron.exe <appDir> --hidden).
  // No quotes around the path — the lnk builder wraps the whole script in a
  // double-quoted powershell -Command, raw quotes would terminate it early
  return {
    targetPath: process.execPath,
    args: `${app.getAppPath()} --hidden`,
    workingDir: app.getAppPath(),
    iconPath: fs.existsSync(iconPath) ? iconPath : undefined,
  };
}

function createWindow(startHidden: boolean = false): BrowserWindow {
  const preloadPath = fs.existsSync(path.join(__dirname, 'preload.cjs'))
    ? path.join(__dirname, 'preload.cjs')
    : path.join(__dirname, 'preload.js');

  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '../assets/icon.ico')
    : path.join(__dirname, '../assets/icon.png');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'GameVault',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0e1015',
    autoHideMenuBar: true,
    show: !startHidden,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Remove default classic menu bar (File / Edit / View / Window)
  mainWindow.removeMenu();

  // In development, keep F12 / Ctrl+Shift+I for DevTools and F5 / Ctrl+R for reload
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow?.webContents.toggleDevTools();
        event.preventDefault();
      } else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
        mainWindow?.webContents.reload();
        event.preventDefault();
      }
    });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] Window finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[main] Window failed to load:', code, desc);
  });

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.error(`[Renderer Log ${level}] ${message} (${sourceId}:${line})`);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  // Close = hide to tray (configurable). A real quit only happens through the
  // tray menu or app.quit(), which sets forceQuit first.
  mainWindow.on('close', (event) => {
    if (closeToTrayEnabled && !forceQuit) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// Register all IPC handlers
function registerIpcHandlers(): void {
  // Database Operations
  ipcMain.handle('db:getGames', async (_event, filter?: GameFilter) => {
    return getGames(filter);
  });

  ipcMain.handle('db:getGameById', async (_event, id: number) => {
    return getGameById(id);
  });

  ipcMain.handle('db:createGame', async (_event, game: Partial<Game>) => {
    return createGame(game);
  });

  ipcMain.handle('db:updateGame', async (_event, id: number, data: Partial<Game>) => {
    return updateGame(id, data);
  });

  ipcMain.handle('db:deleteGame', async (_event, id: number) => {
    return deleteGame(id);
  });

  ipcMain.handle('db:getSessions', async (_event, gameId?: number) => {
    return getSessions(gameId);
  });

  // Playtime Tracker Manual Edit
  ipcMain.handle('tracker:updateManual', async (_event, gameId: number, totalMinutes: number) => {
    return manualEditPlaytime(gameId, totalMinutes);
  });

  ipcMain.handle('tracker:getStatus', async () => {
    return getTracker().getStatus();
  });

  // AMD Import
  ipcMain.handle('amd:import', async (_event, customPath?: string) => {
    return importAMDDatabase(customPath, { excludeUtilities: true });
  });

  // Screenshot Sync
  ipcMain.handle('sync:screenshots', async (_event, options) => {
    return syncScreenshots(options);
  });

  ipcMain.handle('media:openFolder', async (_event, gameTitle: string) => {
    // Wishlist ('Chờ chơi') games have no media folder on disk — never create one
    const game = getGameByTitle(gameTitle);
    if (game && game.status === 'backlog') {
      return false;
    }
    return openMediaFolder(gameTitle);
  });

  ipcMain.handle('media:getFolderPath', async (_event, gameTitle: string) => {
    // Wishlist games: report the future path without creating anything
    const game = getGameByTitle(gameTitle);
    if (game && game.status === 'backlog') {
      return { fullPath: '', folderName: '' };
    }
    return getGameFolderPath(gameTitle);
  });

  ipcMain.handle('media:getMedia', async (_event, gameTitle: string) => {
    return getGameMedia(gameTitle);
  });

  // Wishlist: search Steam catalogue + add as 'Chờ chơi' (cover/banner only, no media folder)
  ipcMain.handle('wishlist:search', async (_event, query: string) => {
    return searchWishlistGames(query);
  });

  ipcMain.handle('wishlist:add', async (_event, payload: AddWishlistPayload) => {
    return addWishlistGame(payload);
  });

  ipcMain.handle('covers:searchSteam', async (_event, gameTitle: string, steamId?: number) => {
    return searchSteamCovers(gameTitle, steamId);
  });

  ipcMain.handle('covers:uploadCustom', async (_event, gameId: number, type: 'poster' | 'banner') => {
    return uploadCustomCover(gameId, type);
  });

  ipcMain.handle('covers:setFromScreenshot', async (_event, gameId: number, type: 'poster' | 'banner', screenshotPath: string) => {
    return setCoverFromScreenshot(gameId, type, screenshotPath);
  });

  // Manual re-scan: enrich games missing covers + repair dead Steam CDN URLs
  ipcMain.handle('covers:enrich', async () => {
    return autoEnrichAllGameCovers();
  });

  // Web image search (Google Custom Search) for the cover picker
  ipcMain.handle('covers:searchWebImages', async (_event, gameTitle: string, kind: 'poster' | 'banner') => {
    return searchWebImages(gameTitle, kind);
  });

  ipcMain.handle('covers:getGoogleConfig', async () => {
    return getGoogleConfig();
  });

  ipcMain.handle('covers:setGoogleConfig', async (_event, apiKey: string, cseId: string) => {
    return setGoogleConfig(apiKey, cseId);
  });

  ipcMain.handle('covers:getIgdbConfig', async () => {
    return getIgdbConfig();
  });

  ipcMain.handle('covers:setIgdbConfig', async (_event, clientId: string, clientSecret: string) => {
    return setIgdbConfig(clientId, clientSecret);
  });

  // F6 Hotkey & Real-time Screenshot Sync
  ipcMain.handle('f6:getStatus', async () => {
    return getF6CaptureManager().getStatus();
  });

  ipcMain.handle('f6:syncNow', async () => {
    return getF6CaptureManager().scanAndSync();
  });

  ipcMain.handle('tracker:scanRunning', async () => {
    return getTracker().scanRunningProcesses();
  });

  // Save Vault (backup / restore save game) — initialized lazily on first
  // use so app startup never stats the (often HDD-hosted) vault root
  let saveVaultReady = false;
  const ensureSaveVault = (): void => {
    if (saveVaultReady) return;
    saveVaultReady = true;
    try {
      initSaveVault();
    } catch (err) {
      console.warn('[main] Save Vault init failed:', err);
    }
  };

  ipcMain.handle('saves:getList', async (_event, gameId: number) => {
    ensureSaveVault();
    return getSavesList(gameId);
  });

  ipcMain.handle('saves:detect', async (_event, gameId: number) => {
    ensureSaveVault();
    const game = getGameById(gameId);
    if (!game) {
      throw new Error(`Game with id ${gameId} not found`);
    }
    return detectSaveLocations(game);
  });

  ipcMain.handle('saves:searchWeb', async (_event, gameId: number, forceRefresh?: boolean) => {
    return searchSaveLocationsWeb(gameId, { forceRefresh });
  });

  ipcMain.handle('saves:addPath', async (_event, gameId: number, sourcePath: string, label?: string) => {
    ensureSaveVault();
    return addSavePath(gameId, sourcePath, label);
  });

  ipcMain.handle('saves:removePath', async (_event, pathId: number) => {
    ensureSaveVault();
    return removeSavePath(pathId);
  });

  ipcMain.handle('saves:togglePath', async (_event, pathId: number, enabled: boolean) => {
    ensureSaveVault();
    return setSavePathEnabled(pathId, enabled);
  });

  ipcMain.handle('saves:browseFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Chọn folder save game',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('saves:backupNow', async (_event, gameId: number, note?: string) => {
    ensureSaveVault();
    return backupSavesNow(gameId, note);
  });

  ipcMain.handle('saves:restore', async (_event, backupId: number) => {
    ensureSaveVault();
    return restoreSaveBackup(backupId);
  });

  ipcMain.handle('saves:deleteBackup', async (_event, backupId: number) => {
    ensureSaveVault();
    return deleteSaveBackup(backupId);
  });

  ipcMain.handle('saves:openBackupFolder', async (_event, backupId: number) => {
    ensureSaveVault();
    return openSaveBackupFolder(backupId);
  });

  ipcMain.handle('saves:getVaultInfo', async () => {
    ensureSaveVault();
    return getVaultInfo();
  });

  ipcMain.handle('saves:setVaultRoot', async (_event, rootPath: string) => {
    ensureSaveVault();
    return setVaultRoot(rootPath);
  });

  ipcMain.handle('saves:getProfileInfo', async (_event, gameId: number) => {
    ensureSaveVault();
    return getSaveProfileInfo(gameId);
  });

  ipcMain.handle('saves:setProfileInfo', async (_event, gameId: number, patch: any) => {
    ensureSaveVault();
    return setSaveProfileInfo(gameId, patch);
  });

  ipcMain.handle('saves:switchToMySave', async (_event, gameId: number, options?: { targetBackupId?: number }) => {
    ensureSaveVault();
    return switchToMySave(gameId, options);
  });

  ipcMain.handle('saves:revertToHostSave', async (_event, gameId: number) => {
    ensureSaveVault();
    return revertToHostSave(gameId);
  });

  ipcMain.handle('saves:applyBackup', async (_event, gameId: number, backupId: number, asProfile?: any) => {
    ensureSaveVault();
    return applySaveBackup(gameId, backupId, asProfile);
  });

  ipcMain.handle(
    'saves:updateMetadata',
    async (_event, backupId: number, patch: { note?: string | null; trigger?: any }) => {
      ensureSaveVault();
      return updateSaveBackupMetadata(backupId, patch);
    }
  );

  ipcMain.handle('saves:isGameRunning', async (_event, gameId: number) => {
    return isGameRunning(gameId);
  });

  // Hardware Info & FPS Monitor (PresentMon — dữ liệu cho bảng xếp hạng hiệu năng)
  ipcMain.handle('hw:getInfo', async (_event, force?: boolean) => {
    return getHardwareInfo(Boolean(force));
  });

  ipcMain.handle('fps:getStatus', async () => {
    return getFpsMonitor().getStatus();
  });

  ipcMain.handle('fps:setupElevation', async () => {
    return getFpsMonitor().setupElevation();
  });

  // Tải PresentMon chính thức (cần cho máy NVIDIA không có bản AMD bundle)
  ipcMain.handle('fps:downloadPresentMon', async (_event, force?: boolean) => {
    return getFpsMonitor().ensurePresentMon(Boolean(force));
  });

  ipcMain.handle('fps:getLeaderboard', async () => {
    return getFpsLeaderboard();
  });

  // Settings & System Preferences
  ipcMain.handle('settings:get', async () => {
    return maskSettingsSecrets(loadAppSettings());
  });

  ipcMain.handle('settings:save', async (_event, patch: Partial<AppSettings>) => {
    const updated = saveAppSettings(patch);
    const f6 = getF6CaptureManager();
    f6.setHotkey(updated.screenshotHotkey, updated.screenshotHotkeyVk);
    f6.setEnabled(updated.screenshotEnabled);
    f6.setPaths(updated.screenshotsDir, updated.mediaBaseDir);
    f6.setHddMode(updated.hddMode);

    const tracker = getTracker();
    tracker.autoDetectNewGames = updated.autoDetectGames;

    // Media storage drive (đổi ổ lưu ảnh): re-route resolvers + create the
    // folder so a typo doesn't silently break screenshot/media sync
    if (patch.mediaBaseDir !== undefined) {
      setMediaBaseDir(updated.mediaBaseDir);
      try {
        fs.mkdirSync(updated.mediaBaseDir, { recursive: true });
      } catch {}
    }

    // Tray behavior + Windows auto-start + playtime watchdog
    if (patch.closeToTray !== undefined) {
      closeToTrayEnabled = updated.closeToTray;
    }
    if (patch.appStartupEnabled !== undefined) {
      toggleAppStartup(updated.appStartupEnabled, getAppStartupLaunchInfo()).catch(() => {});
    }
    if (patch.playtimeWatchEnabled !== undefined) {
      togglePlaytimeWatch(updated.playtimeWatchEnabled).catch(() => {});
    }
    const ptWatch = getPlaytimeWatchImporter();
    ptWatch.autoRegisterGames = updated.autoDetectGames;

    return maskSettingsSecrets(updated);
  });

  ipcMain.handle('settings:testStorageConnection', async (_event, settingsPatch?: Partial<AppSettings>) => {
    const current = loadAppSettings();
    const merged = { ...current, ...(settingsPatch || {}) };
    let googleToken: string | null = null;
    try {
      const { getValidGoogleAccessToken } = await import('./auth.js');
      googleToken = await getValidGoogleAccessToken();
    } catch {}
    return testStorageConnection(merged, fetch, googleToken);
  });

  ipcMain.handle('settings:toggleAppStartup', async (_event, enable: boolean) => {
    return toggleAppStartup(enable, getAppStartupLaunchInfo());
  });

  ipcMain.handle('ptwatch:getStatus', async () => {
    return getPlaytimeWatchStatus();
  });

  ipcMain.handle('settings:togglePlaytimeWatch', async (_event, enable: boolean) => {
    return togglePlaytimeWatch(enable);
  });

  ipcMain.handle('settings:browseFolder', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Chọn thư mục',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('settings:getProcessStatus', async () => {
    return getF6ProcessStatus();
  });

  ipcMain.handle('settings:toggleProcess', async (_event, start: boolean) => {
    return toggleF6Process(start);
  });

  ipcMain.handle('settings:toggleStartup', async (_event, enable: boolean) => {
    return toggleF6Startup(enable);
  });

  // Google Drive for Desktop (Virtual Disk G:)
  ipcMain.handle('gdriveDesktop:detect', async () => {
    const settings = loadAppSettings();
    return detectGoogleDriveDesktop(settings.mediaBaseDir);
  });

  ipcMain.handle('gdriveDesktop:apply', async (_event, customPath?: string) => {
    const res = await applyGoogleDriveDesktopStorage(customPath);
    if (res.ok) {
      const f6 = getF6CaptureManager();
      f6.setPaths(undefined, res.settings.mediaBaseDir);
      f6.setHddMode(res.settings.hddMode);
    }
    return res;
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Cloud auth (Google login)
  ipcMain.handle('auth:getStatus', async () => {
    return getAuthStatus();
  });

  ipcMain.handle('auth:login', async () => {
    return login();
  });

  ipcMain.handle('auth:logout', async () => {
    await logout();
    return true;
  });

  // Community (cloud leaderboard / reviews / picks)
  ipcMain.handle('community:getLeaderboard', async (_event, options?: { sortByGuMatch?: boolean }) => {
    return getLeaderboard(options || {});
  });

  ipcMain.handle('community:getGameReviews', async (_event, gameKey: string) => {
    return getGameReviews(gameKey);
  });

  ipcMain.handle('community:submitReview', async (
    _event,
    gameId: number,
    payload: { score: number; review: string; dropped: boolean; dropReason?: string; fps?: number }
  ) => {
    return submitReview(gameId, payload);
  });

  ipcMain.handle('community:deleteMyReview', async (_event, gameId: number) => {
    return deleteMyReview(gameId);
  });

  ipcMain.handle('community:getMyHardwareProfile', async () => {
    return getMyHardwareProfile();
  });

  ipcMain.handle('community:setMyHardwareProfile', async (_event, profile: { gpu: string; cpu: string; ramGb: number }) => {
    return setMyHardwareProfile(profile);
  });

  ipcMain.handle('community:getCurrentPick', async () => {
    return getCurrentPick();
  });

  ipcMain.handle('community:votePick', async (_event, gameId: number) => {
    const game = getGameById(gameId);
    if (!game) {
      throw new Error(`Game with id ${gameId} not found`);
    }
    return votePick(game);
  });

  ipcMain.handle('community:unvotePick', async () => {
    return unvotePick();
  });

  // Drive (Save Vault lên Google Drive của người dùng — appDataFolder riêng tư)
  ipcMain.handle('drive:uploadBackup', async (_event, backupId: number) => {
    return uploadBackupToDrive(backupId);
  });

  ipcMain.handle('drive:listGameBackups', async (_event, gameTitle: string) => {
    return listDriveGameBackups(gameTitle);
  });

  ipcMain.handle('drive:downloadCloudBackup', async (_event, gameId: number, drivePath: string) => {
    ensureSaveVault();
    return downloadAndAdoptDriveBackup(gameId, drivePath);
  });

  // Multi-device game library sync
  ipcMain.handle('community:syncLibrary', async () => {
    return syncLibraryWithCloud();
  });
  ipcMain.handle('community:getCloudLibrary', async () => {
    return getCloudLibrary();
  });

  // Admin Covers Management
  const syncAdminCoverToLocalGames = (
    gameKey: string,
    title?: string | null,
    coverUrl?: string | null,
    bannerUrl?: string | null
  ) => {
    try {
      const localGames = getGames();
      const normKey = gameKey.toLowerCase().trim();
      const normTitle = (title || '').toLowerCase().trim();
      for (const g of localGames) {
        const key1 = g.steam_id ? String(g.steam_id) : '';
        const key2 = `t_${normalizeForMatch(g.title)}`;
        if (key1 === normKey || key2 === normKey || (normTitle && g.title.toLowerCase().trim() === normTitle)) {
          const patch: any = {};
          if (coverUrl) patch.cover_url = coverUrl;
          if (bannerUrl) patch.banner_url = bannerUrl;
          if (Object.keys(patch).length > 0) {
            const updated = updateGame(g.id, patch);
            mainWindow?.webContents?.send('game:updated', updated);
          }
        }
      }
    } catch (err) {
      console.warn('[main] Failed to sync admin cover update to local game:', err);
    }
  };

  ipcMain.handle('admin:getCovers', async (_event, params?: { query?: string; limit?: number; offset?: number }) => {
    return adminGetCloudCovers(params);
  });

  ipcMain.handle('admin:updateCover', async (_event, gameKey: string, payload: any) => {
    const result = await adminUpdateCloudCover(gameKey, payload);
    syncAdminCoverToLocalGames(
      gameKey,
      result.cover?.title || payload?.title,
      result.cover?.cover_url,
      result.cover?.banner_url
    );
    return result;
  });

  ipcMain.handle('admin:deleteCover', async (_event, gameKey: string) => {
    return adminDeleteCloudCover(gameKey);
  });

  ipcMain.handle('admin:uploadCover', async (_event, gameKey: string, type: 'poster' | 'banner', filePath?: string, meta?: { title?: string; steamId?: number }) => {
    let targetPath = filePath;
    if (!targetPath) {
      const res = await dialog.showOpenDialog(mainWindow!, {
        title: `Chọn ảnh ${type === 'poster' ? 'Poster (2:3)' : 'Banner (16:9)'}`,
        properties: ['openFile'],
        filters: [{ name: 'Hình ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
      });
      if (res.canceled || res.filePaths.length === 0) return null;
      targetPath = res.filePaths[0];
    }
    const ext = path.extname(targetPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    const mimeType = mimeMap[ext] || 'image/jpeg';
    const buf = fs.readFileSync(targetPath);
    const uploadRes = await adminUploadCloudCover(gameKey, type, buf, mimeType, meta);
    syncAdminCoverToLocalGames(
      gameKey,
      uploadRes.cover?.title || meta?.title,
      uploadRes.cover?.cover_url || (type === 'poster' ? uploadRes.url : undefined),
      uploadRes.cover?.banner_url || (type === 'banner' ? uploadRes.url : undefined)
    );
    return uploadRes.url;
  });

  ipcMain.handle('admin:openWebPortal', async () => {
    const baseUrl = getWorkerBaseUrl(getCloudConfig());
    let token = '';
    try {
      token = await getValidSessionToken();
    } catch {}
    const portalUrl = token ? `${baseUrl}/admin/#token=${encodeURIComponent(token)}` : `${baseUrl}/admin/`;
    await shell.openExternal(portalUrl);
    return true;
  });

  // Media (Screenshot) sync via Google Drive
  ipcMain.handle('drive:uploadMedia', async (_event, options?: { gameTitle?: string; localMediaBaseDir?: string }) => {
    try {
      return await uploadMediaToDrive({
        ...options,
        onProgress: (prog) => {
          mainWindow?.webContents.send('drive:mediaProgress', prog);
        },
      });
    } finally {
      mainWindow?.webContents.send('drive:mediaProgress', {
        type: 'upload',
        current: 0,
        total: 0,
        percent: 100,
        currentFile: '',
        currentGame: '',
        bytesTransferred: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        formattedSpeed: '0 KB/s',
        formattedTransferred: '0 MB',
        formattedTotal: '0 MB',
      });
    }
  });
  ipcMain.handle('drive:downloadMedia', async (_event, options?: { gameTitle?: string; localMediaBaseDir?: string }) => {
    try {
      return await downloadMediaFromDrive({
        ...options,
        onProgress: (prog) => {
          mainWindow?.webContents.send('drive:mediaProgress', prog);
        },
      });
    } finally {
      mainWindow?.webContents.send('drive:mediaProgress', {
        type: 'download',
        current: 0,
        total: 0,
        percent: 100,
        currentFile: '',
        currentGame: '',
        bytesTransferred: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        formattedSpeed: '0 KB/s',
        formattedTransferred: '0 MB',
        formattedTotal: '0 MB',
      });
    }
  });
  ipcMain.handle('drive:getMediaStats', async () => {
    return getDriveMediaStats();
  });
  ipcMain.handle('drive:getStorageQuota', async () => {
    return getDriveStorageQuota();
  });
  ipcMain.handle('drive:getActiveMediaSync', async () => {
    return getActiveMediaSyncStatus();
  });
}

// App lifecycle
app.whenReady().then(() => {
  // Register custom game-media:// streaming protocol handler
  registerMediaProtocolHandler();

  // Initialize Database
  initDb();

  // One-time playtime recalculation: the union of session intervals repairs
  // totals frozen by the old MAX(stored, AMD PlayTotal) logic — imported
  // sessions were never credited while a manual edit sat above AMD's counter
  try {
    if (getSetting('playtime_recalc_v1') === null) {
      const recalc = recalculatePlaytime();
      setSetting('playtime_recalc_v1', 'done');
      console.log(`[main] Playtime recalc v1: ${recalc.updated} games updated (+${recalc.creditedMinutes} min)`);
    }
  } catch (err) {
    console.warn('[main] Playtime recalc v1 failed:', err);
  }

  // Adopt an existing Save Vault (fresh install after app reinstall).
  // Lazy: the real init runs on the first saves:* IPC call, so startup
  // never stats the (often HDD-hosted) vault root
  registerIpcHandlers();

  // Settings must be known before the window exists: auto-start launches
  // with --hidden and the window then opens straight into the tray
  const appSettings = loadAppSettings();
  closeToTrayEnabled = appSettings.closeToTray;
  // Route every media resolver through the user's chosen storage drive
  setMediaBaseDir(appSettings.mediaBaseDir);
  const startHidden = process.argv.includes('--hidden') || process.argv.includes('--minimized');

  // Disable default application menu bar globally
  Menu.setApplicationMenu(null);

  // Create Window immediately for instant UX
  createWindow(startHidden);
  createTray();

  // Re-ensure the Startup shortcut exists (e.g. after a folder cleanup)
  if (appSettings.appStartupEnabled) {
    toggleAppStartup(true, getAppStartupLaunchInfo())
      .then((ok) => console.log(`[main] Startup shortcut ensured: ${ok}`))
      .catch((err) => console.warn('[main] Startup ensure failed:', err));
  }

  // Playtime watchdog: keep the Startup shortcut fresh and the background
  // counter running (its mutex dedupes instances) — it counts playtime
  // even while GameVault is closed and this importer syncs the log on launch
  if (appSettings.playtimeWatchEnabled) {
    ensurePlaytimeWatch();
  }
  const ptWatch = getPlaytimeWatchImporter();
  ptWatch.autoRegisterGames = appSettings.autoDetectGames;
  ptWatch.start(5000);

  // Auto-enrich covers asynchronously in background without delaying window display
  setTimeout(() => {
    try {
      autoEnrichAllGameCovers();
    } catch {}
    // Pre-warm the Steam catalog mirror so wishlist search has instant
    // results even on networks where Valve's endpoints are ISP-blocked
    try {
      warmUpAppCatalog();
    } catch {}
  }, 1000);

  // Periodic re-scan: unreleased games publish art on Steam later — every 6h
  // the backend re-resolves covers that are still empty so "game nào của
  // Steam cũng luôn có ảnh" without any user action.
  setInterval(() => {
    try {
      autoEnrichAllGameCovers();
    } catch {}
  }, 6 * 60 * 60 * 1000);

  // Start AMD Adrenalin Live Auto-Sync Watcher
  if (appSettings.amdWatcherEnabled) {
    const amdWatcher = getAMDWatcher();
    amdWatcher.onGameAdded = (game) => {
      mainWindow?.webContents.send('game:added', game);
    };
    amdWatcher.start(5000);
  }

  // Start Zero-Impact Playtime Tracker
  const tracker = getTracker();
  tracker.autoDetectNewGames = appSettings.autoDetectGames;
  tracker.onCoversUpdated = (game) => {
    mainWindow?.webContents.send('game:updated', game);
  };
  // Dọn các phiên tracker bị vụn (1 phút/phiên do bug foreground detection
  // trước đây) thành phiên liền mạch trước khi tracker start
  try {
    const mergeSummary = mergeFragmentedSessions(getDb());
    if (mergeSummary.removedRows > 0) {
      console.log(
        `[tracker] Merged ${mergeSummary.mergedGroups} fragmented session chains ` +
        `(-${mergeSummary.removedRows} rows)`
      );
    }
  } catch {}
  // FPS capture lifecycle: attach PresentMon khi session bắt đầu, gỡ & lưu
  // metrics vào session row khi session kết thúc (đã setup Scheduled Task)
  const fpsMonitor = getFpsMonitor();
  fpsMonitor.recoverOrphans();
  tracker.onSessionStarted = (info) => {
    fpsMonitor.startCapture({
      sessionId: info.sessionId,
      exeName: info.processName,
      processId: info.pid,
    });
  };
  tracker.onSessionClosed = (result) => {
    fpsMonitor.finishCapture(result).catch(() => {});
  };
  tracker.start((appSettings.pollIntervalSeconds || 5) * 1000);

  // Máy NVIDIA không có PresentMon bundle như AMD — tự tải bản chính thức
  // (GitHub GameTechDev/PresentMon) một lần nếu chưa có, cache vào bin/
  fpsMonitor.ensurePresentMon().catch(() => {});

  // Start Hotkey Screenshot Capture & Auto-sync Engine
  const f6Manager = getF6CaptureManager();
  f6Manager.setHotkey(appSettings.screenshotHotkey, appSettings.screenshotHotkeyVk);
  f6Manager.setEnabled(appSettings.screenshotEnabled);
  f6Manager.setPaths(appSettings.screenshotsDir, appSettings.mediaBaseDir);
  f6Manager.setHddMode(appSettings.hddMode);
  f6Manager.onScreenshotSynced = (info) => {
    mainWindow?.webContents.send('screenshot:synced', info);
  };
  f6Manager.start(50);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('before-quit', () => {
  // Allow the close-to-tray interceptor to let the window die for real
  forceQuit = true;
});

app.on('will-quit', () => {
  // Destroy the tray icon so no ghost icon lingers in the system tray
  try {
    tray?.destroy();
    tray = null;
  } catch {}
});

app.on('window-all-closed', () => {
  getAMDWatcher().stop();
  getF6CaptureManager().stop();
  getTracker().stop();
  getPlaytimeWatchImporter().stop();
  closeDb();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
