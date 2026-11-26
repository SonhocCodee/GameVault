import type { RouteHandler, Env } from '../types.ts';
import { authenticate } from '../auth.ts';
import { errorResponse, jsonResponse } from '../utils.ts';

export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Verifies magic-byte signatures for supported image types (PNG, JPEG, WebP, GIF)
 * so non-image payloads cannot be uploaded or ingested with a spoofed Content-Type.
 */
export function hasValidImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (!bytes || bytes.length < 4) return false;
  switch (mime) {
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case 'image/jpeg':
    case 'image/jpg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
      );
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

/**
 * Saves binary image to cloud storage:
 * - Writes to Cloudflare R2 bucket if configured.
 * - Stores in D1 image_store when R2 is not bound.
 * Returns a URL only after the storage write succeeds.
 */
export async function saveImageToCloud(
  key: string,
  buffer: ArrayBuffer | Uint8Array,
  mime: string,
  env: Env,
  meta?: { uploadedBy?: string; kind?: string }
): Promise<string> {
  const binary = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (env.IMAGES_BUCKET) {
    await env.IMAGES_BUCKET.put(key, binary, {
      httpMetadata: { contentType: mime },
      customMetadata: {
        uploadedBy: meta?.uploadedBy || 'system',
        uploadedAt: new Date().toISOString(),
        kind: meta?.kind || 'general',
      },
    });
  } else if (env.DB) {
    // Only store in D1 image_store fallback when IMAGES_BUCKET is not bound
    const result = await env.DB.prepare(
      "INSERT OR REPLACE INTO image_store (key, mime_type, data, uploaded_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(key, mime, binary).run();
    if (!result.success) {
      throw new Error(result.error || 'Failed to save image to cloud storage');
    }
  } else {
    throw new Error('Cloud storage is not enabled on this worker');
  }

  return `/api/images/${key}`;
}

/**
 * Retrieves an image from R2, or falls back to D1 image_store.
 */
export async function getImageFromCloud(
  key: string,
  env: Env
): Promise<{ body: any; mime: string; size?: number; etag?: string } | null> {
  if (env.IMAGES_BUCKET) {
    const object = await env.IMAGES_BUCKET.get(key);
    if (object) {
      return {
        body: object.body,
        mime: object.httpMetadata?.contentType || 'image/jpeg',
        size: object.size,
        etag: object.httpEtag,
      };
    }
    return null;
  }

  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT mime_type, data FROM image_store WHERE key = ?').bind(key).first<any>();
      if (row && row.data) {
        const data = row.data instanceof Uint8Array ? row.data : Buffer.from(row.data);
        return {
          body: data,
          mime: row.mime_type || 'image/jpeg',
          size: data.byteLength || data.length,
        };
      }
    } catch {}
  }

  return null;
}

export const handleImageUpload: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const rawContentType = request.headers.get('Content-Type') || request.headers.get('content-type');
  const mime = rawContentType ? rawContentType.split(';')[0].trim().toLowerCase() : '';

  if (!mime || !ALLOWED_CONTENT_TYPES[mime]) {
    return errorResponse(
      'Unsupported image type. Allowed: image/png, image/jpeg, image/webp, image/gif',
      415
    );
  }

  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_IMAGE_SIZE_BYTES) {
    return errorResponse('Payload too large (>10MB)', 413);
  }

  const arrayBuffer = await request.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return errorResponse('Image body cannot be empty', 400);
  }

  if (arrayBuffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
    return errorResponse('Image exceeds maximum size of 10MB', 413);
  }

  if (!env.IMAGES_BUCKET && !env.DB) {
    return errorResponse('Cloud storage is not enabled on this worker', 503);
  }

  const ext = ALLOWED_CONTENT_TYPES[mime];
  const key = `${crypto.randomUUID()}.${ext}`;
  const kind = request.headers.get('X-Image-Kind') || 'general';

  const url = await saveImageToCloud(key, arrayBuffer, mime, env, {
    uploadedBy: user.uid,
    kind,
  });

  return jsonResponse(
    {
      key,
      url,
    },
    201
  );
};

export const handleImageGet: RouteHandler = async (_request, env, ctx) => {
  const key = ctx.params?.key;
  if (!key || key.includes('/') || key.includes('\\') || key.includes('..')) {
    return errorResponse('Invalid image key', 400);
  }

  const image = await getImageFromCloud(key, env);
  if (!image) {
    if (!env.IMAGES_BUCKET && !env.DB) {
      return errorResponse('Cloud storage is not enabled on this worker', 503);
    }
    return errorResponse('Image not found', 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', image.mime || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (image.etag) {
    headers.set('ETag', image.etag);
  }
  if (image.size) {
    headers.set('Content-Length', String(image.size));
  }

  return new Response(image.body as any, {
    status: 200,
    headers,
  });
};
