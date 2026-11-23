import path from 'node:path';
import fs from 'node:fs';
import { getSaveBackupById } from './db.ts';
import { getValidGoogleAccessToken, type FetchLike } from './auth.ts';
import { loadAppSettings } from './settings.ts';
import { sanitizeTitleForFolder } from './media.ts';
import type {
  DriveMediaSyncResult,
  DriveMediaRestoreResult,
  DriveMediaStats,
  DriveGameBackup,
  DriveStorageQuota,
  DriveMediaProgress,
} from '../shared/types.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  const electron = require('electron');
  const netFetch = electron?.net?.fetch;
  if (typeof netFetch === 'function') {
    return netFetch.bind(electron.net);
  }
  return fetch;
}

let driveFetchOverride: FetchLike | null = null;

export function configureDrive(options: { fetchImpl?: FetchLike } = {}): void {
  driveFetchOverride = options.fetchImpl ?? null;
}

async function driveFetch(): Promise<FetchLike> {
  return driveFetchOverride || defaultFetch();
}

async function authedHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getValidGoogleAccessToken();
  return { Authorization: `Bearer ${token}`, ...extra };
}

// ==========================================
// Folder hierarchy helpers
// ==========================================

async function findChild(folderId: string | null, name: string): Promise<string | null> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders();
  const parentClause = folderId ? `'${folderId}' in parents` : `'appDataFolder' in parents`;
  const q = `name = '${name.replace(/'/g, "\\'")}' and trashed = false and ${parentClause}`;
  const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=appDataFolder&pageSize=5`;
  const resp = await doFetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`Drive lookup failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string | null): Promise<string> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders({ 'Content-Type': 'application/json' });
  const body: Record<string, any> = { name, mimeType: FOLDER_MIME, parents: [parentId ?? 'appDataFolder'] };
  const resp = await doFetch(DRIVE_API, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    throw new Error(`Drive folder create failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.id;
}

/** Ensures `<root>/<a>/<b>/...` exists under appDataFolder, returns the leaf id. */
async function ensureFolderPath(segments: string[]): Promise<string> {
  let parent: string | null = null;
  for (const segment of segments) {
    const existing = await findChild(parent, segment);
    parent = existing ?? (await createFolder(segment, parent));
  }
  return parent as string;
}

async function listFolder(folderId: string): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders();
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&spaces=appDataFolder&pageSize=200`;
  const resp = await doFetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`Drive list failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.files || [];
}

// ==========================================
// Upload / download
// ==========================================

async function uploadFile(name: string, parentId: string, content: Buffer, mimeType = 'application/octet-stream'): Promise<string> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders();
  const boundary = `gamevault-${Date.now()}`;
  const metadata = JSON.stringify({ name, parents: [parentId] });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const reqHeaders: Record<string, string> = {
    ...headers,
    'Content-Type': `multipart/related; boundary=${boundary}`,
  };

  const resp = await doFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart`, {
    method: 'POST',
    headers: reqHeaders,
    body: body,
  });
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    throw new Error(`Drive upload failed (${name}): ${resp.status} ${errorText}`);
  }
  const data = await resp.json();
  return data.id;
}

