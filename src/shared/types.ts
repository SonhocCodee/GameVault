export type GameStatus = 'playing' | 'completed' | 'paused' | 'dropped' | 'backlog';

export type SessionSource = 'amd_import' | 'tracker' | 'manual';

export interface Game {
  id: number;
  title: string;
  exe_name?: string | null;
  exe_path?: string | null;
  playtime_minutes: number;
  user_rating?: number | null; // Rating from 1 to 10
  status: GameStatus;
  cover_url?: string | null;
  banner_url?: string | null;
  media_folder?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  steam_id?: number;
  uplay_id?: number;
  origin_id?: number;
  amd_game_id?: number | null;
  last_played_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  game_id: number;
  pid?: number | null;
  start_time: string; // ISO-8601 string 'YYYY-MM-DDTHH:MM:SS'
  end_time?: string | null; // ISO-8601 string 'YYYY-MM-DDTHH:MM:SS'
  duration_minutes: number;
  is_running: number; // 0 or 1
  last_poll?: string | null; // Last poll timestamp while is_running (orphan recovery)
  source: SessionSource;
  created_at: string;
  game_title?: string; // Joined title when querying sessions
  // FPS metrics measured by PresentMon during this session (null = chưa đo)
  fps_avg?: number | null; // FPS trung bình cả phiên
  fps_samples?: number | null; // Số frame đã sample (để weighted-average giữa các phiên)
  fps_1pct_low?: number | null; // 1% low FPS (độ mượt)
}

// ==========================================
// Hardware Info & FPS Leaderboard (bảng xếp hạng hiệu năng)
// ==========================================

export interface HardwareGpu {
  name: string;
  driver: string;
  vram_mb: number;
}

export interface HardwareInfo {
  collected_at: string;
  os_name: string;
  os_build: string;
  cpu_name: string;
  cpu_cores: number;
  cpu_threads: number;
  ram_gb: number;
  gpus: HardwareGpu[];
  display: { width: number; height: number; refresh_hz: number } | null;
  presentmon_path: string | null;
}

/** Trạng thái hệ đo FPS (PresentMon + Scheduled Task elevation). */
export interface FpsStatus {
  platformSupported: boolean;
  presentMonFound: boolean;
  presentMonPath: string | null;
  taskInstalled: boolean;
  ready: boolean; // đủ điều kiện đo FPS (tìm thấy PresentMon + task đã tạo)
}

export interface FpsLeaderboardEntry {
  game_id: number;
  title: string;
  cover_url: string | null;
  fps_avg: number; // weighted average theo số frame sample
  best_fps: number; // phiên tốt nhất
  worst_fps: number; // phiên kém nhất
  fps_1pct_low: number; // weighted 1% low
  samples: number; // tổng số frame đã đo
  sessions_with_fps: number;
  last_measured: string | null; // end_time của phiên đo gần nhất
}

export interface MediaItem {
  id?: string;
  name: string;
  path: string;
  url: string; // Custom protocol game-media:// or web url
  type: 'image' | 'video';
  size: number;
  createdAt: string;
  captureDate?: string;
}

export interface UnmatchedScreenshot {
  file: string;
  path: string;
  timestamp: string;
}

export interface ScreenshotSyncDetail {
  file: string;
  gameTitle: string;
  targetPath?: string;
}

export interface ScreenshotSyncSummary {
  matched: number;
  moved: number;
  details: ScreenshotSyncDetail[];
  unmatched?: UnmatchedScreenshot[];
}

export interface ScreenshotSyncOptions {
  dryRun?: boolean;
  targetGameId?: number;
  unmatchedFiles?: string[];
}

export interface AMDImportSummary {
  importedGames: number;
  importedSessions: number;
  skippedGames?: number;
}

// ==========================================
// Save Vault (backup / restore save game)
// ==========================================

/** Một folder save đã khai báo cho 1 game (game lưu save ở nhiều chỗ là bình thường). */
export interface SavePathConfig {
  id: number;
  game_id: number;
  source_path: string;
  label: string;
  enabled: number; // 0 or 1
  created_at: string;
}

export type SaveBackupTrigger = 'manual' | 'pre_restore' | 'host_snapshot' | 'my_save';

export type ActiveSaveProfile = 'host' | 'my_save' | 'custom' | null;

export interface SaveProfileInfo {
  gameId: number;
  activeProfile: ActiveSaveProfile;
  hostBackupId: number | null;
  myBackupId: number | null;
  lastSwappedAt: string | null;
  isGameRunning: boolean;
}

