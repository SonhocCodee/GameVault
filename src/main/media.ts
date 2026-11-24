import electronModule from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { MediaItem } from '../shared/types.ts';

// In Electron runtime, electronModule has shell. In test mode, fallback safely.
const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;
const shell = electron.shell || {
  openPath: async (_p: string) => '',
};

// Production default stays E:\Game; GAMEVAULT_MEDIA_ROOT overrides it (tests / portable installs)
export const DEFAULT_MEDIA_ROOT = process.env.GAMEVAULT_MEDIA_ROOT || 'E:\\Game';

// Chosen during first-run setup / Settings ("đổi ổ lưu ảnh"): every resolver
// below falls back to this module root, so tracker/amd-watcher/main IPC
// callers automatically follow the user's configured media drive
let configuredMediaRoot: string | null = null;

export function setMediaBaseDir(dir?: string | null): void {
  const trimmed = (dir || '').trim();
  configuredMediaRoot = trimmed || null;
  // Root changed → any cached listing (keyed by the previous root) is stale
  invalidateMediaListCache();
}

/**
 * Effective media root for a call: explicit argument wins (tests / explicit
 * callers), otherwise the configured setting, otherwise the production default.
 */
export function resolveMediaRoot(explicit?: string | null): string {
  if (explicit && explicit.trim()) return explicit;
  if (configuredMediaRoot && configuredMediaRoot.trim()) return configuredMediaRoot;
  return DEFAULT_MEDIA_ROOT;
}

// Common aliases mapping shorthand or folder names to canonical titles and vice versa
export const FOLDER_ALIASES: Record<string, string> = {
  // Alias -> Canonical
  'pbz': 'Phantom Blade Zero',
  'crimsondersert': 'Crimson Desert',
  'ds2': 'Dead Space 2',
  'warhammer 40k': 'Warhammer 40000 Space Marine 2',
  'god of war raknarok': 'God of War Ragnarok',
  'horizonforbiddenwest': 'Horizon Forbidden West',
  'detroit become human': 'Detroit: Become Human',
  'ff7 rebirth': 'Final Fantasy VII Rebirth',
  'final fantasy vii rebirth': 'Final Fantasy VII Rebirth',
  'control resonant': 'Control',
  'the callisto protocol': 'The Callisto Protocol',
  '007 first light': '007 First Light',
  'mortal shell 2': 'Mortal Shell 2',
  'onimusha': 'Onimusha: The Way of the Sword',
  'tlou': 'The Last of Us Part I',
  'tlou-i': 'The Last of Us Part I',
  'tloui': 'The Last of Us Part I',

  // Canonical -> Common folder name on disk
  'the last of us part i': 'The Last of Us Part I',
  'phantom blade zero': 'PBZ',
  'crimson desert': 'CrimsonDersert',
  'dead space 2': 'DS2',
  'warhammer 40000 space marine 2': 'Warhammer 40k',
  'god of war ragnarok': 'God Of War Raknarok',
  'god of war ragnarök': 'God Of War Raknarok',
  'horizon forbidden west': 'HorizonForbiddenWest',
  'onimusha: the way of the sword': 'Onimusha',
};

/**
 * Sanitizes title for Windows folder naming.
 * Strips < > : " / \ | ? * and normalizes spaces.
 */
export function sanitizeTitleForFolder(title: string | null | undefined): string {
  if (!title || typeof title !== 'string') {
    return 'Unknown_Game';
  }
  const sanitized = title
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  return sanitized || 'Unknown_Game';
}

/**
 * Resolves folder alias (case-insensitive lookup).
 */
export function resolveFolderAlias(folderOrTitle: string): string {
  if (!folderOrTitle) return folderOrTitle;
  const key = folderOrTitle.trim().toLowerCase();
  return FOLDER_ALIASES[key] || folderOrTitle;
}

/**
 * Normalizes a string for alphanumeric comparison (strips non-alphanumerics, lowercase).
 */
export function normalizeForMatch(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Computes Levenshtein distance between two strings for fuzzy typo matching.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];

  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }

  return d[m][n];
}

