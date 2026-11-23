import electronModule from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getOrGenerateThumbnail } from './thumbnails.ts';

// In Electron main process runtime, electronModule is the Electron API object.
// In Node.js / test runner mode, electronModule is a string path to electron executable.
const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;
const protocol = electron.protocol || {
  registerSchemesAsPrivileged: () => {},
  handle: () => {},
};

/**
 * Privileged scheme configuration for media streaming.
 * Must be registered before app is ready.
 */
export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'game-media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Map file extensions to correct MIME types.
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    // Videos
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/mp4',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
  };

  return mimeMap[ext] || 'application/octet-stream';
}

export interface Http206RangeResult {
  statusCode: 200 | 206 | 416;
  start: number;
  end: number;
  contentLength: number;
  contentRange: string | null;
}

/**
 * Calculates byte range for HTTP 206 Partial Content video streaming.
 */
export function calculateHttp206Range(
  rangeHeader: string | null | undefined,
  totalFileSize: number
): Http206RangeResult {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return {
      statusCode: 200,
      start: 0,
      end: totalFileSize - 1,
      contentLength: totalFileSize,
      contentRange: null,
    };
  }

  const parts = rangeHeader.replace('bytes=', '').trim().split('-');
  let start = parseInt(parts[0], 10);
  let end = parts[1] ? parseInt(parts[1], 10) : totalFileSize - 1;

  // Suffix range: bytes=-500 (last 500 bytes)
  if (isNaN(start)) {
    start = totalFileSize - end;
    end = totalFileSize - 1;
  }

  // End exceeds file size
  if (isNaN(end) || end >= totalFileSize) {
    end = totalFileSize - 1;
  }

  // Unsatisfiable range (start beyond EOF or start > end)
  if (start > end || start >= totalFileSize || start < 0) {
    return {
      statusCode: 416,
      start: 0,
      end: 0,
      contentLength: 0,
      contentRange: `bytes */${totalFileSize}`,
    };
  }

  const contentLength = end - start + 1;
  return {
    statusCode: 206,
    start,
    end,
    contentLength,
    contentRange: `bytes ${start}-${end}/${totalFileSize}`,
  };
}

/**
 * Parses local file system path from game-media URL.
 * Handles formats:
 * - game-media://local/E:/Game/PBZ/screenshot.png
 * - game-media://local/E%3A%2FGame%2FPBZ%2Fscreenshot.png
 * - game-media:///E:/Game/PBZ/screenshot.png
 */
export function parseMediaUrlToFilePath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    let pathname = decodeURIComponent(parsed.pathname);

    // If host is 'local', pathname starts with '/E:/...' or similar
    // If no host, pathname might be '/local/E:/...' or '/E:/...'
    if (parsed.host === 'local') {
      // Remove leading slash if followed by drive letter (e.g. /E:/ -> E:/)
      if (/^\/[a-zA-Z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
    } else if (pathname.startsWith('/local/')) {
      pathname = pathname.replace(/^\/local\//, '');
      if (/^\/[a-zA-Z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
    } else if (/^\/[a-zA-Z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }

    return path.normalize(pathname);
  } catch {
    // Fallback: manual regex extraction
    let clean = rawUrl.split('?')[0].replace(/^game-media:\/\/(local\/)?/i, '');
    clean = decodeURIComponent(clean);
    if (/^\/[a-zA-Z]:/.test(clean)) {
      clean = clean.slice(1);
    }
    return path.normalize(clean);
  }
}

/**
 * Registers protocol handler for 'game-media://'.
 * Streams large videos using HTTP 206 Byte Ranges and Node createReadStream
 * without buffering entire files into memory.
 * For images with ?thumb=1, generates & serves hardware-accelerated SSD-cached thumbnails.
 */
export function registerMediaProtocolHandler(): void {
  protocol.handle('game-media', async (request: Request) => {
    try {
      const filePath = parseMediaUrlToFilePath(request.url);

      // Verify file existence safely
      if (!fs.existsSync(filePath)) {
        return new Response('File Not Found', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return new Response('Cannot serve directory as media', {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      const totalSize = stat.size;
      const mimeType = getMimeType(filePath);
      const isVideo = mimeType.startsWith('video/') || mimeType.startsWith('audio/');
      const rangeHeader = request.headers.get('range');

      // Check for thumbnail query parameter (?thumb=1 or ?thumb=true)
      try {
        const parsedUrl = new URL(request.url);
        const isThumb = parsedUrl.searchParams.has('thumb');
        if (isThumb && mimeType.startsWith('image/')) {
          const widthParam = parsedUrl.searchParams.get('w');
          const targetWidth = widthParam ? parseInt(widthParam, 10) : 480;
          const thumbPath = await getOrGenerateThumbnail(filePath, targetWidth);
          if (thumbPath && fs.existsSync(thumbPath)) {
            const thumbStat = fs.statSync(thumbPath);
            const thumbStream = fs.createReadStream(thumbPath);
            const webStream = Readable.toWeb(thumbStream);

            return new Response(webStream as unknown as BodyInit, {
              status: 200,
              statusText: 'OK',
              headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(thumbStat.size),
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          }
        }
      } catch {
        // Fall through to regular streaming
      }

      // For videos or any media requesting byte ranges, support HTTP 206
      if (rangeHeader || isVideo) {
        const range = calculateHttp206Range(rangeHeader, totalSize);

        if (range.statusCode === 416) {
          return new Response(null, {
            status: 416,
            statusText: 'Range Not Satisfiable',
            headers: {
              'Content-Range': range.contentRange || `bytes */${totalSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Type': mimeType,
            },
          });
        }

        if (range.statusCode === 206) {
          // Stream requested chunk directly from disk via createReadStream
          const nodeStream = fs.createReadStream(filePath, {
            start: range.start,
            end: range.end,
          });
          const webStream = Readable.toWeb(nodeStream);

          return new Response(webStream as unknown as BodyInit, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Range': range.contentRange!,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(range.contentLength),
              'Content-Type': mimeType,
              'Cache-Control': 'no-cache',
            },
          });
        }
      }

      // Full content response (images or video without range header)
      const fullStream = fs.createReadStream(filePath);
      const webStream = Readable.toWeb(fullStream);

      return new Response(webStream as unknown as BodyInit, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(totalSize),
          'Content-Type': mimeType,
          'Cache-Control': 'max-age=86400',
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return new Response(`Media Streaming Error: ${errorMsg}`, {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  });
}