export interface SaveProfileSwapResult {
  success: boolean;
  targetProfile: 'host' | 'my_save';
  restoredBackupId: number;
  safetyBackupId: number | null;
  restored: Array<{ sourcePath: string; files: number }>;
  errors: string[];
}

/** Một bản backup (1 folder timestamp trong vault). */
export interface SaveBackup {
  id: number;
  game_id: number;
  backup_dir: string; // đường dẫn tuyệt đến folder timestamp
  slot_time: string; // 'YYYY-MM-DD_HHMMSS'
  size_bytes: number;
  file_count: number;
  trigger: SaveBackupTrigger;
  note?: string | null;
  created_at: string;
}

/** Folder save nghi vấn tìm thấy khi quét tự động. */
export interface SaveLocationCandidate {
  path: string;
  folderName: string;
  sizeBytes: number;
  fileCount: number;
  matchReason: string; // 'title' | 'exe' | 'install_dir' | ...
  confidence: 'high' | 'medium' | 'low';
}

export interface SaveBackupSourceResult {
  sourcePath: string;
  status: 'copied' | 'skipped_missing' | 'skipped_empty' | 'error';
  files: number;
  bytes: number;
  error?: string;
}

export interface SaveBackupResult {
  backupId: number;
  backupDir: string;
  slotTime: string;
  sources: SaveBackupSourceResult[];
  totalFiles: number;
  totalBytes: number;
}

export interface SaveRestoreResult {
  restored: Array<{ sourcePath: string; files: number }>;
  safetyBackupId: number | null; // backup an toàn của save hiện tại trước khi ghi đè
  errors: string[];
}

export interface VaultInfo {
  root: string;
  configured: boolean; // đã set trong DB hay đang dùng default/pointer
  markerFound: boolean; // folder có gamevault.vault.json
  isDirectory: boolean;
  totalBackups: number;
}

export interface SavesListResult {
  paths: SavePathConfig[];
  backups: SaveBackup[];
  vault: VaultInfo;
  profileInfo: SaveProfileInfo;
}

export interface DriveGameBackup {
  id: string; // drive folder id
  slotTime: string;
  drivePath: string; // 'GameVault/GameName/2026-11-23_110000'
}

/** Folder save tìm thấy trên web (search engine + trang kết quả). */
export interface WebSaveCandidate {
  rawPath: string; // path như trên trang web (đã decode HTML entities)
  resolvedPath: string; // đã mở biến (%APPDATA%, <path-to-game>...) thành đường dẫn thật
  exists: boolean; // folder tồn tại trên máy này
  source: string; // domain nguồn, vd 'pcgamingwiki.com'
  url: string; // trang phát hiện ra path
  confidence: 'high' | 'medium' | 'low';
  selectable: boolean; // false khi path còn placeholder không mở được (<SteamID>...)
}

export interface WebSearchSummary {
  query: string;
  candidates: WebSaveCandidate[];
  cached: boolean;
  errors: string[];
}

// ==========================================
// Cloud / Community (Google login + Firestore)
// ==========================================

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string;
}

export interface HardwareProfile {
  gpu: string;
  cpu: string;
  ramGb: number;
}

export interface AuthStatus {
  loggedIn: boolean;
  profile: UserProfile | null;
  configPresent: boolean;
}

export interface CloudConfig {
  workerApiUrl?: string;
  oauthClientId: string;
  oauthClientSecret: string;
  firebaseApiKey?: string;
  firebaseProjectId?: string;
}

/** Một review công khai trên Firestore (collection `ratings`). */
export interface CloudReview {
  uid: string;
  gameKey: string;
  gameTitle: string;
  coverUrl?: string | null;
  score: number; // 1-10
  review: string;
  dropped: boolean;
  dropReason?: string | null;
  playtimeMinutes: number;
  fps?: number | null;
  updatedAt: string;
  // Join data (enrich khi đọc)
  authorName?: string;
  authorPhoto?: string;
  authorHw?: HardwareProfile | null;
}

export interface LeaderboardEntry {
  gameKey: string;
  gameTitle: string;
  coverUrl?: string | null;
  avgScore: number;
  reviewCount: number;
  dropRate: number; // 0-1
  totalPlaytimeMinutes: number;
  guMatchScore?: number | null; // 0-100, tương quan gu với người xem
  myScore?: number | null;
}

export interface CommunityPick {
  month: string; // 'YYYY-MM'
  gameKey: string;
  gameTitle: string;
  coverUrl?: string | null;
  votes: Record<string, string>; // uid → gameKey đã vote
  state: 'voting' | 'playing' | 'done';
}

