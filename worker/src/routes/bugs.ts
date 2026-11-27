import type { RouteHandler } from '../types.ts';
import { authenticate, isAdminUser } from '../auth.ts';
import { rateLimit } from '../community-common.ts';
import { jsonResponse, errorResponse } from '../utils.ts';

const VALID_CATEGORIES = new Set(['ui', 'tracker', 'sync', 'updater', 'other']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'fixed', 'wontfix']);
const MAX_LOG_TEXT_CHARS = 120_000;

export const handleCreateBugReport: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    await rateLimit(env, user.uid, 'bug_reports', 10, 3600);
  } catch (err: any) {
    return errorResponse(err?.message || 'Rate limit exceeded', err?.status || 429);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON payload', 400);
  }

  const title = String(body?.title || '').trim().slice(0, 160);
  const description = String(body?.description || '').trim().slice(0, 4000);
  if (title.length < 3) {
    return errorResponse('Tiêu đề lỗi phải có ít nhất 3 ký tự.', 400);
  }
  if (description.length < 5) {
    return errorResponse('Mô tả chi tiết lỗi phải có ít nhất 5 ký tự.', 400);
  }

  const rawCategory = String(body?.category || 'other').trim();
  const category = VALID_CATEGORIES.has(rawCategory) ? rawCategory : 'other';

  const rawSeverity = String(body?.severity || 'medium').trim();
  const severity = VALID_SEVERITIES.has(rawSeverity) ? rawSeverity : 'medium';

  const appVersion = String(body?.app_version || '').trim().slice(0, 64);
  const platform = String(body?.platform || '').trim().slice(0, 128);
  const gpuSummary = String(body?.gpu_summary || '').trim().slice(0, 500);
  const logText = String(body?.log_text || '').slice(-MAX_LOG_TEXT_CHARS);

  const res = await env.DB.prepare(
    `INSERT INTO bug_reports (
      uid, email, display_name, title, category, severity, description,
      app_version, platform, gpu_summary, log_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      user.uid,
      user.email || '',
      user.displayName || '',
      title,
      category,
      severity,
      description,
      appVersion,
      platform,
      gpuSummary,
      logText
    )
    .run();

  const id = Number(res.meta?.last_row_id || 0);
  const created = await env.DB.prepare(
    `SELECT id, title, category, severity, description, app_version, status,
            fixed_in_version, admin_note, created_at, updated_at
     FROM bug_reports WHERE id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, bug: created ? { ...created, is_mine: true } : { id } }, 201);
};

export const handleGetBugReports: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  const scope = ctx.url.searchParams.get('scope') === 'all' ? 'all' : 'mine';
  const limit = Math.min(50, Math.max(1, Number(ctx.url.searchParams.get('limit') || 30)));

  const rows = scope === 'all'
    ? await env.DB.prepare(
        `SELECT id, uid, title, category, severity, description, app_version, status,
                fixed_in_version, admin_note, created_at, updated_at
         FROM bug_reports
         ORDER BY id DESC
         LIMIT ?`
      )
        .bind(limit)
        .all()
    : await env.DB.prepare(
        `SELECT id, uid, title, category, severity, description, app_version, status,
                fixed_in_version, admin_note, created_at, updated_at
         FROM bug_reports
         WHERE uid = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
        .bind(user.uid, limit)
        .all();

  const bugs = (rows.results || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    severity: row.severity,
    description: row.description,
    app_version: row.app_version,
    status: row.status,
    fixed_in_version: row.fixed_in_version,
    admin_note: row.admin_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_mine: row.uid === user.uid,
  }));

  return jsonResponse({ bugs });
};

export const handleAdminGetBugReports: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) return errorResponse('Unauthorized', 401);
  if (!isAdminUser(user, env)) return errorResponse('Forbidden', 403);

  const statusFilter = ctx.url.searchParams.get('status') || '';
  const limit = Math.min(100, Math.max(1, Number(ctx.url.searchParams.get('limit') || 50)));

  const rows = VALID_STATUSES.has(statusFilter)
    ? await env.DB.prepare(
        `SELECT id, uid, email, display_name, title, category, severity, description,
                app_version, platform, gpu_summary, LENGTH(log_text) AS log_length,
                status, fixed_in_version, admin_note, created_at, updated_at
         FROM bug_reports
         WHERE status = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
        .bind(statusFilter, limit)
        .all()
    : await env.DB.prepare(
        `SELECT id, uid, email, display_name, title, category, severity, description,
                app_version, platform, gpu_summary, LENGTH(log_text) AS log_length,
                status, fixed_in_version, admin_note, created_at, updated_at
         FROM bug_reports
         ORDER BY id DESC
         LIMIT ?`
      )
        .bind(limit)
        .all();

  return jsonResponse({ bugs: rows.results || [] });
};

export const handleAdminGetBugReportDetail: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) return errorResponse('Unauthorized', 401);
  if (!isAdminUser(user, env)) return errorResponse('Forbidden', 403);

  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return errorResponse('Invalid bug id', 400);
  }

  const row = await env.DB.prepare('SELECT * FROM bug_reports WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return errorResponse('Bug report not found', 404);

  return jsonResponse({ bug: row });
};

export const handleAdminUpdateBugReport: RouteHandler = async (request, env, ctx) => {
  const user = await authenticate(request, env);
  if (!user) return errorResponse('Unauthorized', 401);
  if (!isAdminUser(user, env)) return errorResponse('Forbidden', 403);

  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return errorResponse('Invalid bug id', 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON payload', 400);
  }

  const rawStatus = String(body?.status || '').trim();
  if (!VALID_STATUSES.has(rawStatus)) {
    return errorResponse('Invalid status', 400);
  }

  const fixedInVersion = String(body?.fixed_in_version || '').trim().slice(0, 64);
  const adminNote = String(body?.admin_note || '').trim().slice(0, 1000);

  const res = await env.DB.prepare(
    `UPDATE bug_reports
     SET status = ?, fixed_in_version = ?, admin_note = ?, updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(rawStatus, fixedInVersion, adminNote, id)
    .run();

  if (!res.meta?.changes) {
    return errorResponse('Bug report not found', 404);
  }

  const updated = await env.DB.prepare(
    `SELECT id, uid, email, display_name, title, category, severity, description,
            app_version, platform, gpu_summary, LENGTH(log_text) AS log_length,
            status, fixed_in_version, admin_note, created_at, updated_at
     FROM bug_reports WHERE id = ?`
  )
    .bind(id)
    .first();

  return jsonResponse({ ok: true, bug: updated });
};
