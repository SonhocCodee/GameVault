import path from 'node:path';
import fs from 'node:fs';
import electronModule from 'electron';
import {
  getGameById,
  getGameByTitle,
  getGameByExeName,
  createGame,
  getSavePaths,
  addSavePath,
  removeSavePath,
  setSavePathEnabled,
  recordSaveBackup,
  getSaveBackups,
  getSaveBackupById,
  getSaveBackupByDir,
  countSaveBackups,
  deleteSaveBackupRow,
  updateSaveBackupRow,
  getSetting,
  setSetting,
} from './db.ts';
import { sanitizeTitleForFolder, normalizeForMatch, levenshteinDistance } from './media.ts';
import type {
  ActiveSaveProfile,
  Game,
  SaveBackup,
  SaveBackupResult,
  SaveBackupSourceResult,
  SaveBackupTrigger,
  SaveLocationCandidate,
  SaveProfileInfo,
  SaveProfileSwapResult,
  SaveRestoreResult,
  SavesListResult,
  VaultInfo,
} from '../shared/types.js';

// In Electron runtime, electronModule has shell. In test mode, fallback safely.
const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;
const shell = electron.shell || {
  openPath: async (_p: string) => '',
};

// ==========================================
// Constants
// ==========================================

export const SETTING_VAULT_ROOT = 'save_vault_root';
export const DEFAULT_VAULT_ROOT = 'E:\\Game\\SaveVault';
const VAULT_MARKER_FILE = 'gamevault.vault.json';
const POINTER_REL_PATH = path.join('GameVault', 'savevault.json');
const MANIFEST_FILE = 'manifest.json';
const DEFAULT_SAVE_DIR_NAMES = new Set([
  'save', 'saves', 'saved', 'savedata', 'savegames', 'save game', 'my games', 'gamedata', 'userdata',
]);

export interface SaveManagerOptions {
  /** Override vault root (tests / one-off operations). */
  vaultRoot?: string;
  /** Override Documents dir used for the pointer file (tests). */
  documentsDir?: string;
}

// ==========================================
// Vault root resolution
// ==========================================

function getDocumentsDir(options?: SaveManagerOptions): string {
  if (options?.documentsDir) return options.documentsDir;
  const envDir = process.env.GAMEVAULT_DOCUMENTS_DIR;
  if (envDir) return envDir;
  try {
    const app = electron.app;
    if (app && typeof app.getPath === 'function') {
      return app.getPath('documents');
    }
  } catch {
    // Not running inside Electron (tests / headless)
  }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, 'Documents');
}

function getPointerFilePath(options?: SaveManagerOptions): string {
  return path.join(getDocumentsDir(options), POINTER_REL_PATH);
}

function getDefaultVaultRoot(options?: SaveManagerOptions): string {
  // Keep vault next to the media library when the standard E:\Game exists,
  // otherwise fall back inside Documents (survives app reinstalls).
  if (process.platform === 'win32' && fs.existsSync('E:\\Game')) {
    return 'E:\\Game\\SaveVault';
  }
  return path.join(getDocumentsDir(options), 'GameVault', 'SaveVault');
}