export interface UserLibraryItem {
  gameKey: string;
  title: string;
  steamId?: number | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  status: GameStatus;
  playtimeMinutes: number;
  lastPlayed?: string | null;
  userScore?: number | null;
  userNotes?: string | null;
  isDeleted?: boolean;
  clientUpdatedAt?: string;
  serverUpdatedAt?: string;
}

export interface LibrarySyncStats {
  total: number;
  completed: number;
  playing: number;
  backlog: number;
  paused: number;
  dropped: number;
  totalPlaytimeMinutes: number;
}

export interface LibrarySyncResponse {
  games: UserLibraryItem[];
  syncedAt: string;
  stats: LibrarySyncStats;
}

export interface LibrarySyncResult {
  pushed: number;
  pulled: number;
  updated: number;
  completedCount: number;
  totalCount: number;
  timestamp: string;
  stats?: LibrarySyncStats;
}

export interface DriveMediaSyncResult {
  gamesProcessed: number;
  filesUploaded: number;
  bytesUploaded: number;
  errors?: string[];
}

export interface DriveMediaRestoreResult {
  gamesRestored: number;
  filesDownloaded: number;
  localBaseDir: string;
}

export interface DriveMediaStats {
  gamesCount: number;
  filesCount: number;
}

export interface DriveStorageQuota {
  limitBytes: number;
  usageBytes: number;
  usageInDriveBytes: number;
  percentUsed: number;
  formattedLimit: string;
  formattedUsage: string;
}

export interface DriveMediaProgress {
  type: 'upload' | 'download';
  current: number;
  total: number;
  percent: number;
  currentFile: string;
  currentGame: string;
  bytesTransferred: number;
}

export interface ActiveMediaSyncStatus {
  isRunning: boolean;
  type?: 'upload' | 'download';
  progress?: DriveMediaProgress | null;
  result?: any;
  error?: string | null;
}

export interface TrackerStatus {
  isTracking: boolean;
  activeGameTitle: string | null;
  activeProcessName?: string | null;
  sessionStartTime?: string | null;
}

export interface SteamCoversResult {
  posterUrl?: string;
  bannerUrl?: string;
  poster?: string;
  banner?: string;
  /** Steam AppID the result was resolved from (undefined when nothing matched). */
  appId?: number;
}

export interface WebImageCandidate {
  url: string;
  width?: number;
  height?: number;
  snippet?: string;
}

export interface GoogleConfig {
  apiKey?: string;
  cseId?: string;
}

export interface IgdbConfig {
  clientId?: string;
  clientSecret?: string;
}

export type ImageStorageProvider = 'cloudflare_r2' | 'google_drive' | 'google_photos';

export interface CustomS3Config {
  enabled: boolean;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  publicUrlBase?: string;
  hasSecretKey?: boolean;
}

export interface AppSettings {
  screenshotEnabled: boolean;
  screenshotHotkey: string;
  screenshotHotkeyVk: number;
  screenshotsDir: string;
  mediaBaseDir: string;
  vaultRoot: string;
  autoDetectGames: boolean;
  pollIntervalSeconds: number;
  amdWatcherEnabled: boolean;
  autoEnrichCovers: boolean;
  /** Closing the window hides to tray instead of quitting — playtime tracking keeps running. */
  closeToTray: boolean;
  /** Launch GameVault itself at Windows startup (starts hidden in tray). */
  appStartupEnabled: boolean;
  /** One-time setup wizard (choose media/screenshots/vault drives) has been completed. */
  setupCompleted: boolean;
  /** Independent background watchdog counts playtime even while GameVault is closed. */
  playtimeWatchEnabled: boolean;
  /** HDD Mode: buffer screenshots on fast drive before syncing to avoid spinning up HDD during gameplay. If disabled (SSD mode), saves directly to game media folder. */
  hddMode: boolean;
  googleApiKey: string;
  googleCseId: string;
  /** Image Storage Provider: 'cloudflare_r2' (default) or 'google_photos' */
  imageStorageProvider?: ImageStorageProvider;
  /** Custom Cloudflare R2 / S3 config if user configures their own credentials */
  customS3Config?: CustomS3Config;
  /** Optional Google Photos album ID */
  googlePhotosAlbumId?: string;
}

export interface PlaytimeWatchStatus {
  installed: boolean;
  isRunning: boolean;
  scriptPath: string;
  logPath: string;
  logExists: boolean;
  lastLogActivity: string | null;
}

