import type { RouteHandler } from '../types.ts';
import { authenticate } from '../auth.ts';
import { errorResponse, jsonResponse } from '../utils.ts';

export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

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

  if (!env.IMAGES_BUCKET) {
    return errorResponse('Cloudflare R2 storage is not enabled on this worker', 503);
  }

  const ext = ALLOWED_CONTENT_TYPES[mime];
  const key = `${crypto.randomUUID()}.${ext}`;
  const kind = request.headers.get('X-Image-Kind') || 'general';

  await env.IMAGES_BUCKET.put(key, arrayBuffer, {
    httpMetadata: { contentType: mime },
    customMetadata: {
      uploadedBy: user.uid,
      uploadedAt: new Date().toISOString(),
      kind,
    },
  });

  return jsonResponse(
    {
      key,
      url: `/api/images/${key}`,
    },
    201
  );
};

export const handleImageGet: RouteHandler = async (_request, env, ctx) => {
  const key = ctx.params?.key;
  if (!key || key.includes('/') || key.includes('\\') || key.includes('..')) {
    return errorResponse('Invalid image key', 400);
  }

  if (!env.IMAGES_BUCKET) {
    return errorResponse('Cloudflare R2 storage is not enabled on this worker', 503);
  }

  const object = await env.IMAGES_BUCKET.get(key);
  if (!object) {
    return errorResponse('Image not found', 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (object.httpEtag) {
    headers.set('ETag', object.httpEtag);
  }
  if (object.size) {
    headers.set('Content-Length', String(object.size));
  }

  return new Response(object.body as any, {
    status: 200,
    headers,
  });
};
