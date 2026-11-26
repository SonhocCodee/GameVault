import type { RouteHandler, UserProfile, HardwareProfile } from '../types.ts';
import { authenticate } from '../auth.ts';
import { jsonResponse, errorResponse } from '../utils.ts';
import { safeName } from '../community-common.ts';

export const handleGetUser: RouteHandler = async (request, env, ctx) => {
  const requestingUser = await authenticate(request, env);
  const uid = ctx.params?.uid;
  if (!uid) {
    return errorResponse('Missing uid in path', 400);
  }

  const row = await env.DB.prepare(
    `SELECT uid, email, display_name AS displayName, photo_url AS photoUrl,
            gpu, cpu, ram_gb AS ramGb, created_at AS createdAt, updated_at AS updatedAt
     FROM users
     WHERE uid = ?`
  )
    .bind(uid)
    .first<any>();

  if (!row) {
    return errorResponse('User not found', 404);
  }

  const profile: UserProfile = {
    uid: row.uid,
    email: requestingUser?.uid === uid ? row.email || '' : '',
    displayName: safeName(row.displayName),
    photoUrl: row.photoUrl || '',
    gpu: row.gpu || '',
    cpu: row.cpu || '',
    ramGb: row.ramGb != null ? Number(row.ramGb) : 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return jsonResponse(profile);
};

export const handleUpdateHardware: RouteHandler = async (request, env) => {
  const user = await authenticate(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const gpu = typeof body?.gpu === 'string' ? body.gpu.trim() : '';
  const cpu = typeof body?.cpu === 'string' ? body.cpu.trim() : '';
  const ramGb = Number(body?.ramGb) || 0;

  await env.DB.prepare(
    `INSERT INTO users (uid, email, display_name, gpu, cpu, ram_gb, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(uid) DO UPDATE SET
       gpu = excluded.gpu,
       cpu = excluded.cpu,
       ram_gb = excluded.ram_gb,
       updated_at = datetime('now')`
  )
    .bind(user.uid, user.email, user.displayName || user.email, gpu, cpu, ramGb)
    .run();

  const hardware: HardwareProfile = {
    gpu,
    cpu,
    ramGb,
  };

  return jsonResponse(hardware);
};