function readPointerFile(options?: SaveManagerOptions): string | null {
  try {
    const pointerPath = getPointerFilePath(options);
    if (!fs.existsSync(pointerPath)) return null;
    const raw = fs.readFileSync(pointerPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const root = typeof parsed?.vaultRoot === 'string' ? parsed.vaultRoot.trim() : '';
    return root && path.isAbsolute(root) ? root : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the active vault root: explicit option → app setting → pointer
 * file (written whenever the root changes, so a fresh install re-adopts the
 * old vault) → built-in default.
 */
export function resolveVaultRoot(options?: SaveManagerOptions): { root: string; configured: boolean } {
  if (options?.vaultRoot) {
    return { root: path.resolve(options.vaultRoot), configured: true };
  }
  const setting = getSetting(SETTING_VAULT_ROOT);
  if (setting) {
    return { root: setting, configured: true };
  }
  const pointer = readPointerFile(options);
  if (pointer) {
    return { root: pointer, configured: false };
  }
  return { root: getDefaultVaultRoot(options), configured: false };
}

function writeMarkerFile(vaultRoot: string): void {
  const markerPath = path.join(vaultRoot, VAULT_MARKER_FILE);
  const payload = {
    app: 'GameVault',
    version: 1,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath, JSON.stringify(payload, null, 2), 'utf-8');
}

function writePointerFile(vaultRoot: string, options?: SaveManagerOptions): void {
  const pointerPath = getPointerFilePath(options);
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  fs.writeFileSync(
    pointerPath,
    JSON.stringify({ vaultRoot, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
}

function ensureVaultDir(vaultRoot: string): void {
  fs.mkdirSync(vaultRoot, { recursive: true });
  const markerPath = path.join(vaultRoot, VAULT_MARKER_FILE);
  if (!fs.existsSync(markerPath)) {
    writeMarkerFile(vaultRoot);
  }
}

/**
 * Startup hook: if no vault root is stored yet (fresh install), adopt the one
 * advertised by the Documents pointer file so the old vault is recognized
 * immediately, and re-index its contents into the (possibly fresh) database.
 */
export function initSaveVault(options?: SaveManagerOptions): VaultInfo {
  const setting = getSetting(SETTING_VAULT_ROOT);
  if (!setting) {
    const pointer = readPointerFile(options);
    if (pointer) {
      setSetting(SETTING_VAULT_ROOT, pointer);
      try {
        reindexVault(pointer, options);
      } catch {
        // Adopting is still worthwhile even if re-index fails
      }
    }
  }
  return getVaultInfo(options);
}

export function getVaultInfo(options?: SaveManagerOptions): VaultInfo {
  const { root, configured } = resolveVaultRoot(options);
  let isDirectory = false;
  let markerFound = false;
  try {
    isDirectory = fs.existsSync(root) && fs.statSync(root).isDirectory();
    if (isDirectory) {
      markerFound = fs.existsSync(path.join(root, VAULT_MARKER_FILE));
    }
  } catch {
    // stat failures leave both flags false
  }
  return {
    root,
    configured,
    markerFound,
    isDirectory,
    totalBackups: countSaveBackups(),
  };
}

/**
 * Sets (and creates) the vault root, writes the identification marker plus the
 * Documents pointer file, persists the choice and re-indexes any existing
 * vault content so switching to an old vault "just works".
 */
export function setVaultRoot(rootPath: string, options?: SaveManagerOptions): VaultInfo {
  const trimmed = String(rootPath || '').trim();
  if (!trimmed) {
    throw new Error('Vault root path is required');
  }
  const root = path.resolve(trimmed);
  ensureVaultDir(root);
  setSetting(SETTING_VAULT_ROOT, root);
  try {
    writePointerFile(root, options);
  } catch {
    // Pointer write is best-effort (e.g. Documents is redirected/readonly)
  }
  reindexVault(root, options);
  return getVaultInfo(options);
}

// ==========================================
// Helpers
// ==========================================

interface WalkStats {
  files: number;
  bytes: number;
}

const DETECT_WALK_CAP = 2000; // detection only needs "non-trivial folder" hints

function walkStats(dir: string, depth: number = 0, maxFiles: number = Infinity): WalkStats {
  const stats: WalkStats = { files: 0, bytes: 0 };
  if (depth > 32 || stats.files >= maxFiles) return stats;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return stats;
  }
  for (const entry of entries) {
    if (stats.files >= maxFiles) break;
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const sub = walkStats(fullPath, depth + 1, maxFiles - stats.files);
        stats.files += sub.files;
        stats.bytes += sub.bytes;
      } else if (entry.isFile()) {
        stats.files++;
        stats.bytes += fs.statSync(fullPath).size;
      }
    } catch {
      // Unreadable entries are skipped
    }
  }
  return stats;
}

function formatSlotTime(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function sanitizeFolderBase(name: string): string {
  return sanitizeTitleForFolder(name) || 'save';
}

/**
 * Vault folder for a game: `<Sanitized Title>` — human browsable. When the
 * sanitized name collides with another game's folder, falls back to
 * `<Title> (id)`. An existing folder that already belongs to this game (via
 * manifest) is reused.
 */
function resolveGameVaultDir(vaultRoot: string, game: Game): string {
  const base = sanitizeFolderBase(game.title);
  const primary = path.join(vaultRoot, base);
  if (!fs.existsSync(primary)) {
    return primary;
  }
  // Folder exists: check whether it already belongs to this game
  try {
    const entries = fs.readdirSync(primary, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const slot of entries) {
      const manifestPath = path.join(primary, slot.name, MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (Number(manifest?.gameId) === game.id) {
        return primary;
      }
      // Distinct game with the same sanitized title owns this folder
      return path.join(vaultRoot, `${base} (${game.id})`);
    }
    // Empty folder with the same name — safe to claim
    return primary;
  } catch {
    return path.join(vaultRoot, `${base} (${game.id})`);
  }
}

function findUniqueSlotDir(gameDir: string, slotTime: string): string {
  let candidate = path.join(gameDir, slotTime);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(gameDir, `${slotTime}-${counter}`);
    counter++;
  }
  return candidate;
}

function readManifest(backupDir: string): any | null {
  try {
    const manifestPath = path.join(backupDir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ==========================================
// Save location detection
// ==========================================

export interface DetectOptions {
  documentsDir?: string;
  roamingDir?: string;
  localDir?: string;
  localLowDir?: string;
  savedGamesDir?: string;
  /** Override exe path (defaults to game.exe_path). */
  exePath?: string;
  /** Additional root folders to scan one level deep. */
  extraRoots?: string[];
}

interface SlugHit {
  slug: string;
  reason: string;
}

function buildSlugs(game: Game, exePath?: string | null): SlugHit[] {
  const hits: SlugHit[] = [];
  const push = (value: string | null | undefined, reason: string) => {
    if (!value) return;
    const normalized = normalizeForMatch(value);
    if (!normalized || normalized.length < 3) return;
    if (hits.some((h) => h.slug === normalized)) return;
    hits.push({ slug: normalized, reason });
  };

  push(game.title, 'title');
  const exeName = path.basename(String(exePath || game.exe_name || '')).replace(/\.exe$/i, '');
  push(exeName, 'exe');
  const exeDir = path.basename(path.dirname(String(exePath || '')));
  if (exeDir && exeDir !== exeName) {
    push(exeDir, 'install_dir');
  }
  return hits;
}

function scoreCandidate(folderName: string, slugs: SlugHit[]): { reason: string; confidence: 'high' | 'medium' | 'low' } | null {
  const normalized = normalizeForMatch(folderName);
  if (!normalized) return null;

  for (const hit of slugs) {
    if (normalized === hit.slug) {
      return { reason: hit.reason, confidence: 'high' };
    }
  }
  for (const hit of slugs) {
    // "contains" only counts for meaningful slugs to avoid noise (e.g. "GoW")
    if (hit.slug.length >= 5 && normalized.includes(hit.slug) && normalized.length <= hit.slug.length * 2 + 6) {
      return { reason: hit.reason, confidence: 'medium' };
    }
  }
  for (const hit of slugs) {
    if (hit.slug.length >= 5) {
      const distance = levenshteinDistance(normalized, hit.slug);
      if (distance <= 2) {
        return { reason: hit.reason, confidence: 'low' };
      }
    }
  }
  return null;
}

function listDirectories(root: string | undefined): string[] {
  if (!root) return [];
  try {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function pushCandidate(candidates: Map<string, SaveLocationCandidate>, dirPath: string, folderName: string, score: { reason: string; confidence: 'high' | 'medium' | 'low' }) {
  const resolved = path.resolve(dirPath);
  if (candidates.has(resolved)) {
    // Upgrade confidence if a stronger match was found for the same folder
    const existing = candidates.get(resolved)!;
    const rank = { low: 0, medium: 1, high: 2 };
    if (rank[score.confidence] > rank[existing.confidence]) {
      existing.confidence = score.confidence;
      existing.matchReason = score.reason;
    }
    return;
  }
  const stats = walkStats(resolved, 0, DETECT_WALK_CAP);
  candidates.set(resolved, {
    path: resolved,
    folderName,
    sizeBytes: stats.bytes,
    fileCount: stats.files,
    matchReason: score.reason,
    confidence: score.confidence,
  });
}

/**
 * Heuristic scan of the standard Windows save locations for folders that look
 * like they belong to this game. One level deep per root (fast, no deep walk).
 */
export function detectSaveLocations(game: Game, options: DetectOptions = {}): SaveLocationCandidate[] {
  const documents = options.documentsDir || getDocumentsDir(options);
  const profile = process.env.USERPROFILE || process.env.HOME || '';
  const roaming = options.roamingDir || process.env.APPDATA || path.join(profile, 'AppData', 'Roaming');
  const local = options.localDir || process.env.LOCALAPPDATA || path.join(profile, 'AppData', 'Local');
  const localLow = options.localLowDir || path.join(profile, 'AppData', 'LocalLow');
  const savedGames = options.savedGamesDir || path.join(profile, 'Saved Games');
  const exePath = options.exePath !== undefined ? options.exePath : game.exe_path || null;

  const slugs = buildSlugs(game, exePath);
  if (slugs.length === 0) return [];

  const candidates = new Map<string, SaveLocationCandidate>();

  // Standard per-user save roots
  const roots: Array<{ dir: string; allowGeneric: boolean }> = [
    { dir: path.join(documents, 'My Games'), allowGeneric: true },
    { dir: documents, allowGeneric: true },
    { dir: savedGames, allowGeneric: true },
    { dir: roaming, allowGeneric: true },
    { dir: local, allowGeneric: true },
    { dir: localLow, allowGeneric: true },
  ];

  for (const root of roots) {
    for (const name of listDirectories(root.dir)) {
      const score = scoreCandidate(name, slugs);
      if (score) {
        pushCandidate(candidates, path.join(root.dir, name), name, score);
      }
    }
  }

  // Folders next to the game executable (some games keep saves in install dir)
  if (exePath && fs.existsSync(exePath)) {
    const exeDir = path.dirname(exePath);
    const dirsToInspect = [exeDir, path.dirname(exeDir), path.dirname(path.dirname(exeDir))];
    const seen = new Set<string>();
    for (const dir of dirsToInspect) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      for (const name of listDirectories(dir)) {
        // Unreal-style "Saved" folder or a folder named like the game
        const isGeneric = DEFAULT_SAVE_DIR_NAMES.has(name.toLowerCase());
        const isSavedDir = name.toLowerCase() === 'saved' && dir === path.dirname(path.dirname(exeDir));
        const score = scoreCandidate(name, slugs);
        if (score) {
          pushCandidate(candidates, path.join(dir, name), name, score);
        } else if (isGeneric || isSavedDir) {
          const stats = walkStats(path.join(dir, name), 0, DETECT_WALK_CAP);
          if (stats.files > 0) {
            pushCandidate(candidates, path.join(dir, name), name, {
              reason: 'install_dir',
              confidence: 'low',
            });
          }
        }
      }
    }
  }

  // Caller-provided roots (power users / tests)
  for (const extra of options.extraRoots || []) {
    for (const name of listDirectories(extra)) {
      const score = scoreCandidate(name, slugs);
      if (score) {
        pushCandidate(candidates, path.join(extra, name), name, score);
      }
    }
  }

  const confidenceRank = { high: 0, medium: 1, low: 2 };
  return Array.from(candidates.values()).sort((a, b) => {
    const rankDiff = confidenceRank[a.confidence] - confidenceRank[b.confidence];
    if (rankDiff !== 0) return rankDiff;
    return b.fileCount - a.fileCount;
  });
}

// ==========================================
// Backup
// ==========================================

/**
 * Copies every enabled save folder of the game into a fresh timestamped slot
 * inside the vault and records it. `manifest.json` inside the slot is the
 * restore source of truth (survives app/db deletion).
 */
export function backupSavesNow(
  gameId: number,
  note?: string,
  options: SaveManagerOptions & { trigger?: SaveBackupTrigger } = {}
): SaveBackupResult {
  const game = getGameById(gameId);
  if (!game) {
    throw new Error(`Game with id ${gameId} not found`);
  }

  const configuredPaths = getSavePaths(gameId).filter((p) => p.enabled === 1);
  if (configuredPaths.length === 0) {
    throw new Error('Chưa khai báo folder save nào cho game này');
  }

  const { root } = resolveVaultRoot(options);
  ensureVaultDir(root);
  const gameDir = resolveGameVaultDir(root, game);
  const slotTime = formatSlotTime(new Date());
  const backupDir = findUniqueSlotDir(gameDir, slotTime);
  fs.mkdirSync(backupDir, { recursive: true });

  const trigger = options.trigger || 'manual';
  const sources: SaveBackupSourceResult[] = [];
  const manifestSources: Array<{ sourcePath: string; folderName: string; files: number; bytes: number }> = [];

  configuredPaths.forEach((savePath, index) => {
    const sourcePath = savePath.source_path;
    const base: SaveBackupSourceResult = {
      sourcePath,
      status: 'copied',
      files: 0,
      bytes: 0,
    };

    if (!fs.existsSync(sourcePath)) {
      sources.push({ ...base, status: 'skipped_missing', error: 'Folder không tồn tại' });
      return;
    }

    const beforeCopy = walkStats(sourcePath);
    if (beforeCopy.files === 0) {
      sources.push({ ...base, status: 'skipped_empty', error: 'Folder trống' });
      return;
    }

    const destFolderName = `${index + 1}_${sanitizeFolderBase(path.basename(sourcePath))}`;
    const dest = path.join(backupDir, destFolderName);
    try {
      fs.cpSync(sourcePath, dest, {
        recursive: true,
        force: true,
        preserveTimestamps: true,
      });
      const copied = walkStats(dest);
      sources.push({ ...base, status: 'copied', files: copied.files, bytes: copied.bytes });
      manifestSources.push({
        sourcePath,
        folderName: destFolderName,
        files: copied.files,
        bytes: copied.bytes,
      });
    } catch (err: any) {
      sources.push({
        ...base,
        status: 'error',
        files: 0,
        bytes: 0,
        error: String(err?.message || err),
      });
    }
  });

  const copiedSources = sources.filter((s) => s.status === 'copied');
  const totalFiles = copiedSources.reduce((acc, s) => acc + s.files, 0);
  const totalBytes = copiedSources.reduce((acc, s) => acc + s.bytes, 0);

  const manifest = {
    app: 'GameVault',
    version: 1,
    gameId: game.id,
    gameTitle: game.title,
    exeName: game.exe_name ?? null,
    slotTime,
    trigger,
    note: note ?? null,
    createdAt: new Date().toISOString(),
    totalFiles,
    totalBytes,
    sources: manifestSources,
  };
  fs.writeFileSync(path.join(backupDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');

  // Empty slots (all sources missing/empty) are not worth keeping
  if (copiedSources.length === 0) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {}
    throw new Error('Không có dữ liệu save nào được sao chép (folder trống hoặc không tồn tại)');
  }

  const backup: SaveBackup = recordSaveBackup({
    game_id: game.id,
    backup_dir: backupDir,
    slot_time: slotTime,
    size_bytes: totalBytes,
    file_count: totalFiles,
    trigger,
    note: note ?? null,
  });

  return {
    backupId: backup.id,
    backupDir,
    slotTime,
    sources,
    totalFiles,
    totalBytes,
  };
}

// ==========================================
// Restore
// ==========================================

/**
 * Restores a backup slot back to the original save locations recorded in its
 * manifest. Before writing anything, the current save folders are backed up
 * (trigger `pre_restore`) so a bad restore can always be rolled back.
 */
export function restoreSaveBackup(backupId: number, options: SaveManagerOptions = {}): SaveRestoreResult {
  const backup = getSaveBackupById(backupId);
  if (!backup) {
    throw new Error(`Save backup with id ${backupId} not found`);
  }
  const backupDir = backup.backup_dir;
  if (!fs.existsSync(backupDir)) {
    throw new Error('Folder backup không còn tồn tại trong vault');
  }

  const manifest = readManifest(backupDir);
  const sources: Array<{ sourcePath: string; folderName: string }> = Array.isArray(manifest?.sources)
    ? manifest.sources
    : [];

  if (sources.length === 0) {
    throw new Error('Manifest của bản backup không hợp lệ hoặc thiếu danh sách nguồn');
  }

  // Safety net: snapshot current saves before overwriting them. Manifest
  // sources missing from the (possibly fresh) config are re-registered first,
  // so the snapshot covers everything restore is about to touch.
  let safetyBackupId: number | null = null;
  try {
    const configured = new Set(getSavePaths(backup.game_id).map((p) => path.resolve(p.source_path)));
    for (const source of sources) {
      if (!configured.has(path.resolve(source.sourcePath))) {
        addSavePath(backup.game_id, source.sourcePath, 'Khôi phục từ manifest');
      }
    }
    const safety = backupSavesNow(
      backup.game_id,
      `Tự động an toàn trước khi phục hồi ${backup.slot_time}`,
      { ...options, trigger: 'pre_restore' }
    );
    safetyBackupId = safety.backupId;
  } catch {
    // Nothing existing to protect (fresh install) — proceed without safety net
  }

  const restored: Array<{ sourcePath: string; files: number }> = [];
  const errors: string[] = [];

  for (const source of sources) {
    const sourceBackupDir = path.join(backupDir, source.folderName);
    if (!fs.existsSync(sourceBackupDir)) {
      errors.push(`Thiếu dữ liệu trong backup: ${source.folderName}`);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(source.sourcePath), { recursive: true });
      fs.cpSync(sourceBackupDir, source.sourcePath, {
        recursive: true,
        force: true,
        preserveTimestamps: true,
      });
      const stats = walkStats(source.sourcePath);
      restored.push({ sourcePath: source.sourcePath, files: stats.files });
    } catch (err: any) {
      errors.push(`${source.sourcePath}: ${String(err?.message || err)}`);
    }
  }

  return { restored, safetyBackupId, errors };
}

// ==========================================
// Backup management
// ==========================================

export function deleteSaveBackup(backupId: number): boolean {
  const backup = getSaveBackupById(backupId);
  if (!backup) {
    throw new Error(`Save backup with id ${backupId} not found`);
  }
  try {
    fs.rmSync(backup.backup_dir, { recursive: true, force: true });
  } catch {
    // Row deletion proceeds even if folder removal partially failed
  }
  return deleteSaveBackupRow(backupId);
}

export async function openSaveBackupFolder(backupId: number): Promise<boolean> {
  const backup = getSaveBackupById(backupId);
  if (!backup) return false;
  try {
    const result = await shell.openPath(backup.backup_dir);
    return result === '';
  } catch {
    return false;
  }
}

// ==========================================
// Vault re-index (adopt an existing vault)
// ==========================================

export interface ReindexSummary {
  vaultRoot: string;
  gamesFound: number;
  backupsReindexed: number;
  skippedSlots: number;
}

/**
 * Walks `<root>/<game folder>/<slot>/manifest.json` and rebuilds save_backups
 * rows (and missing game records) so an existing vault created by a previous
 * install is fully recognized again.
 */
export function reindexVault(rootPath?: string, options?: SaveManagerOptions): ReindexSummary {
  const root = rootPath || resolveVaultRoot(options).root;
  const summary: ReindexSummary = {
    vaultRoot: root,
    gamesFound: 0,
    backupsReindexed: 0,
    skippedSlots: 0,
  };

  if (!fs.existsSync(root) || !fs.existsSync(path.join(root, VAULT_MARKER_FILE))) {
    return summary;
  }

  const gameFolders = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const gameFolder of gameFolders) {
    const gameDirPath = path.join(root, gameFolder);
    const slotDirs = fs
      .readdirSync(gameDirPath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const slot of slotDirs) {
      const backupDir = path.join(gameDirPath, slot);
      const manifest = readManifest(backupDir);
      if (!manifest?.gameTitle || !Array.isArray(manifest?.sources) || manifest.sources.length === 0) {
        summary.skippedSlots++;
        continue;
      }

      // Resolve the game record: by stored id, else by title (fresh install)
      let game = Number.isFinite(Number(manifest.gameId)) ? getGameById(Number(manifest.gameId)) : null;
      if (!game) {
        game = getGameByTitle(String(manifest.gameTitle));
      }
      if (!game && manifest.exeName) {
        game = getGameByExeName(String(manifest.exeName));
      }
      if (!game) {
        game = createGame({
          title: String(manifest.gameTitle),
          exe_name: manifest.exeName ?? null,
          status: 'playing',
        });
        summary.gamesFound++;
      }

      if (getSaveBackupByDir(backupDir)) {
        continue; // already indexed
      }

      const totalFiles = Number(manifest.totalFiles) || manifest.sources.reduce((a: number, s: any) => a + (Number(s.files) || 0), 0);
      const totalBytes = Number(manifest.totalBytes) || manifest.sources.reduce((a: number, s: any) => a + (Number(s.bytes) || 0), 0);

      recordSaveBackup({
        game_id: game.id,
        backup_dir: backupDir,
        slot_time: String(manifest.slotTime || slot),
        size_bytes: totalBytes,
        file_count: totalFiles,
        trigger: (['pre_restore', 'host_snapshot', 'my_save'] as string[]).includes(manifest.trigger)
          ? manifest.trigger
          : 'manual',
        note: manifest.note ?? null,
      });
      summary.backupsReindexed++;
    }
  }

  return summary;
}

// ==========================================
// Save Profile & Swapper (Host vs My Save)
// ==========================================

let gameRunningCheckOverride: ((gameId: number) => boolean) | null = null;

export function setGameRunningCheck(fn: ((gameId: number) => boolean) | null): void {
  gameRunningCheckOverride = fn;
}

export function isGameRunning(gameId: number): boolean {
  if (gameRunningCheckOverride) {
    return gameRunningCheckOverride(gameId);
  }
  try {
    const game = getGameById(gameId);
    if (!game) return false;
    const trackerModule = require('./tracker.ts');
    const getTracker = trackerModule?.getTracker;
    if (typeof getTracker === 'function') {
      const status = getTracker().getStatus();
      if (status && status.isTracking) {
        if (status.activeGameTitle === game.title) return true;
        if (
          game.exe_name &&
          status.activeProcessName &&
          status.activeProcessName.toLowerCase() === game.exe_name.toLowerCase()
        ) {
          return true;
        }
      }
    }
  } catch {
    // headless or test environment
  }
  return false;
}

export function getSaveProfileInfo(gameId: number): SaveProfileInfo {
  const raw = getSetting(`save_profile_${gameId}`);
  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {}
  }
  const isRunning = isGameRunning(gameId);
  const backups = getSaveBackups(gameId);
  const latestHost = backups.find((b) => b.trigger === 'host_snapshot');
  const latestMy = backups.find((b) => b.trigger === 'my_save');

  let activeProfile: ActiveSaveProfile = parsed?.activeProfile ?? null;
  if (!activeProfile) {
    activeProfile = latestHost ? 'my_save' : 'host';
  }

  return {
    gameId,
    activeProfile,
    hostBackupId: parsed?.hostBackupId ?? latestHost?.id ?? null,
    myBackupId: parsed?.myBackupId ?? latestMy?.id ?? null,
    lastSwappedAt: parsed?.lastSwappedAt ?? null,
    isGameRunning: isRunning,
  };
}

export function setSaveProfileInfo(gameId: number, patch: Partial<SaveProfileInfo>): SaveProfileInfo {
  const current = getSaveProfileInfo(gameId);
  const updated: SaveProfileInfo = {
    ...current,
    ...patch,
  };
  setSetting(
    `save_profile_${gameId}`,
    JSON.stringify({
      activeProfile: updated.activeProfile,
      hostBackupId: updated.hostBackupId,
      myBackupId: updated.myBackupId,
      lastSwappedAt: updated.lastSwappedAt,
    })
  );
  return updated;
}

export function updateSaveBackupMetadata(
  backupId: number,
  patch: { note?: string | null; trigger?: SaveBackupTrigger }
): SaveBackup {
  const updated = updateSaveBackupRow(backupId, patch);
  if (!updated) {
    throw new Error(`Save backup with id ${backupId} not found`);
  }
  try {
    const manifestPath = path.join(updated.backup_dir, MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (patch.note !== undefined) manifest.note = patch.note;
      if (patch.trigger !== undefined) manifest.trigger = patch.trigger;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }
  } catch {}
  return updated;
}

/**
 * Switch from host save to user's personal save:
 * 1. Ensure game is not running.
 * 2. Automatically snapshots current save folders as Host Save (if they exist and have files).
 * 3. Restores target personal save (targetBackupId, or latest 'my_save', or latest manual backup).
 * 4. Updates active profile to 'my_save'.
 */
export function switchToMySave(
  gameId: number,
  options: SaveManagerOptions & { targetBackupId?: number } = {}
): SaveProfileSwapResult {
  if (isGameRunning(gameId)) {
    throw new Error('Game đang chạy! Vui lòng thoát game trước khi đổi file save để tránh lỗi dữ liệu.');
  }

  const game = getGameById(gameId);
  if (!game) throw new Error(`Game with id ${gameId} not found`);

  const configuredPaths = getSavePaths(gameId).filter((p) => p.enabled === 1);
  if (configuredPaths.length === 0) {
    throw new Error('Chưa khai báo folder save nào cho game này');
  }

  // 1. Snapshot host save if files exist
  let hostBackupId: number | null = null;
  const hasFiles = configuredPaths.some((p) => fs.existsSync(p.source_path) && walkStats(p.source_path).files > 0);
  if (hasFiles) {
    try {
      const hostSnapshot = backupSavesNow(
        gameId,
        'Save gốc của máy này (Host Save - tự động sao lưu trước khi chuyển sang Save của tôi)',
        { ...options, trigger: 'host_snapshot' }
      );
      hostBackupId = hostSnapshot.backupId;
    } catch {
      // ignore empty
    }
  }

  // 2. Determine which backup to restore
  const backups = getSaveBackups(gameId);
  let targetId = options.targetBackupId;
  if (!targetId) {
    const mySave = backups.find((b) => b.trigger === 'my_save' && b.id !== hostBackupId);
    if (mySave) {
      targetId = mySave.id;
    } else {
      const manual = backups.find((b) => b.trigger === 'manual' && b.id !== hostBackupId);
      if (manual) {
        targetId = manual.id;
      }
    }
  }

  if (!targetId) {
    throw new Error(
      'Chưa có bản save cá nhân nào trong vault. Bạn có thể tạo bản sao lưu mới hoặc tải save từ Google Drive về trước.'
    );
  }

  // 3. Restore target personal backup
  const restoreRes = restoreSaveBackup(targetId, options);

  // 4. Update profile state
  const prevProfile = getSaveProfileInfo(gameId);
  setSaveProfileInfo(gameId, {
    activeProfile: 'my_save',
    hostBackupId: hostBackupId ?? prevProfile.hostBackupId,
    myBackupId: targetId,
    lastSwappedAt: new Date().toISOString(),
  });

  return {
    success: true,
    targetProfile: 'my_save',
    restoredBackupId: targetId,
    safetyBackupId: restoreRes.safetyBackupId,
    restored: restoreRes.restored,
    errors: restoreRes.errors,
  };
}

/**
 * Revert from user's save back to host save (return PC to host):
 * 1. Ensure game is not running.
 * 2. Snapshots current save as My Save so progress isn't lost.
 * 3. Restores host save snapshot.
 * 4. Updates active profile to 'host'.
 */
export function revertToHostSave(
  gameId: number,
  options: SaveManagerOptions = {}
): SaveProfileSwapResult {
  if (isGameRunning(gameId)) {
    throw new Error('Game đang chạy! Vui lòng thoát game trước khi hoàn trả save.');
  }

  const game = getGameById(gameId);
  if (!game) throw new Error(`Game with id ${gameId} not found`);

  // 1. Snapshot my progress
  let myBackupId: number | null = null;
  const configuredPaths = getSavePaths(gameId).filter((p) => p.enabled === 1);
  const hasFiles = configuredPaths.some((p) => fs.existsSync(p.source_path) && walkStats(p.source_path).files > 0);
  if (hasFiles) {
    try {
      const myBackup = backupSavesNow(
        gameId,
        'Tiến độ của tôi trước khi hoàn trả save cho máy này',
        { ...options, trigger: 'my_save' }
      );
      myBackupId = myBackup.backupId;
    } catch {
      // ignore
    }
  }

  // 2. Find host backup
  const profileInfo = getSaveProfileInfo(gameId);
  const backups = getSaveBackups(gameId);
  let hostBackup: SaveBackup | undefined;

  if (profileInfo.hostBackupId) {
    hostBackup = backups.find((b) => b.id === profileInfo.hostBackupId);
  }
  if (!hostBackup) {
    hostBackup = backups.find((b) => b.trigger === 'host_snapshot');
  }
  if (!hostBackup) {
    hostBackup = backups.find((b) => (b.note || '').toLowerCase().includes('host') || (b.note || '').toLowerCase().includes('máy này'));
  }

  if (!hostBackup) {
    throw new Error('Không tìm thấy bản snapshot save gốc của máy này để hoàn trả.');
  }

  // 3. Restore host backup
  const restoreRes = restoreSaveBackup(hostBackup.id, options);

  // 4. Update profile state
  setSaveProfileInfo(gameId, {
    activeProfile: 'host',
    hostBackupId: hostBackup.id,
    myBackupId: myBackupId ?? profileInfo.myBackupId,
    lastSwappedAt: new Date().toISOString(),
  });

  return {
    success: true,
    targetProfile: 'host',
    restoredBackupId: hostBackup.id,
    safetyBackupId: restoreRes.safetyBackupId,
    restored: restoreRes.restored,
    errors: restoreRes.errors,
  };
}

/**
 * 1-click apply of any backup into game with profile option
 */
export function applySaveBackup(
  gameId: number,
  backupId: number,
  asProfile?: ActiveSaveProfile,
  options: SaveManagerOptions = {}
): SaveProfileSwapResult {
  if (isGameRunning(gameId)) {
    throw new Error('Game đang chạy! Vui lòng thoát game trước khi đổi save.');
  }

  const restoreRes = restoreSaveBackup(backupId, options);

  if (asProfile === 'my_save') {
    setSaveProfileInfo(gameId, {
      activeProfile: 'my_save',
      myBackupId: backupId,
      lastSwappedAt: new Date().toISOString(),
    });
  } else if (asProfile === 'host') {
    setSaveProfileInfo(gameId, {
      activeProfile: 'host',
      hostBackupId: backupId,
      lastSwappedAt: new Date().toISOString(),
    });
  }

  return {
    success: true,
    targetProfile: (asProfile || 'custom') as any,
    restoredBackupId: backupId,
    safetyBackupId: restoreRes.safetyBackupId,
    restored: restoreRes.restored,
    errors: restoreRes.errors,
  };
}

/**
 * Downloads a backup from Google Drive and registers it into the vault as 'my_save'
 */
export async function downloadAndAdoptDriveBackup(
  gameId: number,
  drivePath: string,
  options?: SaveManagerOptions
): Promise<SaveBackup> {
  const game = getGameById(gameId);
  if (!game) throw new Error(`Game with id ${gameId} not found`);

  const { downloadBackupFromDrive } = require('./drive.ts');
  const { root } = resolveVaultRoot(options);
  const result = await downloadBackupFromDrive(drivePath, root);

  const manifest = readManifest(result.localDir);
  const totalFiles = manifest?.totalFiles || result.filesDownloaded;
  const totalBytes = manifest?.totalBytes || walkStats(result.localDir).bytes;
  const slotTime = manifest?.slotTime || path.basename(result.localDir);

  let existing = getSaveBackupByDir(result.localDir);
  if (!existing) {
    existing = recordSaveBackup({
      game_id: game.id,
      backup_dir: result.localDir,
      slot_time: slotTime,
      size_bytes: totalBytes,
      file_count: totalFiles,
      trigger: 'my_save',
      note: manifest?.note || 'Tải về từ Google Drive (Save của tôi)',
    });
  }
  return existing;
}

// ==========================================
// High-level composition used by IPC
// ==========================================

export function getSavesList(gameId: number, options?: SaveManagerOptions): SavesListResult {
  return {
    paths: getSavePaths(gameId),
    backups: getSaveBackups(gameId),
    vault: getVaultInfo(options),
    profileInfo: getSaveProfileInfo(gameId),
  };
}

export { addSavePath, removeSavePath, setSavePathEnabled };
