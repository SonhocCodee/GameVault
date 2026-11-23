import electronModule from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// In Electron runtime, electronModule has app, nativeImage. In test mode, fallback safely.
const electron = (typeof electronModule === 'object' && electronModule !== null ? electronModule : {}) as any;
const app = electron.app || {
  getPath: (_name: string) => path.join(os.tmpdir(), 'gamevault_test_userdata'),
};
const nativeImage = electron.nativeImage;

/**
 * Returns and ensures the thumbnails cache directory on SSD (userData).
 */
export function getThumbnailsCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'thumbnails');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Computes deterministic cache key for a given file and target dimension.
 */
export function getThumbnailCacheKey(filePath: string, mtimeMs: number, size: number, width: number): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${filePath}:${mtimeMs}:${size}:${width}`)
    .digest('hex')
    .slice(0, 24);
  return `thumb_${hash}.jpg`;
}

/**
 * Simple concurrency queue for HDD reading and image thumbnail generation.
 * Limits simultaneous heavy disk reads to maxConcurrent (default 4) to prevent HDD thrashing.
 */
class TaskQueue {
  private running: number = 0;
  private queue: (() => Promise<void>)[] = [];
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          this.next();
        }
      };

      if (this.running < this.maxConcurrent) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private next(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const nextTask = this.queue.shift();
      if (nextTask) nextTask();
    }
  }
}

const thumbnailQueue = new TaskQueue(4);

/**
 * Generates an in-memory JPEG thumbnail buffer from an image path using Electron's nativeImage.
 */
export async function generateThumbnailBuffer(
  filePath: string,
  width: number = 480,
  height: number = 270
): Promise<Buffer | null> {
  if (!nativeImage) {
    return null;
  }

  // Tier 1: Try nativeImage.createThumbnailFromPath (uses fast OS native shell thumbnailer)
  try {
    if (typeof nativeImage.createThumbnailFromPath === 'function') {
      const thumb = await nativeImage.createThumbnailFromPath(filePath, { width, height });
      if (thumb && !thumb.isEmpty()) {
        return thumb.toJPEG(80);
      }
    }
  } catch {
    // Fall through to Tier 2
  }

  // Tier 2: Try nativeImage.createFromPath + resize
  try {
    if (typeof nativeImage.createFromPath === 'function') {
      const img = nativeImage.createFromPath(filePath);
      if (img && !img.isEmpty()) {
        const size = img.getSize();
        const targetHeight = Math.round((width / (size.width || 1)) * (size.height || 1)) || height;
        const resized = img.resize({ width, height: targetHeight, quality: 'good' });
        return resized.toJPEG(80);
      }
    }
  } catch {
    // Failed
  }

  return null;
}

/**
 * Gets or generates a cached JPEG thumbnail on the fast primary SSD (userData/thumbnails).
 * Returns the absolute path of the cached thumbnail file, or null if generation was not possible.
 */
export async function getOrGenerateThumbnail(
  filePath: string,
  width: number = 480,
  height: number = 270
): Promise<string | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const cacheDir = getThumbnailsCacheDir();
  const cacheFileName = getThumbnailCacheKey(filePath, stat.mtimeMs, stat.size, width);
  const cacheFilePath = path.join(cacheDir, cacheFileName);

  // Fast path: cached file already exists on SSD!
  if (fs.existsSync(cacheFilePath)) {
    return cacheFilePath;
  }

  // Enqueue thumbnail generation through the bounded concurrency worker pool
  return thumbnailQueue.enqueue(async () => {
    // Check again in case a parallel request just created it
    if (fs.existsSync(cacheFilePath)) {
      return cacheFilePath;
    }

    const buffer = await generateThumbnailBuffer(filePath, width, height);
    if (!buffer || buffer.length === 0) {
      return null;
    }

    try {
      fs.writeFileSync(cacheFilePath, buffer);
      return cacheFilePath;
    } catch (err) {
      console.warn(`[thumbnails] Failed to write cache for ${filePath}:`, err);
      return null;
    }
  });
}

/**
 * Optimizes an image for use as a Game Poster (2:3) or Hero Banner (16:9).
 * Resizes, compresses to high-quality JPEG, and saves into userData/covers on SSD.
 * Synchronous execution to preserve compatibility with existing sync APIs.
 * Returns the destination SSD file path.
 */
export function optimizeAndSaveCover(
  sourcePath: string,
  gameId: number,
  type: 'poster' | 'banner',
  targetDir: string
): string {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Screenshot file not found: ${sourcePath}`);
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const fileName = `cover_${gameId}_${type}_${Date.now()}.jpg`;
  const destPath = path.join(targetDir, fileName);

  if (nativeImage && typeof nativeImage.createFromPath === 'function') {
    try {
      const img = nativeImage.createFromPath(sourcePath);
      if (!img.isEmpty()) {
        const origSize = img.getSize();
        let targetWidth: number;
        let targetHeight: number;

        if (type === 'poster') {
          // Poster 2:3 vertical aspect ratio, max width 600px
          targetWidth = Math.min(origSize.width, 600);
          targetHeight = Math.round(targetWidth * 1.5);
        } else {
          // Banner 16:9 horizontal hero, max width 1920px
          targetWidth = Math.min(origSize.width, 1920);
          targetHeight = Math.round(targetWidth * (9 / 16));
        }

        const resized = img.resize({ width: targetWidth, height: targetHeight, quality: 'better' });
        const jpegBuffer = resized.toJPEG(85);
        fs.writeFileSync(destPath, jpegBuffer);
        return destPath;
      }
    } catch (err) {
      console.warn(`[covers] nativeImage optimization failed, falling back to copy:`, err);
    }
  }

  // Fallback: copy file to targetDir on SSD
  const ext = path.extname(sourcePath) || '.jpg';
  const fallbackPath = path.join(targetDir, `cover_${gameId}_${type}_${Date.now()}${ext}`);
  fs.copyFileSync(sourcePath, fallbackPath);
  return fallbackPath;
}
