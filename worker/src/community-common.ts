import { authenticate, isAdminUser } from "./auth.ts";
import type { AuthUser, Env } from "./types.ts";
import { errorResponse } from "./utils.ts";
import {
  canonicalNonSteamGameKeySql,
  canonicalNonSteamGameTitleSql,
} from "../../src/shared/game-identity.ts";
export class CommunityError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function communityFailure(error: unknown): Response {
  if (error instanceof CommunityError)
    return errorResponse(error.message, error.status);
  console.error("[community]", error);
  return errorResponse(
    "Community is temporarily unavailable. Please retry.",
    503,
  );
}
export function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new CommunityError("Text is required");
    return "";
  }
  const v = value.trim();
  if (v.length > max || (required && !v))
    throw new CommunityError(`Text must contain 1-${max} characters`);
  return v;
}
export function key(value: unknown): string {
  const v = text(value, 100, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(v)) throw new CommunityError("Invalid game key");
  return v;
}
export function number(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new CommunityError(`Number must be between ${min} and ${max}`);
  return value;
}
export function safeName(value: unknown): string {
  const n = typeof value === "string" ? value.trim().slice(0, 60) : "";
  return !n || n.includes("@") ? "Player" : n;
}
export function publicUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  if (/^\/api\/images\/[a-zA-Z0-9._-]+$/.test(value)) return value;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}
export async function boundedBody(
  request: Request,
  max = 16384,
): Promise<Uint8Array> {
  const size = request.headers.get("Content-Length");
  if (size && Number(size) > max)
    throw new CommunityError("Payload too large", 413);
  if (!request.body) throw new CommunityError("Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      length += r.value.length;
      if (length > max) {
        await reader.cancel();
        throw new CommunityError("Payload too large", 413);
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
export async function jsonBody(request: Request): Promise<any> {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", {
        fatal: true,
      }).decode(await boundedBody(request)),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new CommunityError("JSON object is required");
    return value;
  } catch (e) {
    if (e instanceof CommunityError) throw e;
    throw new CommunityError("Invalid JSON body");
  }
}
export function paging(url: URL) {
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit")) || 20),
  );
  const offset = Math.max(
    0,
    Math.min(10000, Number(url.searchParams.get("offset")) || 0),
  );
  return {
    limit: Math.floor(limit),
    offset: Math.floor(offset),
  };
}
export function page<T>(items: T[], limit: number, offset: number) {
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit,
    nextOffset: offset + Math.min(items.length, limit),
  };
}
export async function requireUser(
  request: Request,
  env: Env,
  allowSuspended = false,
): Promise<AuthUser> {
  const user = await authenticate(request, env);
  if (!user) throw new CommunityError("Sign in to continue", 401);
  const profile = await env.DB.prepare(
    "SELECT suspended FROM community_profiles WHERE uid=?",
  )
    .bind(user.uid)
    .first<any>();
  if (profile?.suspended && !allowSuspended)
    throw new CommunityError("This account is restricted", 403);
  return user;
}
export async function requireAdmin(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (!isAdminUser(user, env))
    throw new CommunityError("Administrator access required", 403);
  return user;
}
export async function ensureProfile(env: Env, user: AuthUser): Promise<boolean> {
  const existing = await env.DB.prepare(
    "SELECT share_library, suspended FROM community_profiles WHERE uid=?",
  )
    .bind(user.uid)
    .first<{ share_library: number; suspended: number }>();
  if (existing && (existing.share_library === 1 || existing.suspended === 1)) {
    return false;
  }
  const result = await env.DB.prepare(
    "INSERT INTO community_profiles(uid,nickname,share_library) VALUES (?,?,1) ON CONFLICT(uid) DO UPDATE SET share_library=1 WHERE share_library=0 AND suspended=0",
  )
    .bind(user.uid, safeName(user.displayName))
    .run();
  if (result.meta?.changes) {
    await refreshSharedLibrary(env, user.uid);
    return true;
  }
  return false;
}

export function communityAvatar(request: Request, value: unknown): string | null {
  if (typeof value === "string" && /^\/community\/profile-presets\/avatars\/[a-z-]+\.svg$/.test(value))
    return new URL(value, request.url).href;
  return publicUrl(value);
}
export async function rateLimit(
  env: Env,
  actor: string,
  action: string,
  max: number,
  seconds = 60,
) {
  const window = Math.floor(Date.now() / (seconds * 1000)) * seconds;
  const row = await env.DB.prepare(
    `INSERT INTO community_rate_limits(actor,action,window,count) VALUES (?,?,?,1)
    ON CONFLICT(actor,action,window) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`,
  )
    .bind(actor, action, window, max)
    .first<any>();
  if (!row)
    throw new CommunityError("Too many requests. Please wait and retry.", 429);
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM community_rate_limits WHERE window<?")
      .bind(Math.floor(Date.now() / 1000) - 172800)
      .run();
  }
}
export async function refreshSharedLibrary(env: Env, uid: string) {
  const sharedGameKey = `CASE WHEN l.steam_id>0 THEN CAST(l.steam_id AS TEXT)
    ELSE ${canonicalNonSteamGameKeySql("l.game_key")} END`;
  const sharedGameTitle = canonicalNonSteamGameTitleSql(sharedGameKey, "l.title");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM community_library WHERE uid=? AND NOT EXISTS (
      SELECT 1 FROM user_library l JOIN community_profiles p ON p.uid=l.uid
      WHERE l.uid=community_library.uid AND l.is_deleted=0 AND p.share_library=1 AND p.suspended=0
        AND ${sharedGameKey}=community_library.game_key
    )`).bind(uid),
    env.DB.prepare(
      `INSERT INTO community_library(uid,game_key,title,steam_id,cover_url,status,playtime_minutes,recorded_playtime_minutes)
      SELECT l.uid,${sharedGameKey},
        MAX(${sharedGameTitle}),MAX(CASE WHEN l.steam_id>0 THEN l.steam_id ELSE NULL END),MAX(l.cover_url),
        CASE WHEN MAX(CASE WHEN l.status='completed' THEN 1 ELSE 0 END)=1 THEN 'completed' ELSE MAX(l.status) END,
        MAX(l.playtime_minutes),MAX(l.recorded_playtime_minutes) FROM user_library l
      JOIN community_profiles p ON p.uid=l.uid WHERE l.uid=? AND l.is_deleted=0 AND p.share_library=1 AND p.suspended=0
      GROUP BY l.uid,${sharedGameKey}
      ON CONFLICT(uid,game_key) DO UPDATE SET
        title=excluded.title,steam_id=excluded.steam_id,cover_url=excluded.cover_url,
        status=excluded.status,playtime_minutes=excluded.playtime_minutes,
        recorded_playtime_minutes=excluded.recorded_playtime_minutes
      WHERE community_library.title IS NOT excluded.title
        OR community_library.steam_id IS NOT excluded.steam_id
        OR community_library.cover_url IS NOT excluded.cover_url
        OR community_library.status IS NOT excluded.status
        OR community_library.playtime_minutes IS NOT excluded.playtime_minutes
        OR community_library.recorded_playtime_minutes IS NOT excluded.recorded_playtime_minutes`,
    ).bind(uid),
  ]);
}
export const visibleTo = (
  alias: string,
) => `NOT EXISTS(SELECT 1 FROM community_blocks b WHERE
 (b.uid=? AND b.blocked_uid=${alias}.uid) OR (b.blocked_uid=? AND b.uid=${alias}.uid))`;