export interface F6ProcessStatus {
  installed: boolean;
  isRunning: boolean;
  pid?: number;
  startupEnabled: boolean;
  scriptPath: string;
}

export interface WishlistSearchResult {
  appId: number;
  name: string;
  /** 16:9 header capsule preview from the Steam CDN. */
  headerUrl: string;
}

export interface AddWishlistPayload {
  title: string;
  steamId?: number;
  /** 'backlog' (mặc định) = Chờ chơi (Wishlist); 'completed' = Đã phá đảo (đã chơi ở máy khác, không có giờ chơi tại đây). */
  status?: 'backlog' | 'completed';
  /** Điểm cá nhân 1-10 (không bắt buộc — null = chưa chấm). */
  user_rating?: number | null;
  /** Review cá nhân (không bắt buộc). */
  notes?: string | null;
}

export interface GameFilter {
  status?: string; // 'all' or specific GameStatus
  search?: string;
  sort?: 'playtime_desc' | 'playtime_asc' | 'rating_desc' | 'title_asc' | 'recent_played' | 'created_desc' | string;
}

export interface ElectronAPI {
  // Database Operations
  getGames(filter?: GameFilter): Promise<Game[]>;
  getGameById(id: number): Promise<Game | null>;
  createGame(game: Partial<Game>): Promise<Game>;
  updateGame(id: number, data: Partial<Game>): Promise<Game>;
  deleteGame(id: number): Promise<boolean>;
  getSessions(gameId?: number): Promise<Session[]>;
  
  // AMD Import
  importAMDDatabase(customPath?: string): Promise<AMDImportSummary>;
  
  // Screenshot Sync
  syncScreenshots(options?: ScreenshotSyncOptions): Promise<ScreenshotSyncSummary>;
  
  // Media & Explorer
  openMediaFolder(gameTitle: string): Promise<boolean>;
  getMediaFolderPath?(gameTitle: string): Promise<{ fullPath: string; folderName: string }>;
  getGameMedia(gameTitle: string): Promise<MediaItem[]>;
  
  // Covers
  searchSteamCovers(gameTitle: string, steamId?: number): Promise<SteamCoversResult>;
  uploadCustomCover(gameId: number, type: 'poster' | 'banner'): Promise<string | null>;
  setCoverFromScreenshot?(gameId: number, type: 'poster' | 'banner', screenshotPath: string): Promise<string>;
  enrichCovers?(): Promise<number>;
  searchWebImages?(gameTitle: string, kind: 'poster' | 'banner'): Promise<WebImageCandidate[]>;
  getGoogleConfig?(): Promise<GoogleConfig>;
  setGoogleConfig?(apiKey: string, cseId: string): Promise<GoogleConfig>;
  getIgdbConfig?(): Promise<IgdbConfig>;
  setIgdbConfig?(clientId: string, clientSecret: string): Promise<IgdbConfig>;

  // Wishlist & external catalog ('Chờ chơi' / 'Đã phá đảo' — search Steam, add with cover/banner only)
  searchWishlistGames?(query: string): Promise<WishlistSearchResult[]>;
  addWishlistGame?(payload: AddWishlistPayload): Promise<Game>;
  
  // Playtime Tracker
  getTrackerStatus(): Promise<TrackerStatus>;
  updatePlaytimeManual(gameId: number, totalMinutes: number): Promise<boolean>;
  scanRunningGames?(): Promise<Game | null>;

  // Hardware Info & FPS Monitor (PresentMon)
  getHardwareInfo?(force?: boolean): Promise<HardwareInfo>;
  getFpsStatus?(): Promise<FpsStatus>;
  setupFpsElevation?(): Promise<{ ok: boolean; taskCreated: boolean; error?: string }>;
  /** Tải PresentMon chính thức (dành cho máy NVIDIA / máy không có bản AMD bundle). */
  downloadPresentMon?(force?: boolean): Promise<string | null>;
  getFpsLeaderboard?(): Promise<FpsLeaderboardEntry[]>;

  // F6 Hotkey & Real-time Auto-Sync
  getF6Status?(): Promise<any>;
  syncF6Now?(): Promise<any>;

  // Settings & System Controls
  getSettings?(): Promise<AppSettings>;
  saveSettings?(settings: Partial<AppSettings>): Promise<AppSettings>;
  testStorageConnection?(settings?: Partial<AppSettings>): Promise<{ ok: boolean; error?: string }>;
  browseFolder?(defaultPath?: string): Promise<string | null>;
  getF6ProcessStatus?(): Promise<F6ProcessStatus>;
  toggleF6Process?(start: boolean): Promise<boolean>;
  toggleF6Startup?(enable: boolean): Promise<boolean>;
  toggleAppStartup?(enable: boolean): Promise<boolean>;
  getPlaytimeWatchStatus?(): Promise<PlaytimeWatchStatus>;
  togglePlaytimeWatch?(enable: boolean): Promise<boolean>;

