import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  configureDrive,
  uploadMediaToDrive,
  downloadMediaFromDrive,
  getDriveMediaStats,
} from '../src/main/drive.ts';
import { configureAuth, persistSession, clearSession } from '../src/main/auth.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-drive-media-${prefix}-`));
}

// In-memory Google Drive mock server
function createMockDriveFetch() {
  let nextId = 1;
  // Map of fileId -> { id, name, mimeType, parents: string[], content: Buffer }
  const files = new Map();

  return {
    files,
    async fetch(urlStr, init = {}) {
      const url = new URL(urlStr);
      const method = (init.method || 'GET').toUpperCase();

      // 1. Files List / Query: GET https://www.googleapis.com/drive/v3/files
      if (url.pathname === '/drive/v3/files' && method === 'GET') {
        const q = url.searchParams.get('q') || '';
        let list = Array.from(files.values());

        // Parse simple parents clause: 'parentId' in parents or 'appDataFolder' in parents
        const parentMatch = q.match(/'([^']+)' in parents/);
        if (parentMatch) {
          const parent = parentMatch[1];
          list = list.filter((f) => f.parents.includes(parent));
        }

        // Parse name match: name = 'xxx'
        const nameMatch = q.match(/name = '([^']+)'/);
        if (nameMatch) {
          const name = nameMatch[1].replace(/\\'/g, "'");
          list = list.filter((f) => f.name === name);
        }

        return new Response(JSON.stringify({ files: list }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. Create Folder: POST https://www.googleapis.com/drive/v3/files
      if (url.pathname === '/drive/v3/files' && method === 'POST') {
        const body = JSON.parse(init.body);
        const id = `folder_${nextId++}`;
        const item = {
          id,
          name: body.name,
          mimeType: body.mimeType,
          parents: body.parents || [],
          content: Buffer.alloc(0),
        };
        files.set(id, item);
        return new Response(JSON.stringify(item), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 3. Multipart Upload: POST https://www.googleapis.com/upload/drive/v3/files
      if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
        const contentType = String(init.headers?.['Content-Type'] || init.headers?.['content-type'] || '');
        const boundaryMatch = contentType.match(/boundary=([^;]+)/);
        const boundary = boundaryMatch ? boundaryMatch[1] : '';

        // Extract metadata and content
        const bodyBuffer = Buffer.isBuffer(init.body)
          ? init.body
          : Buffer.from(init.body instanceof Uint8Array ? init.body : String(init.body));

        const bodyStr = bodyBuffer.toString('utf-8');
        const jsonMatch = bodyStr.match(/\{[\s\S]*?\}/);
        const metadata = jsonMatch ? JSON.parse(jsonMatch[0]) : { name: 'unnamed', parents: [] };

        // Binary content extraction (between headers and closing boundary)
        const parts = bodyStr.split(`--${boundary}`);
        let contentBuffer = Buffer.alloc(0);
        if (parts.length >= 3) {
          const filePart = parts[2];
          const headerEnd = filePart.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            const rawContent = filePart.slice(headerEnd + 4).replace(/\r\n$/, '');
            contentBuffer = Buffer.from(rawContent, 'utf-8');
          }
        }

        const id = `file_${nextId++}`;
        const item = {
          id,
          name: metadata.name,
          mimeType: 'image/png',
          parents: metadata.parents || [],
          content: contentBuffer,
        };
        files.set(id, item);
        return new Response(JSON.stringify(item), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 4. Download File: GET https://www.googleapis.com/drive/v3/files/:id?alt=media
      const getMediaMatch = url.pathname.match(/\/drive\/v3\/files\/([^/]+)/);
      if (getMediaMatch && method === 'GET') {
        const fileId = getMediaMatch[1];
        const item = files.get(fileId);
        if (!item) {
          return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        }
        return new Response(item.content, { status: 200 });
      }

      return new Response('Unhandled mock drive URL: ' + urlStr, { status: 404 });
    },
  };
}

describe('Google Drive Media (Screenshots) Cloud Sync Suite', () => {
  let tmpDirs = [];
  let userDataDir;
  let mockDrive;

  const newTmp = (prefix) => {
    const dir = makeTempDir(prefix);
    tmpDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    tmpDirs = [];
    userDataDir = newTmp('user-data');
    mockDrive = createMockDriveFetch();

    configureAuth({
      config: { oauthClientId: 'cid', oauthClientSecret: 'cs' },
      userDataDir,
      fetchImpl: mockDrive.fetch,
    });
    configureDrive({ fetchImpl: mockDrive.fetch });

    persistSession(
      {
        sessionToken: 'token_123',
        expiresAt: Date.now() + 3600 * 1000,
        user: { uid: 'user_1', email: 'user@test.com', displayName: 'Test Gamer', photoUrl: '' },
        google: {
          accessToken: 'mock_google_access_token',
          refreshToken: 'mock_refresh',
          expiresAt: Date.now() + 3600 * 1000,
          scope: 'drive.appdata',
        },
        updatedAt: new Date().toISOString(),
      },
      { userDataDir }
    );
  });

  afterEach(() => {
    clearSession({ userDataDir });
    configureDrive({ fetchImpl: undefined });
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  test('uploadMediaToDrive uploads screenshots and avoids duplicate re-uploads', async () => {
    const localMediaDir = newTmp('local-media');
    const bloodborneDir = path.join(localMediaDir, 'Bloodborne');
    fs.mkdirSync(bloodborneDir, { recursive: true });

    fs.writeFileSync(path.join(bloodborneDir, 'boss_fight.png'), 'fake-png-data-1');
    fs.writeFileSync(path.join(bloodborneDir, 'ending_scene.jpg'), 'fake-jpg-data-2');
    fs.writeFileSync(path.join(bloodborneDir, 'notes.txt'), 'ignore non-media files');

    // First upload
    const uploadRes = await uploadMediaToDrive({ localMediaBaseDir: localMediaDir });
    assert.equal(uploadRes.gamesProcessed, 1);
    assert.equal(uploadRes.filesUploaded, 2, 'Should upload 2 image files and ignore .txt');
    assert.ok(uploadRes.bytesUploaded > 0);

    // Check stats
    const stats = await getDriveMediaStats();
    assert.equal(stats.gamesCount, 1);
    assert.equal(stats.filesCount, 2);

    // Second upload: should detect existing files and skip re-uploading
    const uploadRes2 = await uploadMediaToDrive({ localMediaBaseDir: localMediaDir });
    assert.equal(uploadRes2.filesUploaded, 0, 'Should skip already-uploaded files on Drive');
  });

  test('downloadMediaFromDrive pulls all screenshots from Drive to a fresh PC', async () => {
    // 1. First populate Drive from PC A
    const pcAMediaDir = newTmp('pc-a-media');
    const eldenDir = path.join(pcAMediaDir, 'Elden Ring');
    fs.mkdirSync(eldenDir, { recursive: true });
    fs.writeFileSync(path.join(eldenDir, 'malenia_victory.png'), 'malenia-screenshot-bytes');

    await uploadMediaToDrive({ localMediaBaseDir: pcAMediaDir });

    // 2. Now simulate PC B (New machine with fresh media directory)
    const pcBMediaDir = newTmp('pc-b-media');
    assert.equal(fs.existsSync(path.join(pcBMediaDir, 'Elden Ring')), false);

    const restoreRes = await downloadMediaFromDrive({ localMediaBaseDir: pcBMediaDir });
    assert.equal(restoreRes.gamesRestored, 1);
    assert.equal(restoreRes.filesDownloaded, 1);

    // Verify file exists on PC B
    const restoredFile = path.join(pcBMediaDir, 'Elden Ring', 'malenia_victory.png');
    assert.equal(fs.existsSync(restoredFile), true);
    assert.equal(fs.readFileSync(restoredFile, 'utf-8'), 'malenia-screenshot-bytes');
  });
});
