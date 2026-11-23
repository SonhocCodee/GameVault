import path from 'node:path';
import fs from 'node:fs';
import { getSaveBackupById } from './db.ts';
import { getValidGoogleAccessToken, type FetchLike } from './auth.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function defaultFetch(): FetchLike {
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

  const resp = await doFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body: new Uint8Array(body),
  });
  if (!resp.ok) {
    throw new Error(`Drive upload failed (${name}): ${resp.status}`);
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