// Short-lived cache of the media folder listing: opening several game detail
// views in a row re-scanned baseDir (E:\Game on an HDD) each time, spinning
// the disk back up just to list the same directory names
const MEDIA_LIST_CACHE_TTL_MS = 60 * 1000;
let mediaListCache: { baseDir: string; at: number; directories: string[] } | null = null;

function listMediaDirectories(baseDir: string): string[] | null {
  if (mediaListCache && mediaListCache.baseDir === baseDir && Date.now() - mediaListCache.at < MEDIA_LIST_CACHE_TTL_MS) {
    return mediaListCache.directories;
  }
  let directories: string[];
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    directories = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  mediaListCache = { baseDir, at: Date.now(), directories };
  return directories;
}

/** Called whenever a new game media folder is created so the cache stays fresh. */
export function invalidateMediaListCache(baseDir?: string): void {
  if (!baseDir || mediaListCache?.baseDir === baseDir) {
    mediaListCache = null;
  }
}

/**
 * Scans baseDir using multi-tier heuristics to find the game's actual media folder:
 * 1. Exact match (case-insensitive)
 * 2. Sanitized title match
 * 3. Alias dictionary resolution (both alias -> canonical and canonical -> alias)
 * 4. Normalized alphanumeric match (removes spaces, colons, hyphens)
 * 5. Levenshtein fuzzy match (distance <= 2)
 */