async function downloadFile(fileId: string): Promise<Buffer> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders();
  const resp = await doFetch(`${DRIVE_API}/${fileId}?alt=media`, { headers });
  if (!resp.ok) {
    throw new Error(`Drive download failed: ${resp.status}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export interface DriveSyncResult {
  drivePath: string;
  filesUploaded: number;
  bytesUploaded: number;
}

/**
 * Uploads a backup slot (the timestamped folder in the vault) to
 * `appDataFolder/GameVault/<Game>/<slot>/...` — the user's private Drive space,
 * invisible to other apps and other people.
 */
export async function uploadBackupToDrive(backupId: number, localBaseDir?: string): Promise<DriveSyncResult> {
  const backup = getSaveBackupById(backupId);
  if (!backup) {
    throw new Error(`Save backup with id ${backupId} not found`);
  }
  const backupDir = backup.backup_dir;
  if (!fs.existsSync(backupDir)) {
    throw new Error('Folder backup không còn tồn tại trong vault');
  }

  // drivePath = GameVault/<Game>/<slot> — the vault layout mirrored on Drive
  const vaultRoot = localBaseDir || path.dirname(path.dirname(backupDir));
  const relative = path.relative(vaultRoot, backupDir).split(path.sep);
  const rootId = await ensureFolderPath(['GameVault', ...relative]);

  let filesUploaded = 0;
  let bytesUploaded = 0;

  const walk = async (dir: string, parentId: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subId = await findChild(parentId, entry.name);
        const id = subId ?? (await createFolder(entry.name, parentId));
        await walk(full, id);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(full);
        await uploadFile(entry.name, parentId, content);
        filesUploaded++;
        bytesUploaded += content.length;
      }
    }
  };
  await walk(backupDir, rootId);

  return { drivePath: `GameVault/${relative.join('/')}`, filesUploaded, bytesUploaded };
}

export interface DriveRestoreResult {
  localDir: string;
  filesDownloaded: number;
}

/**
 * Downloads a Drive mirror of a backup slot back into the vault (useful after
 * reinstalling the app on a new machine), returning the local slot folder.
 */
export async function downloadBackupFromDrive(drivePath: string, vaultRoot: string): Promise<DriveRestoreResult> {
  const segments = drivePath.split('/').filter(Boolean);
  let folderId = 'appDataFolder';
  for (const segment of segments) {
    const child = await findChild(folderId === 'appDataFolder' ? null : folderId, segment);
    if (!child) {
      throw new Error(`Không tìm thấy '${segment}' trên Drive`);
    }
    folderId = child;
  }

  const localDir = path.join(vaultRoot, ...segments.slice(1));
  fs.mkdirSync(localDir, { recursive: true });

  let filesDownloaded = 0;
  const walk = async (driveFolderId: string, localFolder: string) => {
    const entries = await listFolder(driveFolderId);
    for (const entry of entries) {
      if (entry.mimeType === FOLDER_MIME) {
        const sub = path.join(localFolder, entry.name);
        fs.mkdirSync(sub, { recursive: true });
        await walk(entry.id, sub);
      } else {
        const content = await downloadFile(entry.id);
        fs.writeFileSync(path.join(localFolder, entry.name), content);
        filesDownloaded++;
      }
    }
  };
  await walk(folderId, localDir);

  return { localDir, filesDownloaded };
}

// ==========================================
// Media / Screenshot Cloud Sync via Drive
// ==========================================

const MEDIA_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

export async function uploadMediaToDrive(options: {
  gameTitle?: string;
  localMediaBaseDir?: string;
  onProgress?: (progress: DriveMediaProgress) => void;
} = {}): Promise<DriveMediaSyncResult> {
  const baseDir = options.localMediaBaseDir || loadAppSettings().mediaBaseDir || 'E:\\Game';
  if (!fs.existsSync(baseDir)) {
    return { gamesProcessed: 0, filesUploaded: 0, bytesUploaded: 0, errors: [`Thư mục media ${baseDir} không tồn tại`] };
  }

  // Ensure root folder GameVault/Media in appDataFolder
  const mediaRootId = await ensureFolderPath(['GameVault', 'Media']);

  let foldersToProcess: string[] = [];
  if (options.gameTitle) {
    foldersToProcess = [options.gameTitle];
  } else {
    foldersToProcess = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  // Pre-calculate total files across target folders
  let totalFiles = 0;
  for (const gameName of foldersToProcess) {
    const dir = path.join(baseDir, gameName);
    if (fs.existsSync(dir)) {
      totalFiles += fs.readdirSync(dir, { withFileTypes: true })
        .filter((f) => f.isFile() && MEDIA_EXTS.has(path.extname(f.name).toLowerCase())).length;
    }
  }

  let gamesProcessed = 0;
  let filesUploaded = 0;
  let bytesUploaded = 0;
  let processedFiles = 0;
  const errors: string[] = [];

  for (const gameName of foldersToProcess) {
    const localGameDir = path.join(baseDir, gameName);
    if (!fs.existsSync(localGameDir)) continue;

    try {
      const driveGameFolderId = await findChild(mediaRootId, gameName) || await createFolder(gameName, mediaRootId);
      const existingDriveFiles = await listFolder(driveGameFolderId);
      const driveFileNames = new Set(existingDriveFiles.map((f) => f.name.toLowerCase()));

      const localFiles = fs.readdirSync(localGameDir, { withFileTypes: true })
        .filter((f) => f.isFile() && MEDIA_EXTS.has(path.extname(f.name).toLowerCase()));

      for (const f of localFiles) {
        processedFiles++;
        const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 100;
        options.onProgress?.({
          type: 'upload',
          current: processedFiles,
          total: totalFiles,
          percent,
          currentFile: f.name,
          currentGame: gameName,
          bytesTransferred: bytesUploaded,
        });

        if (driveFileNames.has(f.name.toLowerCase())) {
          // Already on Drive, skip duplicate upload to save bandwidth
          continue;
        }

        try {
          const filePath = path.join(localGameDir, f.name);
          const content = fs.readFileSync(filePath);
          await uploadFile(f.name, driveGameFolderId, content, getMimeType(f.name));
          filesUploaded++;
          bytesUploaded += content.length;
        } catch (fileErr: any) {
          errors.push(`Lỗi tải ảnh ${f.name} (${gameName}): ${fileErr.message}`);
        }
      }

      gamesProcessed++;
    } catch (err: any) {
      errors.push(`Lỗi khi sync ảnh game ${gameName}: ${err.message}`);
    }
  }

  return {
    gamesProcessed,
    filesUploaded,
    bytesUploaded,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function downloadMediaFromDrive(options: {
  gameTitle?: string;
  localMediaBaseDir?: string;
  onProgress?: (progress: DriveMediaProgress) => void;
} = {}): Promise<DriveMediaRestoreResult> {
  const baseDir = options.localMediaBaseDir || loadAppSettings().mediaBaseDir || 'E:\\Game';
  fs.mkdirSync(baseDir, { recursive: true });

  const gameVaultId = await findChild(null, 'GameVault');
  if (!gameVaultId) {
    return { gamesRestored: 0, filesDownloaded: 0, localBaseDir: baseDir };
  }

  const mediaRootId = await findChild(gameVaultId, 'Media');
  if (!mediaRootId) {
    return { gamesRestored: 0, filesDownloaded: 0, localBaseDir: baseDir };
  }

  const driveGameFolders = await listFolder(mediaRootId);
  const targetFolders = options.gameTitle
    ? driveGameFolders.filter((f) => f.mimeType === FOLDER_MIME && f.name.toLowerCase() === options.gameTitle!.toLowerCase())
    : driveGameFolders.filter((f) => f.mimeType === FOLDER_MIME);

  let gamesRestored = 0;
  let filesDownloaded = 0;

  // Count total drive files first
  let totalFiles = 0;
  const gameFolderFiles: Array<{ gameFolder: any; files: any[] }> = [];
  for (const gameFolder of targetFolders) {
    const driveFiles = (await listFolder(gameFolder.id)).filter((f) => f.mimeType !== FOLDER_MIME);
    totalFiles += driveFiles.length;
    gameFolderFiles.push({ gameFolder, files: driveFiles });
  }

  let processedFiles = 0;
  for (const { gameFolder, files } of gameFolderFiles) {
    const localGameDir = path.join(baseDir, gameFolder.name);
    fs.mkdirSync(localGameDir, { recursive: true });

    for (const file of files) {
      processedFiles++;
      const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 100;
      options.onProgress?.({
        type: 'download',
        current: processedFiles,
        total: totalFiles,
        percent,
        currentFile: file.name,
        currentGame: gameFolder.name,
        bytesTransferred: 0,
      });

      const targetFilePath = path.join(localGameDir, file.name);
      if (fs.existsSync(targetFilePath)) {
        // Already exists locally, skip
        continue;
      }

      try {
        const content = await downloadFile(file.id);
        fs.writeFileSync(targetFilePath, content);
        filesDownloaded++;
      } catch (err: any) {
        console.error(`Failed to download ${file.name}:`, err);
      }
    }

    gamesRestored++;
  }

  return {
    gamesRestored,
    filesDownloaded,
    localBaseDir: baseDir,
  };
}

export async function getDriveMediaStats(): Promise<DriveMediaStats> {
  const gameVaultId = await findChild(null, 'GameVault');
  if (!gameVaultId) return { gamesCount: 0, filesCount: 0 };
  const mediaRootId = await findChild(gameVaultId, 'Media');
  if (!mediaRootId) return { gamesCount: 0, filesCount: 0 };

  const gameFolders = (await listFolder(mediaRootId)).filter((f) => f.mimeType === FOLDER_MIME);
  let filesCount = 0;
  for (const gf of gameFolders) {
    const files = await listFolder(gf.id);
    filesCount += files.filter((f) => f.mimeType !== FOLDER_MIME).length;
  }

  return {
    gamesCount: gameFolders.length,
    filesCount,
  };
}

export async function getDriveStorageQuota(): Promise<DriveStorageQuota> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders();
  const resp = await doFetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', { headers });
  if (!resp.ok) {
    throw new Error(`Drive about lookup failed: ${resp.status}`);
  }
  const data = await resp.json();
  const quota = data.storageQuota || {};
  const limitBytes = Number(quota.limit) || 0;
  const usageBytes = Number(quota.usage) || 0;
  const usageInDriveBytes = Number(quota.usageInDrive) || 0;

  const percentUsed = limitBytes > 0 ? Math.round((usageBytes / limitBytes) * 100) : 0;
  const formattedLimit = limitBytes > 0 ? `${(limitBytes / (1024 * 1024 * 1024)).toFixed(1)} GB` : 'Không giới hạn';
  const formattedUsage = `${(usageBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;

  return {
    limitBytes,
    usageBytes,
    usageInDriveBytes,
    percentUsed,
    formattedLimit,
    formattedUsage,
  };
}

export async function listDriveGameBackups(gameTitle: string): Promise<DriveGameBackup[]> {
  const gameVaultId = await findChild(null, 'GameVault');
  if (!gameVaultId) return [];

  const gameEntries = await listFolder(gameVaultId);
  const targetFolderBase = sanitizeTitleForFolder(gameTitle).toLowerCase();
  const gameFolder = gameEntries.find((e) => {
    if (e.mimeType !== FOLDER_MIME) return false;
    const name = e.name.toLowerCase();
    return name === targetFolderBase || name.startsWith(`${targetFolderBase} (`);
  });
  if (!gameFolder) return [];

  const slots = await listFolder(gameFolder.id);
  const results: DriveGameBackup[] = [];
  for (const slot of slots) {
    if (slot.mimeType === FOLDER_MIME) {
      results.push({
        id: slot.id,
        slotTime: slot.name,
        drivePath: `GameVault/${gameFolder.name}/${slot.name}`,
      });
    }
  }
  return results.sort((a, b) => b.slotTime.localeCompare(a.slotTime));
}
