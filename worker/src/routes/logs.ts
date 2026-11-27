import type { RouteHandler } from '../types.ts';
import { authenticate, isAdminUser } from '../auth.ts';
import { rateLimit } from '../community-common.ts';
import { jsonResponse, errorResponse } from '../utils.ts';

const MAX_LOG_TEXT_CHARS = 150_000;

export const handleSubmitClientLog: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    await rateLimit(env, user.uid, 'client_logs', 10, 3600);
  } catch (err: any) {
    return errorResponse(err?.message || 'Rate limit exceeded', err?.status || 429);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON payload', 400);
  }

  const logText = String(body?.log_text || '').slice(-MAX_LOG_TEXT_CHARS);
  if (!logText.trim()) {
    return errorResponse('log_text is required', 400);
  }

  const appVersion = String(body?.app_version || '').slice(0, 64);
  const platform = String(body?.platform || '').slice(0, 128);
  const gpuSummary = String(body?.gpu_summary || '').slice(0, 500);
  const note = String(body?.note || '').slice(0, 500);

  const res = await env.DB.prepare(
    `INSERT INTO client_logs (uid, email, app_version, platform, gpu_summary, note, log_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(user.uid, user.email || '', appVersion, platform, gpuSummary, note, logText)
    .run();

  return jsonResponse({ ok: true, id: Number(res.meta?.last_row_id || 0) }, 201);
};

export const handleAdminGetClientLogs: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) return errorResponse('Unauthorized', 401);
  if (!isAdminUser(user, env)) return errorResponse('Forbidden', 403);

  const idParam = ctx.url.searchParams.get('id');
  if (idParam) {
    const row = await env.DB.prepare('SELECT * FROM client_logs WHERE id = ?')
      .bind(Number(idParam))
      .first();
    if (!row) return errorResponse('Log not found', 404);
    return jsonResponse(row);
  }

  const limit = Math.min(50, Math.max(1, Number(ctx.url.searchParams.get('limit') || 20)));
  const rows = await env.DB.prepare(
    `SELECT id, uid, email, app_version, platform, gpu_summary, note,
            LENGTH(log_text) AS log_length, created_at
     FROM client_logs
     ORDER BY id DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  return jsonResponse({ logs: rows.results || [] });
};