export function findGameFolder(gameTitle: string, baseDir: string = resolveMediaRoot()): string | null {
  if (!fs.existsSync(baseDir)) {
    return null;
  }

  try {
    const directories = listMediaDirectories(baseDir);
    if (!directories) return null;

    const titleLower = gameTitle.trim().toLowerCase();
    const sanitizedTitle = sanitizeTitleForFolder(gameTitle);
    const sanitizedLower = sanitizedTitle.toLowerCase();
    const normalizedTitle = normalizeForMatch(gameTitle);

    // Tier 1: Exact match (case-insensitive)
    for (const dir of directories) {
      if (dir.toLowerCase() === titleLower || dir.toLowerCase() === sanitizedLower) {
        return path.join(baseDir, dir);
      }
    }

    // Tier 2: Check Alias Dictionary
    const aliasResolved = resolveFolderAlias(gameTitle);
    if (aliasResolved !== gameTitle) {
      const aliasLower = aliasResolved.toLowerCase();
      for (const dir of directories) {
        if (dir.toLowerCase() === aliasLower || normalizeForMatch(dir) === normalizeForMatch(aliasResolved)) {
          return path.join(baseDir, dir);
        }
      }
    }

    // Check reverse alias lookup
    for (const [key, val] of Object.entries(FOLDER_ALIASES)) {
      if (key === titleLower || val.toLowerCase() === titleLower) {
        for (const dir of directories) {
          const dirLower = dir.toLowerCase();
          if (dirLower === key || dirLower === val.toLowerCase() || dirLower === resolveFolderAlias(key).toLowerCase()) {
            return path.join(baseDir, dir);
          }
        }
      }
    }

    // Tier 3: Normalized match (removes spaces, punctuation)
    for (const dir of directories) {
      if (normalizeForMatch(dir) === normalizedTitle) {
        return path.join(baseDir, dir);
      }
    }

    // Tier 4: Fuzzy Levenshtein match (distance <= 2 for titles of length >= 6)
    if (normalizedTitle.length >= 6) {
      for (const dir of directories) {
        const normDir = normalizeForMatch(dir);
        if (Math.abs(normDir.length - normalizedTitle.length) <= 3) {
          if (levenshteinDistance(normDir, normalizedTitle) <= 2) {
            return path.join(baseDir, dir);
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[media] Failed to scan base directory ${baseDir}:`, err);
  }

  return null;
}

export interface EnsureFolderResult {
  folderName: string;
  fullPath: string;
}

/**
 * Ensures game media folder exists at baseDir/<SanitizedTitle>.
 * If a matching folder is found through heuristics, it is reused.
 * Otherwise creates a new sanitized folder.
 */
export function ensureGameFolder(
  gameTitle: string,
  baseDir: string = resolveMediaRoot(),
  existingFolder?: string | null
): EnsureFolderResult {
  if (existingFolder) {
    const fullPath = path.isAbsolute(existingFolder)
      ? existingFolder
      : path.join(baseDir, existingFolder);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    return { folderName: path.basename(fullPath), fullPath };
  }

  // Check if folder already exists via multi-tier heuristics
  const existingPath = findGameFolder(gameTitle, baseDir);
  if (existingPath) {
    return {
      folderName: path.basename(existingPath),
      fullPath: existingPath,
    };
  }

  // Create new folder with sanitized title
  const folderName = sanitizeTitleForFolder(gameTitle);
  const fullPath = path.join(baseDir, folderName);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    invalidateMediaListCache(baseDir);
  }

  return { folderName, fullPath };
}

/**
 * Resolves the absolute path and folder name for a game's media folder.
 */
export function getGameFolderPath(
  gameTitle: string,
  baseDir: string = resolveMediaRoot(),
  existingFolder?: string | null
): EnsureFolderResult {
  return ensureGameFolder(gameTitle, baseDir, existingFolder);
}

/**
 * Opens game media folder in Windows Explorer using shell.openPath.
 */
export function openMediaFolder(gameTitle: string, baseDir: string = resolveMediaRoot()): Promise<boolean> {
  const { fullPath } = ensureGameFolder(gameTitle, baseDir);
  return shell
    .openPath(fullPath)
    .then((errorMessage: string | undefined) => {
      if (errorMessage) {
        console.error(`[media] Failed to open path ${fullPath}:`, errorMessage);
        return false;
      }
      return true;
    })
    .catch((err: unknown) => {
      console.error(`[media] Exception opening path ${fullPath}:`, err);
      return false;
    });
}

export interface MediaFileInfo {
  filename: string;
  path: string;
  size: number;
  mtime: Date;
  type: 'image' | 'video';
}

export interface ScanResult {
  images: MediaFileInfo[];
  videos: MediaFileInfo[];
  totalCount: number;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic', '.bmp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);

/**
 * Scans a directory for images and video files, ignoring system files and nested directories.
 * Results sorted by mtime descending (newest first).
 */
export function scanMediaFiles(folderPath: string): ScanResult {
  if (!fs.existsSync(folderPath)) {
    return { images: [], videos: [], totalCount: 0 };
  }

  const images: MediaFileInfo[] = [];
  const videos: MediaFileInfo[] = [];

  try {
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      // Ignore system files
      if (file.toLowerCase() === 'desktop.ini' || file.toLowerCase() === 'thumbs.db' || file.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(folderPath, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) continue;

        const ext = path.extname(file).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          images.push({
            filename: file,
            path: fullPath,
            size: stat.size,
            mtime: stat.mtime,
            type: 'image',
          });
        } else if (VIDEO_EXTENSIONS.has(ext)) {
          videos.push({
            filename: file,
            path: fullPath,
            size: stat.size,
            mtime: stat.mtime,
            type: 'video',
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Sort newest first
    images.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    videos.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch (err) {
    console.warn(`[media] Error scanning folder ${folderPath}:`, err);
  }

  return {
    images,
    videos,
    totalCount: images.length + videos.length,
  };
}

/**
 * Returns formatted media items for renderer, sorted by captureDate descending.
 * Uses game-media://local/<path> custom streaming protocol URLs.
 */
export async function getGameMedia(gameTitle: string, baseDir: string = resolveMediaRoot()): Promise<MediaItem[]> {
  const targetPath = findGameFolder(gameTitle, baseDir) || path.join(baseDir, sanitizeTitleForFolder(gameTitle));

  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const { images, videos } = scanMediaFiles(targetPath);
  const allFiles = [...images, ...videos];

  // Sort overall newest first
  allFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return allFiles.map((file, idx) => {
    // Standardize URL with game-media protocol
    const normalizedSlashPath = file.path.replace(/\\/g, '/');
    const mediaUrl = `game-media://local/${encodeURIComponent(normalizedSlashPath)}`;

    return {
      id: `media_${idx}_${file.filename}`,
      name: file.filename,
      path: file.path,
      url: mediaUrl,
      type: file.type,
      size: file.size,
      createdAt: file.mtime.toISOString(),
      captureDate: file.mtime.toISOString(),
    };
  });
}
