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

async function listFolder(folderId: string): Promise<Array<{ id: string; name: string; mimeType: string; size?: string }>> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders();
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size)&spaces=appDataFolder&pageSize=200`;
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

const MEDIA_EXTS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.heic',
  // Videos
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.wmv', '.flv',
]);

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.gif': return 'image/gif';
    case '.heic': return 'image/heic';
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.mkv': return 'video/x-matroska';
    case '.webm': return 'video/webm';
    case '.avi': return 'video/x-msvideo';
    case '.m4v': return 'video/x-m4v';
    case '.wmv': return 'video/x-ms-wmv';
    case '.flv': return 'video/x-flv';
    default: return 'application/octet-stream';
  }
}

const RESUMABLE_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB

async function uploadResumableFile(
  name: string,
  parentId: string,
  filePath: string,
  fileSize: number,
  mimeType = 'application/octet-stream',
  onChunkUploaded?: (bytesUploadedDelta: number) => void
): Promise<string> {
  const doFetch = await driveFetch();
  const token = await getValidGoogleAccessToken();

  // 1. Initiate resumable upload session
  const initResp = await doFetch(`${DRIVE_UPLOAD_API}?uploadType=resumable`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(fileSize),
    },
    body: JSON.stringify({ name, parents: [parentId] }),
  });

  if (!initResp.ok) {
    const errorText = await initResp.text().catch(() => '');
    throw new Error(`Drive resumable init failed (${name}): ${initResp.status} ${errorText}`);
  }

  const uploadLocation = initResp.headers.get('location');
  if (!uploadLocation) {
    throw new Error(`Drive resumable init returned no Location header for ${name}`);
  }

  // 2. Upload chunks (8 MB chunks, multiple of 256 KiB)
  const CHUNK_SIZE = 8 * 1024 * 1024;
  const fd = fs.openSync(filePath, 'r');
  let start = 0;
  let fileId = '';

  try {
    const buffer = Buffer.alloc(CHUNK_SIZE);
    while (start < fileSize) {
      const bytesToRead = Math.min(CHUNK_SIZE, fileSize - start);
      fs.readSync(fd, buffer, 0, bytesToRead, start);
      const chunk = buffer.subarray(0, bytesToRead);
      const end = start + bytesToRead - 1;

      const chunkResp = await doFetch(uploadLocation, {
        method: 'PUT',
        headers: {
          'Content-Length': String(bytesToRead),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        },
        body: chunk,
      });

      if (chunkResp.status === 200 || chunkResp.status === 201) {
        const data = await chunkResp.json();
        fileId = data.id;
        onChunkUploaded?.(bytesToRead);
        break;
      } else if (chunkResp.status === 308) {
        start += bytesToRead;
        onChunkUploaded?.(bytesToRead);
      } else {
        const errorText = await chunkResp.text().catch(() => '');
        throw new Error(`Drive resumable chunk failed (${name} [${start}-${end}]): ${chunkResp.status} ${errorText}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return fileId;
}

async function uploadMediaItem(
  name: string,
  parentId: string,
  filePath: string,
  fileSize: number,
  mimeType: string,
  onChunkUploaded?: (bytesUploadedDelta: number) => void
): Promise<string> {
  if (fileSize < RESUMABLE_THRESHOLD_BYTES) {
    const content = fs.readFileSync(filePath);
    const id = await uploadFile(name, parentId, content, mimeType);
    onChunkUploaded?.(content.length);
    return id;
  }
  return uploadResumableFile(name, parentId, filePath, fileSize, mimeType, onChunkUploaded);
}

async function downloadFileToDisk(fileId: string, destPath: string, onChunk?: (bytesChunk: number) => void): Promise<void> {
  const doFetch = await driveFetch();
  const headers = await authedHeaders();
  const resp = await doFetch(`${DRIVE_API}/${fileId}?alt=media`, { headers });
  if (!resp.ok) {
    throw new Error(`Drive download failed: ${resp.status}`);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (resp.body && typeof (resp.body as any).getReader === 'function') {
    const reader = (resp.body as any).getReader();
    const fileStream = fs.createWriteStream(destPath);
    await new Promise<void>(async (resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            fileStream.write(Buffer.from(value));
            onChunk?.(value.byteLength);
          }
        }
        fileStream.end();
      } catch (readErr) {
        fileStream.destroy();
        reject(readErr);
      }
    });
  } else {
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    onChunk?.(buf.length);
  }
}

function formatTransferSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatDualSize(transferred: number, total: number): { formattedTransferred: string; formattedTotal: string } {
  if (total >= 1024 * 1024 * 1024) {
    return {
      formattedTransferred: `${(transferred / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      formattedTotal: `${(total / (1024 * 1024 * 1024)).toFixed(2)} GB`,
    };
  }
  return {
    formattedTransferred: `${(transferred / (1024 * 1024)).toFixed(1)} MB`,
    formattedTotal: `${(total / (1024 * 1024)).toFixed(1)} MB`,
  };
}

export interface ActiveMediaSyncStatus {
  isRunning: boolean;
  type?: 'upload' | 'download';
  progress?: DriveMediaProgress | null;
  result?: any;
  error?: string | null;
}

let activeMediaSync: {
  type: 'upload' | 'download';
  progress: DriveMediaProgress | null;
  promise: Promise<any>;
} | null = null;

let lastCompletedSync: {
  type: 'upload' | 'download';
  result?: any;
  error?: string | null;
} | null = null;

export function getActiveMediaSyncStatus(): ActiveMediaSyncStatus {
  if (activeMediaSync) {
    return {
      isRunning: true,
      type: activeMediaSync.type,
      progress: activeMediaSync.progress,
    };
  }
  if (lastCompletedSync) {
    return {
      isRunning: false,
      type: lastCompletedSync.type,
      result: lastCompletedSync.result,
      error: lastCompletedSync.error,
    };
  }
  return { isRunning: false };
}

export async function uploadMediaToDrive(options: {
  gameTitle?: string;
  localMediaBaseDir?: string;
  onProgress?: (progress: DriveMediaProgress) => void;
} = {}): Promise<DriveMediaSyncResult> {
  if (activeMediaSync) {
    return activeMediaSync.promise;
  }

  const runUpload = async (): Promise<DriveMediaSyncResult> => {
    const baseDir = options.localMediaBaseDir || loadAppSettings().mediaBaseDir || 'E:\\Game';
    if (!fs.existsSync(baseDir)) {
      return { gamesProcessed: 0, filesUploaded: 0, bytesUploaded: 0, errors: [`Thư mục media ${baseDir} không tồn tại`] };
    }

    // Ensure root folder GameVault/Media in appDataFolder
    const mediaRootId = await ensureFolderPath(['GameVault', 'Media']);

    // Emit initial scanning status
    options.onProgress?.({
      type: 'upload',
      current: 0,
      total: 0,
      percent: 0,
      currentFile: 'Đang kiểm tra file media mới...',
      currentGame: 'Đang quét thư viện ảnh & video...',
      bytesTransferred: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      formattedSpeed: '0 KB/s',
      formattedTransferred: '0 MB',
      formattedTotal: '0 MB',
    });

    // 1. Fetch existing game folders in Drive under Media in ONE request
    const existingFoldersList = await listFolder(mediaRootId);
    const driveFolderMap = new Map<string, string>();
    for (const f of existingFoldersList) {
      if (f.mimeType === FOLDER_MIME) {
        driveFolderMap.set(f.name.toLowerCase(), f.id);
      }
    }

    let foldersToProcess: string[] = [];
    if (options.gameTitle) {
      foldersToProcess = [options.gameTitle];
    } else {
      foldersToProcess = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    }

    // 2. Scan Drive vs Local to collect ONLY new files that need upload
    interface UploadTask {
      gameName: string;
      fileName: string;
      filePath: string;
      size: number;
      driveFolderId?: string;
    }
    const uploadTasks: UploadTask[] = [];

    const foldersWithLocalFiles: Array<{ name: string; dir: string; files: fs.Dirent[] }> = [];
    for (const gameName of foldersToProcess) {
      const localGameDir = path.join(baseDir, gameName);
      if (!fs.existsSync(localGameDir)) continue;
      const localFiles = fs.readdirSync(localGameDir, { withFileTypes: true })
        .filter((f) => f.isFile() && MEDIA_EXTS.has(path.extname(f.name).toLowerCase()));
      if (localFiles.length > 0) {
        foldersWithLocalFiles.push({ name: gameName, dir: localGameDir, files: localFiles });
      }
    }

    const pLimit = 6;
    for (let i = 0; i < foldersWithLocalFiles.length; i += pLimit) {
      const chunk = foldersWithLocalFiles.slice(i, i + pLimit);
      await Promise.all(chunk.map(async (folder) => {
        const folderId = driveFolderMap.get(folder.name.toLowerCase());
        const driveFileSet = new Set<string>();
        if (folderId) {
          const filesOnDrive = await listFolder(folderId);
          for (const df of filesOnDrive) {
            driveFileSet.add(df.name.toLowerCase());
          }
        }
        for (const f of folder.files) {
          if (!driveFileSet.has(f.name.toLowerCase())) {
            const filePath = path.join(folder.dir, f.name);
            let size = 0;
            try {
              size = fs.statSync(filePath).size;
            } catch {}
            uploadTasks.push({
              gameName: folder.name,
              fileName: f.name,
              filePath,
              size,
              driveFolderId: folderId,
            });
          }
        }
      }));
    }

    const totalFiles = uploadTasks.length;
    let totalBytes = 0;
    for (const t of uploadTasks) {
      totalBytes += t.size;
    }

    // If all files are already uploaded, finish immediately!
    if (totalFiles === 0) {
      return {
        gamesProcessed: foldersToProcess.length,
        filesUploaded: 0,
        bytesUploaded: 0,
      };
    }

    let filesUploaded = 0;
    let bytesUploaded = 0;
    let processedFiles = 0;
    const errors: string[] = [];
    const processedGamesSet = new Set<string>();

    const syncStartTime = Date.now();
    let lastSpeedSampleTime = syncStartTime;
    let lastBytesSample = 0;
    let currentSpeed = 0;

    const emitUploadProgress = (currentFileName: string, currentGameName: string) => {
      const now = Date.now();
      const elapsedSinceSample = (now - lastSpeedSampleTime) / 1000;
      if (elapsedSinceSample >= 0.3) {
        const bytesDelta = bytesUploaded - lastBytesSample;
        currentSpeed = Math.max(0, bytesDelta / elapsedSinceSample);
        lastSpeedSampleTime = now;
        lastBytesSample = bytesUploaded;
      } else if (currentSpeed === 0 && (now - syncStartTime) > 300) {
        currentSpeed = bytesUploaded / ((now - syncStartTime) / 1000);
      }

      const { formattedTransferred, formattedTotal } = formatDualSize(bytesUploaded, totalBytes);
      const percent = totalBytes > 0
        ? Math.min(100, Math.round((bytesUploaded / totalBytes) * 100))
        : (totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 100);

      const prog: DriveMediaProgress = {
        type: 'upload',
        current: processedFiles,
        total: totalFiles,
        percent,
        currentFile: currentFileName,
        currentGame: currentGameName,
        bytesTransferred: bytesUploaded,
        totalBytes,
        speedBytesPerSec: Math.round(currentSpeed),
        formattedSpeed: formatTransferSpeed(currentSpeed),
        formattedTransferred,
        formattedTotal,
      };
      if (activeMediaSync) {
        activeMediaSync.progress = prog;
      }
      options.onProgress?.(prog);
    };

    const createdFolderMap = new Map<string, string>();
    const folderPromiseMap = new Map<string, Promise<string>>();

    const getOrCreateGameFolder = async (gameName: string): Promise<string> => {
      const key = gameName.toLowerCase();
      const existing = driveFolderMap.get(key) || createdFolderMap.get(key);
      if (existing) return existing;

      let p = folderPromiseMap.get(key);
      if (!p) {
        p = (async () => {
          const found = await findChild(mediaRootId, gameName);
          if (found) {
            createdFolderMap.set(key, found);
            return found;
          }
          const created = await createFolder(gameName, mediaRootId);
          createdFolderMap.set(key, created);
          return created;
        })();
        folderPromiseMap.set(key, p);
      }
      return p;
    };

    const CONCURRENCY = 3;
    let uploadIndex = 0;

    const runUploadWorker = async () => {
      while (true) {
        const idx = uploadIndex++;
        if (idx >= uploadTasks.length) break;
        const task = uploadTasks[idx];

        emitUploadProgress(task.fileName, task.gameName);

        try {
          const driveFolderId = task.driveFolderId || (await getOrCreateGameFolder(task.gameName));
          await uploadMediaItem(
            task.fileName,
            driveFolderId,
            task.filePath,
            task.size,
            getMimeType(task.fileName),
            (delta) => {
              bytesUploaded += delta;
              emitUploadProgress(task.fileName, task.gameName);
            }
          );
          filesUploaded++;
          processedFiles++;
          processedGamesSet.add(task.gameName);
          emitUploadProgress(task.fileName, task.gameName);
        } catch (fileErr: any) {
          errors.push(`Lỗi tải file ${task.fileName} (${task.gameName}): ${fileErr.message}`);
          processedFiles++;
          emitUploadProgress(task.fileName, task.gameName);
        }
      }
    };

    const uploadWorkers = Array.from({ length: Math.min(CONCURRENCY, uploadTasks.length) }, () => runUploadWorker());
    await Promise.all(uploadWorkers);

    return {
      gamesProcessed: Math.max(foldersToProcess.length, processedGamesSet.size),
      filesUploaded,
      bytesUploaded,
      errors: errors.length > 0 ? errors : undefined,
    };
  };

  const promise = runUpload();
  activeMediaSync = { type: 'upload', progress: null, promise };
  try {
    const res = await promise;
    lastCompletedSync = { type: 'upload', result: res };
    return res;
  } catch (err: any) {
    lastCompletedSync = { type: 'upload', error: err?.message };
    throw err;
  } finally {
    activeMediaSync = null;
  }
}

export async function downloadMediaFromDrive(options: {
  gameTitle?: string;
  localMediaBaseDir?: string;
  onProgress?: (progress: DriveMediaProgress) => void;
} = {}): Promise<DriveMediaRestoreResult> {
  if (activeMediaSync) {
    return activeMediaSync.promise;
  }

  const runDownload = async (): Promise<DriveMediaRestoreResult> => {
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

    // Pre-calculate target drive files that are actually missing locally
    interface DownloadTask {
      gameName: string;
      fileName: string;
      fileId: string;
      size: number;
      localGameDir: string;
      targetFilePath: string;
    }
    const downloadTasks: DownloadTask[] = [];

    for (const gameFolder of targetFolders) {
      const localGameDir = path.join(baseDir, gameFolder.name);
      const driveFiles = (await listFolder(gameFolder.id)).filter((f) => f.mimeType !== FOLDER_MIME);

      for (const file of driveFiles) {
        const targetFilePath = path.join(localGameDir, file.name);
        if (!fs.existsSync(targetFilePath)) {
          downloadTasks.push({
            gameName: gameFolder.name,
            fileName: file.name,
            fileId: file.id,
            size: Number(file.size || 0),
            localGameDir,
            targetFilePath,
          });
        }
      }
    }

    const totalFiles = downloadTasks.length;
    let totalBytes = 0;
    for (const t of downloadTasks) {
      totalBytes += t.size;
    }

    if (totalFiles === 0) {
      return {
        gamesRestored: targetFolders.length,
        filesDownloaded: 0,
        localBaseDir: baseDir,
      };
    }

    let filesDownloaded = 0;
    let bytesDownloaded = 0;
    let processedFiles = 0;
    const restoredGamesSet = new Set<string>();

    const syncStartTime = Date.now();
    let lastSpeedSampleTime = syncStartTime;
    let lastBytesSample = 0;
    let currentSpeed = 0;

    const emitDownloadProgress = (currentFileName: string, currentGameName: string) => {
      const now = Date.now();
      const elapsedSinceSample = (now - lastSpeedSampleTime) / 1000;
      if (elapsedSinceSample >= 0.3) {
        const bytesDelta = bytesDownloaded - lastBytesSample;
        currentSpeed = Math.max(0, bytesDelta / elapsedSinceSample);
        lastSpeedSampleTime = now;
        lastBytesSample = bytesDownloaded;
      } else if (currentSpeed === 0 && (now - syncStartTime) > 300) {
        currentSpeed = bytesDownloaded / ((now - syncStartTime) / 1000);
      }

      const { formattedTransferred, formattedTotal } = formatDualSize(bytesDownloaded, totalBytes);
      const percent = totalBytes > 0
        ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100))
        : (totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 100);

      const prog: DriveMediaProgress = {
        type: 'download',
        current: processedFiles,
        total: totalFiles,
        percent,
        currentFile: currentFileName,
        currentGame: currentGameName,
        bytesTransferred: bytesDownloaded,
        totalBytes,
        speedBytesPerSec: Math.round(currentSpeed),
        formattedSpeed: formatTransferSpeed(currentSpeed),
        formattedTransferred,
        formattedTotal,
      };
      if (activeMediaSync) {
        activeMediaSync.progress = prog;
      }
      options.onProgress?.(prog);
    };

    const CONCURRENCY = 3;
    let downloadIndex = 0;

    const runDownloadWorker = async () => {
      while (true) {
        const idx = downloadIndex++;
        if (idx >= downloadTasks.length) break;
        const task = downloadTasks[idx];

        emitDownloadProgress(task.fileName, task.gameName);
        fs.mkdirSync(task.localGameDir, { recursive: true });

        try {
          await downloadFileToDisk(task.fileId, task.targetFilePath, (delta) => {
            bytesDownloaded += delta;
            emitDownloadProgress(task.fileName, task.gameName);
          });
          filesDownloaded++;
          processedFiles++;
          restoredGamesSet.add(task.gameName);
          emitDownloadProgress(task.fileName, task.gameName);
        } catch (err: any) {
          console.error(`Failed to download ${task.fileName}:`, err);
          processedFiles++;
          emitDownloadProgress(task.fileName, task.gameName);
        }
      }
    };

    const downloadWorkers = Array.from({ length: Math.min(CONCURRENCY, downloadTasks.length) }, () => runDownloadWorker());
    await Promise.all(downloadWorkers);

    return {
      gamesRestored: Math.max(targetFolders.length, restoredGamesSet.size),
      filesDownloaded,
      localBaseDir: baseDir,
    };
  };

  const promise = runDownload();
  activeMediaSync = { type: 'download', progress: null, promise };
  try {
    const res = await promise;
    lastCompletedSync = { type: 'download', result: res };
    return res;
  } catch (err: any) {
    lastCompletedSync = { type: 'download', error: err?.message };
    throw err;
  } finally {
    activeMediaSync = null;
  }
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