  // Save Vault (backup / restore save game)
  getSavesList(gameId: number): Promise<SavesListResult>;
  detectSaveLocations(gameId: number): Promise<SaveLocationCandidate[]>;
  searchSaveLocationsWeb?(gameId: number, forceRefresh?: boolean): Promise<WebSearchSummary>;
  addSavePath(gameId: number, sourcePath: string, label?: string): Promise<SavePathConfig>;
  removeSavePath(pathId: number): Promise<boolean>;
  toggleSavePath(pathId: number, enabled: boolean): Promise<SavePathConfig>;
  browseSaveFolder(): Promise<string | null>;
  backupSavesNow(gameId: number, note?: string): Promise<SaveBackupResult>;
  restoreSaveBackup(backupId: number): Promise<SaveRestoreResult>;
  deleteSaveBackup(backupId: number): Promise<boolean>;
  openSaveBackupFolder(backupId: number): Promise<boolean>;
  getVaultInfo(): Promise<VaultInfo>;
  setVaultRoot(rootPath: string): Promise<VaultInfo>;
  uploadBackupToDrive?(backupId: number): Promise<{ drivePath: string; filesUploaded: number; bytesUploaded: number }>;
  listDriveGameBackups?(gameTitle: string): Promise<DriveGameBackup[]>;
  downloadCloudBackup?(gameId: number, drivePath: string): Promise<SaveBackup>;
  switchToMySave?(gameId: number, options?: { targetBackupId?: number }): Promise<SaveProfileSwapResult>;
  revertToHostSave?(gameId: number): Promise<SaveProfileSwapResult>;
  applySaveBackup?(gameId: number, backupId: number, asProfile?: ActiveSaveProfile): Promise<SaveProfileSwapResult>;
  updateSaveBackupMetadata?(backupId: number, patch: { note?: string | null; trigger?: SaveBackupTrigger }): Promise<SaveBackup>;
  getSaveProfileInfo?(gameId: number): Promise<SaveProfileInfo>;
  setSaveProfileInfo?(gameId: number, patch: Partial<SaveProfileInfo>): Promise<SaveProfileInfo>;
  isGameRunning?(gameId: number): Promise<boolean>;
  uploadMediaToDrive?(options?: { gameTitle?: string; localMediaBaseDir?: string }): Promise<DriveMediaSyncResult>;
  downloadMediaFromDrive?(options?: { gameTitle?: string; localMediaBaseDir?: string }): Promise<DriveMediaRestoreResult>;
  getDriveMediaStats?(): Promise<DriveMediaStats>;
  getDriveStorageQuota?(): Promise<DriveStorageQuota>;
  getActiveMediaSyncStatus?(): Promise<ActiveMediaSyncStatus>;

  // Cloud auth (Google login)
  getAuthStatus(): Promise<AuthStatus>;
  login(): Promise<UserProfile>;
  logout(): Promise<void>;

  // Community (cloud leaderboard / reviews / picks)
  getLeaderboard?(options?: { sortByGuMatch?: boolean }): Promise<LeaderboardEntry[]>;
  getGameReviews?(gameKey: string): Promise<CloudReview[]>;
  submitReview?(gameId: number, payload: { score: number; review: string; dropped: boolean; dropReason?: string; fps?: number }): Promise<CloudReview>;
  deleteMyReview?(gameId: number): Promise<boolean>;
  getMyHardwareProfile?(): Promise<HardwareProfile | null>;
  setMyHardwareProfile?(profile: HardwareProfile): Promise<HardwareProfile>;
  getCurrentPick?(): Promise<CommunityPick | null>;
  votePick?(gameId: number): Promise<CommunityPick>;
  unvotePick?(): Promise<CommunityPick>;
  syncLibrary?(): Promise<LibrarySyncResult>;
  getCloudLibrary?(): Promise<LibrarySyncResponse>;

  // Real-time Event Subscriptions
  onGameAdded?(callback: (game: Game) => void): () => void;
  onGameUpdated?(callback: (game: Game) => void): () => void;
  onScreenshotSynced?(callback: (info: { gameTitle: string; file: string; targetPath: string }) => void): () => void;
  onDriveMediaProgress?(callback: (progress: DriveMediaProgress) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
