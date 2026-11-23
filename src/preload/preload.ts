import { contextBridge, ipcRenderer } from 'electron';
import type {
  ElectronAPI,
  Game,
  Session,
  GameFilter,
  MediaItem,
  ScreenshotSyncSummary,
  ScreenshotSyncOptions,
  AMDImportSummary,
  TrackerStatus,
  SteamCoversResult,
  WebImageCandidate,
  GoogleConfig,
  IgdbConfig,
  WishlistSearchResult,
  AddWishlistPayload,
  SaveLocationCandidate,
  SavePathConfig,
  SavesListResult,
  SaveBackupResult,
  SaveRestoreResult,
  VaultInfo,
  WebSearchSummary,
  AppSettings,
  F6ProcessStatus,
  PlaytimeWatchStatus,
  HardwareInfo,
  FpsStatus,
  FpsLeaderboardEntry,
  AuthStatus,
  UserProfile,
  HardwareProfile,
  CloudReview,
  LeaderboardEntry,
  CommunityPick,
} from '../shared/types.js';

const electronAPI: ElectronAPI = {
  // Database Operations
  getGames: (filter?: GameFilter): Promise<Game[]> => {
    return ipcRenderer.invoke('db:getGames', filter);
  },
  getGameById: (id: number): Promise<Game | null> => {
    return ipcRenderer.invoke('db:getGameById', id);
  },
  createGame: (game: Partial<Game>): Promise<Game> => {
    return ipcRenderer.invoke('db:createGame', game);
  },
  updateGame: (id: number, data: Partial<Game>): Promise<Game> => {
    return ipcRenderer.invoke('db:updateGame', id, data);
  },
  deleteGame: (id: number): Promise<boolean> => {
    return ipcRenderer.invoke('db:deleteGame', id);
  },
  getSessions: (gameId?: number): Promise<Session[]> => {
    return ipcRenderer.invoke('db:getSessions', gameId);
  },

  // AMD Import
  importAMDDatabase: (customPath?: string): Promise<AMDImportSummary> => {
    return ipcRenderer.invoke('amd:import', customPath);
  },

  // Screenshot Sync
  syncScreenshots: (options?: ScreenshotSyncOptions): Promise<ScreenshotSyncSummary> => {
    return ipcRenderer.invoke('sync:screenshots', options);
  },

  // Media & Explorer
  openMediaFolder: (gameTitle: string): Promise<boolean> => {
    return ipcRenderer.invoke('media:openFolder', gameTitle);
  },
  getMediaFolderPath: (gameTitle: string): Promise<{ fullPath: string; folderName: string }> => {
    return ipcRenderer.invoke('media:getFolderPath', gameTitle);
  },
  getGameMedia: (gameTitle: string): Promise<MediaItem[]> => {
    return ipcRenderer.invoke('media:getMedia', gameTitle);
  },

  // Covers
  searchSteamCovers: (gameTitle: string, steamId?: number): Promise<SteamCoversResult> => {
    return ipcRenderer.invoke('covers:searchSteam', gameTitle, steamId);
  },
  uploadCustomCover: (gameId: number, type: 'poster' | 'banner'): Promise<string | null> => {
    return ipcRenderer.invoke('covers:uploadCustom', gameId, type);
  },
  setCoverFromScreenshot: (gameId: number, type: 'poster' | 'banner', screenshotPath: string): Promise<string> => {
    return ipcRenderer.invoke('covers:setFromScreenshot', gameId, type, screenshotPath);
  },
  enrichCovers: (): Promise<number> => {
    return ipcRenderer.invoke('covers:enrich');
  },
  searchWebImages: (gameTitle: string, kind: 'poster' | 'banner'): Promise<WebImageCandidate[]> => {
    return ipcRenderer.invoke('covers:searchWebImages', gameTitle, kind);
  },
  getGoogleConfig: (): Promise<GoogleConfig> => {
    return ipcRenderer.invoke('covers:getGoogleConfig');
  },
  setGoogleConfig: (apiKey: string, cseId: string): Promise<GoogleConfig> => {
    return ipcRenderer.invoke('covers:setGoogleConfig', apiKey, cseId);
  },
  getIgdbConfig: (): Promise<IgdbConfig> => {
    return ipcRenderer.invoke('covers:getIgdbConfig');
  },
  setIgdbConfig: (clientId: string, clientSecret: string): Promise<IgdbConfig> => {
    return ipcRenderer.invoke('covers:setIgdbConfig', clientId, clientSecret);
  },

  // Wishlist ('Chờ chơi')
  searchWishlistGames: (query: string): Promise<WishlistSearchResult[]> => {
    return ipcRenderer.invoke('wishlist:search', query);
  },
  addWishlistGame: (payload: AddWishlistPayload): Promise<Game> => {
    return ipcRenderer.invoke('wishlist:add', payload);
  },

  // Playtime Tracker
  getTrackerStatus: (): Promise<TrackerStatus> => {
    return ipcRenderer.invoke('tracker:getStatus');
  },
  updatePlaytimeManual: (gameId: number, totalMinutes: number): Promise<boolean> => {
    return ipcRenderer.invoke('tracker:updateManual', gameId, totalMinutes);
  },
  scanRunningGames: (): Promise<Game | null> => {
    return ipcRenderer.invoke('tracker:scanRunning');
  },

  // Hardware Info & FPS Monitor (PresentMon)
  getHardwareInfo: (force?: boolean): Promise<HardwareInfo> => {
    return ipcRenderer.invoke('hw:getInfo', force);
  },
  getFpsStatus: (): Promise<FpsStatus> => {
    return ipcRenderer.invoke('fps:getStatus');
  },
  setupFpsElevation: (): Promise<{ ok: boolean; taskCreated: boolean; error?: string }> => {
    return ipcRenderer.invoke('fps:setupElevation');
  },
  downloadPresentMon: (force?: boolean): Promise<string | null> => {
    return ipcRenderer.invoke('fps:downloadPresentMon', force);
  },
  getFpsLeaderboard: (): Promise<FpsLeaderboardEntry[]> => {
    return ipcRenderer.invoke('fps:getLeaderboard');
  },

  // F6 Hotkey & Real-time Auto-Sync
  getF6Status: () => {
    return ipcRenderer.invoke('f6:getStatus');
  },
  syncF6Now: () => {
    return ipcRenderer.invoke('f6:syncNow');
  },

  // Save Vault (backup / restore save game)
  getSavesList: (gameId: number): Promise<SavesListResult> => {
    return ipcRenderer.invoke('saves:getList', gameId);
  },
  detectSaveLocations: (gameId: number): Promise<SaveLocationCandidate[]> => {
    return ipcRenderer.invoke('saves:detect', gameId);
  },
  searchSaveLocationsWeb: (gameId: number, forceRefresh?: boolean): Promise<WebSearchSummary> => {
    return ipcRenderer.invoke('saves:searchWeb', gameId, forceRefresh);
  },
  addSavePath: (gameId: number, sourcePath: string, label?: string): Promise<SavePathConfig> => {
    return ipcRenderer.invoke('saves:addPath', gameId, sourcePath, label);
  },
  removeSavePath: (pathId: number): Promise<boolean> => {
    return ipcRenderer.invoke('saves:removePath', pathId);
  },
  toggleSavePath: (pathId: number, enabled: boolean): Promise<SavePathConfig> => {
    return ipcRenderer.invoke('saves:togglePath', pathId, enabled);
  },
  browseSaveFolder: (): Promise<string | null> => {
    return ipcRenderer.invoke('saves:browseFolder');
  },
  backupSavesNow: (gameId: number, note?: string): Promise<SaveBackupResult> => {
    return ipcRenderer.invoke('saves:backupNow', gameId, note);
  },
  restoreSaveBackup: (backupId: number): Promise<SaveRestoreResult> => {
    return ipcRenderer.invoke('saves:restore', backupId);
  },
  deleteSaveBackup: (backupId: number): Promise<boolean> => {
    return ipcRenderer.invoke('saves:deleteBackup', backupId);
  },
  openSaveBackupFolder: (backupId: number): Promise<boolean> => {
    return ipcRenderer.invoke('saves:openBackupFolder', backupId);
  },
  getVaultInfo: (): Promise<VaultInfo> => {
    return ipcRenderer.invoke('saves:getVaultInfo');
  },
  setVaultRoot: (rootPath: string): Promise<VaultInfo> => {
    return ipcRenderer.invoke('saves:setVaultRoot', rootPath);
  },
  uploadBackupToDrive: (backupId: number): Promise<{ drivePath: string; filesUploaded: number; bytesUploaded: number }> => {
    return ipcRenderer.invoke('drive:uploadBackup', backupId);
  },

  // Cloud auth (Google login)
  getAuthStatus: (): Promise<AuthStatus> => {
    return ipcRenderer.invoke('auth:getStatus');
  },
  login: (): Promise<UserProfile> => {
    return ipcRenderer.invoke('auth:login');
  },
  logout: (): Promise<void> => {
    return ipcRenderer.invoke('auth:logout');
  },

  // Community (cloud leaderboard / reviews / picks)
  getLeaderboard: (options?: { sortByGuMatch?: boolean }): Promise<LeaderboardEntry[]> => {
    return ipcRenderer.invoke('community:getLeaderboard', options);
  },
  getGameReviews: (gameKey: string): Promise<CloudReview[]> => {
    return ipcRenderer.invoke('community:getGameReviews', gameKey);
  },
  submitReview: (gameId: number, payload: { score: number; review: string; dropped: boolean; dropReason?: string; fps?: number }): Promise<CloudReview> => {
    return ipcRenderer.invoke('community:submitReview', gameId, payload);
  },
  deleteMyReview: (gameId: number): Promise<boolean> => {
    return ipcRenderer.invoke('community:deleteMyReview', gameId);
  },
  getMyHardwareProfile: (): Promise<HardwareProfile | null> => {
    return ipcRenderer.invoke('community:getMyHardwareProfile');
  },
  setMyHardwareProfile: (profile: HardwareProfile): Promise<HardwareProfile> => {
    return ipcRenderer.invoke('community:setMyHardwareProfile', profile);
  },
  getCurrentPick: (): Promise<CommunityPick | null> => {
    return ipcRenderer.invoke('community:getCurrentPick');
  },
  votePick: (gameId: number): Promise<CommunityPick> => {
    return ipcRenderer.invoke('community:votePick', gameId);
  },
  unvotePick: (): Promise<CommunityPick> => {
    return ipcRenderer.invoke('community:unvotePick');
  },

  // Settings & System Controls
  getSettings: (): Promise<AppSettings> => {
    return ipcRenderer.invoke('settings:get');
  },
  saveSettings: (settings: Partial<AppSettings>): Promise<AppSettings> => {
    return ipcRenderer.invoke('settings:save', settings);
  },
  browseFolder: (defaultPath?: string): Promise<string | null> => {
    return ipcRenderer.invoke('settings:browseFolder', defaultPath);
  },
  getF6ProcessStatus: (): Promise<F6ProcessStatus> => {
    return ipcRenderer.invoke('settings:getProcessStatus');
  },
  toggleF6Process: (start: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('settings:toggleProcess', start);
  },
  toggleF6Startup: (enable: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('settings:toggleStartup', enable);
  },
  toggleAppStartup: (enable: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('settings:toggleAppStartup', enable);
  },
  getPlaytimeWatchStatus: (): Promise<PlaytimeWatchStatus> => {
    return ipcRenderer.invoke('ptwatch:getStatus');
  },
  togglePlaytimeWatch: (enable: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('settings:togglePlaytimeWatch', enable);
  },

  // Real-time Event Subscriptions
  onGameAdded: (callback: (game: Game) => void) => {
    const handler = (_event: any, game: Game) => callback(game);
    ipcRenderer.on('game:added', handler);
    return () => {
      ipcRenderer.removeListener('game:added', handler);
    };
  },
  onGameUpdated: (callback: (game: Game) => void) => {
    const handler = (_event: any, game: Game) => callback(game);
    ipcRenderer.on('game:updated', handler);
    return () => {
      ipcRenderer.removeListener('game:updated', handler);
    };
  },
  onScreenshotSynced: (callback: (info: any) => void) => {
    const handler = (_event: any, info: any) => callback(info);
    ipcRenderer.on('screenshot:synced', handler);
    return () => {
      ipcRenderer.removeListener('screenshot:synced', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
