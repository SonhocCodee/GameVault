import type { Router } from "../router.ts";
import type { Env, RouteHandler } from "../types.ts";
import { authenticate } from "../auth.ts";
import { jsonResponse } from "../utils.ts";
import {
  boundedBody,
  communityFailure,
  CommunityError,
  ensureProfile,
  jsonBody,
  key,
  number,
  page,
  paging,
  publicUrl,
  rateLimit,
  requireUser,
  safeName,
  text,
  visibleTo,
} from "../community-common.ts";
import type {
  PerformanceReport,
  SteamRequirements,
  PublicGame,
} from "../../../src/shared/community.ts";
let steamFetch: typeof fetch | undefined;
export function configureSteamDiscovery(fetcher?: typeof fetch) {
  steamFetch = fetcher;
}
export function stripSteamHtml(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return (
    value
      .slice(0, 20000)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?\s*>|<\/li>|<\/p>|<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
        const c =
          n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
        return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "";
      })
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim()
      .slice(0, 8000) || null
  );
}
async function cached<T>(
  env: Env,
  cacheKey: string,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "SELECT value FROM community_steam_cache WHERE key=? AND expires_at>?",
  )
    .bind(cacheKey, now)
    .first<any>();
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch {}
  }
  const data = await loader();
  await env.DB.prepare(
    "INSERT INTO community_steam_cache(key,value,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at",
  )
    .bind(cacheKey, JSON.stringify(data), now + 21600)
    .run();
  await env.DB.prepare("DELETE FROM community_steam_cache WHERE expires_at<?")
    .bind(now - 86400)
    .run();
  return data;
}
async function steamJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await (steamFetch || fetch)(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok)
      throw new CommunityError("Steam is unavailable. Please retry.", 502);
    const data = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(await boundedBody(response as unknown as Request, 1500000));
    return JSON.parse(data);
  } catch (e) {
    if (e instanceof CommunityError) throw e;
    throw new CommunityError("Cannot load Steam data. Please retry.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
async function discoveryRate(request: Request, env: Env) {
  const auth = await authenticate(request, env);
  const actor =
    auth?.uid ||
    `visitor_${Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            request.headers.get("CF-Connecting-IP") || "unknown",
          ),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
  await rateLimit(env, actor, "discovery", 60);
}
export function validatePerformanceReport(input: any): PerformanceReport {
  if (input.completionStatus !== "completed")
    throw new CommunityError(
      "Only completed games can have a completion report",
    );
  const graphics = input.graphics || {};
  const width = number(graphics.width, 320, 16384, true),
    height = number(graphics.height, 200, 16384, true);
  if (!["presentmon", "manual"].includes(input.source))
    throw new CommunityError("Choose the measurement source");
  const measuredAt = text(input.measuredAt, 50, true);
  if (
    !Number.isFinite(Date.parse(measuredAt)) ||
    Date.parse(measuredAt) > Date.now() + 300000
  )
    throw new CommunityError("Invalid measurement date");
  const samples = number(input.samples ?? 0, 0, 10000000000, true);
  if (input.source === "presentmon" && samples < 10)
    throw new CommunityError(
      "PresentMon reports need at least ten measured frames",
    );
  if (!["manual", "config"].includes(graphics.source))
    throw new CommunityError("Confirm the graphics context");
  return {
    gameKey: key(input.gameKey),
    title: text(input.title, 160, true),
    steamId: input.steamId ? number(input.steamId, 1, 2147483647, true) : null,
    coverUrl: publicUrl(input.coverUrl),
    completionStatus: "completed",
    cpu: text(input.cpu, 160, true),
    gpu: text(input.gpu, 160, true),
    ramGb: number(input.ramGb, 0.1, 4096),
    fpsAverage: number(input.fpsAverage, 0.1, 2000),
    fpsLow: input.fpsLow == null ? null : number(input.fpsLow, 0.1, 2000),
    samples,
    graphics: {
      width,
      height,
      preset: text(graphics.preset, 60, true),
      upscaling: text(graphics.upscaling, 80),
      frameGeneration: text(graphics.frameGeneration, 80),
      rayTracing: text(graphics.rayTracing, 80),
      source: graphics.source,
    },
    source: input.source,
    measuredAt,
    notes: text(input.notes, 800),
  };
}
export function registerDiscoveryRoutes(router: Router) {
  const add = (method: string, path: string, handler: RouteHandler) =>
    router.add(method as any, `/api/community${path}`, async (r, e, c) => {
      try {
        return await handler(r, e, c);
      } catch (error) {
        return communityFailure(error);
      }
    });
  add("GET", "/search", async (request, env, ctx) => {
    const q = text(ctx.url.searchParams.get("q"), 80, true);
    if (q.length < 2)
      return jsonResponse({
        items: [],
        upstreamAvailable: true,
      });
    await discoveryRate(request, env);
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const rows =
      (
        await env.DB.prepare(
          `SELECT game_key,title,steam_id,cover_url FROM game_covers WHERE title LIKE ? ESCAPE '\\' ORDER BY title LIMIT 20`,
        )
          .bind(`%${escaped}%`)
          .all<any>()
      ).results || [];
    const local: PublicGame[] = rows.map((r) => ({
      gameKey: r.game_key,
      title: r.title,
      steamId: r.steam_id && r.steam_id > 0 ? r.steam_id : null,
      coverUrl: publicUrl(r.cover_url),
    }));
    try {
      const hits = await cached<any[]>(
        env,
        `search:${q.toLowerCase()}`,
        async () => {
          const result = await steamJson(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=us`,
          );
          return Array.isArray(result.items)
            ? result.items
                .filter(
                  (r: any) =>
                    r.type === "app" && Number.isInteger(r.id) && r.id > 0,
                )
                .slice(0, 20)
            : [];
        },
      );
      const map = new Map(local.map((g) => [g.gameKey, g]));
      for (const h of hits) {
        const id = String(h.id);
        if (!map.has(id))
          map.set(id, {
            gameKey: id,
            title: String(h.name).slice(0, 160),
            steamId: h.id,
            coverUrl: publicUrl(h.tiny_image),
          });
      }
      return jsonResponse({
        items: Array.from(map.values()).slice(0, 30),
        upstreamAvailable: true,
      });
    } catch (error) {
      if (local.length)
        return jsonResponse({
          items: local,
          upstreamAvailable: false,
        });
      throw error;
    }
  });
  add("GET", "/games/:gameKey/requirements", async (request, env, ctx) => {
    const gameKey = key(ctx.params?.gameKey);
    await discoveryRate(request, env);
    if (!/^\d+$/.test(gameKey)) {
      const row = await env.DB.prepare(
        "SELECT title,steam_id,cover_url FROM game_covers WHERE game_key=?",
      )
        .bind(gameKey)
        .first<any>();
      const empty: SteamRequirements = {
        gameKey,
        title: row?.title || gameKey,
        minimum: null,
        recommended: null,
        sourceUrl: null,
        fetchedAt: new Date().toISOString(),
        available: false,
      };
      return jsonResponse(empty);
    }
    const id = number(Number(gameKey), 1, 2147483647, true);
    const details = await cached<SteamRequirements>(
      env,
      `details-v2:${id}`,
      async () => {
        const result = await steamJson(
            `https://store.steampowered.com/api/appdetails?appids=${id}&l=english&cc=us`,
          ),
          game = result?.[String(id)];
        if (!game?.success || !game.data)
          throw new CommunityError("Steam game not found", 404);
        const d = game.data;
        return {
          gameKey: String(id),
          title: text(d.name, 160, true),
          steamId: id,
          coverUrl: publicUrl(d.header_image),
          description: stripSteamHtml(d.short_description),
          genres: Array.isArray(d.genres) ? d.genres.slice(0, 12).map((g: any) => text(g.description, 100)) : [],
          developers: Array.isArray(d.developers) ? d.developers.slice(0, 8).map((s: any) => text(s, 160)) : [],
          releaseDate: typeof d.release_date?.date === "string" ? text(d.release_date.date, 80) : null,
          minimum: stripSteamHtml(d.pc_requirements?.minimum),
          recommended: stripSteamHtml(d.pc_requirements?.recommended),
          sourceUrl: `https://store.steampowered.com/app/${id}/`,
          fetchedAt: new Date().toISOString(),
          available: true,
        };
      },
    );
    return jsonResponse(details);
  });
  add("GET", "/games/:gameKey/players", async (request, env, ctx) => {
    const gameKey = key(ctx.params?.gameKey);
    const uid = (await authenticate(request, env))?.uid || "";
    const { limit, offset } = paging(ctx.url);
    const status = ctx.url.searchParams.get("status") || "";
    if (status && status !== "completed") throw new CommunityError("Invalid player status");
    // A report is an independent opt-in. Never read a non-consenting private library.
    const rows = (await env.DB.prepare(`
      WITH participants AS (
        SELECT l.uid,l.status,l.playtime_minutes FROM community_library l
        JOIN community_profiles p ON p.uid=l.uid
        WHERE l.game_key=? AND p.share_library=1 AND p.suspended=0
          AND (l.playtime_minutes>0 OR l.status IN ('completed','playing'))
        UNION ALL
        SELECT f.uid,'completed',NULL FROM community_performance f
        JOIN community_profiles p ON p.uid=f.uid
        WHERE f.game_key=? AND f.hidden=0 AND p.suspended=0
        AND NOT EXISTS(SELECT 1 FROM community_library l WHERE l.uid=f.uid AND l.game_key=f.game_key AND p.share_library=1 AND (l.playtime_minutes>0 OR l.status IN ('completed','playing')))
      )
      SELECT x.uid,p.nickname,x.status,x.playtime_minutes,f.data_json,f.id AS report_id
      FROM participants x JOIN community_profiles p ON p.uid=x.uid
      LEFT JOIN community_performance f ON f.uid=x.uid AND f.game_key=? AND f.hidden=0
      WHERE ${visibleTo("x")} ${status ? "AND x.status='completed'" : ""}
      ORDER BY x.playtime_minutes DESC,x.uid ASC LIMIT ? OFFSET ?
    `).bind(gameKey, gameKey, gameKey, uid, uid, limit + 1, offset).all<any>()).results || [];
    return jsonResponse(page(rows.map(r => ({
      uid: r.uid, nickname: safeName(r.nickname), status: r.status,
      playtimeMinutes: r.playtime_minutes == null ? null : Number(r.playtime_minutes),
      performance: r.data_json ? { ...JSON.parse(r.data_json), id: r.report_id, uid: r.uid, nickname: safeName(r.nickname) } : null,
    })), limit, offset));
  });
  add("GET", "/games/:gameKey/performance", async (request, env, ctx) => {
    const gameKey = key(ctx.params?.gameKey),
      uid = (await authenticate(request, env))?.uid || "",
      { limit, offset } = paging(ctx.url);
    const filters = [
      "f.game_key=?",
      "f.hidden=0",
      "COALESCE(p.suspended,0)=0",
      visibleTo("f"),
    ];
    const args: any[] = [gameKey, uid, uid];
    const gpu = ctx.url.searchParams.get("gpu");
    if (gpu) {
      filters.push(
        "LOWER(json_extract(f.data_json,'$.gpu')) LIKE ? ESCAPE '\\'",
      );
      args.push(
        `%${text(gpu, 100)
          .toLowerCase()
          .replace(/[\\%_]/g, "\\$&")}%`,
      );
    }
    for (const [param, field] of [
      ["width", "width"],
      ["height", "height"],
    ]) {
      const value = ctx.url.searchParams.get(param);
      if (value) {
        filters.push(`json_extract(f.data_json,'$.graphics.${field}')=?`);
        args.push(number(Number(value), 200, 16384, true));
      }
    }
    const preset = ctx.url.searchParams.get("preset");
    if (preset) {
      filters.push("LOWER(json_extract(f.data_json,'$.graphics.preset'))=?");
      args.push(text(preset, 60).toLowerCase());
    }
    const rows =
      (
        await env.DB.prepare(
          `SELECT f.id,f.uid,f.data_json,p.nickname FROM community_performance f LEFT JOIN community_profiles p ON p.uid=f.uid
      WHERE ${filters.join(" AND ")} ORDER BY f.updated_at DESC,f.id DESC LIMIT ? OFFSET ?`,
        )
          .bind(...args, limit + 1, offset)
          .all<any>()
      ).results || [];
    return jsonResponse(
      page(
        rows.map((r) => ({
          ...JSON.parse(r.data_json),
          id: r.id,
          uid: r.uid,
          nickname: safeName(r.nickname),
        })),
        limit,
        offset,
      ),
    );
  });
  add("POST", "/games/:gameKey/performance", async (request, env, ctx) => {
    const user = await requireUser(request, env);
    await rateLimit(env, user.uid, "performance", 5, 300);
    await ensureProfile(env, user);
    const input = await jsonBody(request),
      gameKey = key(ctx.params?.gameKey);
    if (input.gameKey !== gameKey)
      throw new CommunityError("Game key does not match");
    const report = validatePerformanceReport(input);
    // Completion is explicitly user-reported; the client measurement is not a verified benchmark.
    await env.DB.prepare(
      `INSERT INTO community_performance(id,uid,game_key,game_title,data_json) VALUES (?,?,?,?,?)
      ON CONFLICT(uid,game_key) DO UPDATE SET game_title=excluded.game_title,data_json=excluded.data_json,updated_at=datetime('now')`,
    )
      .bind(
        crypto.randomUUID(),
        user.uid,
        gameKey,
        report.title,
        JSON.stringify(report),
      )
      .run();
    return jsonResponse({
      success: true,
    });
  });
  add("DELETE", "/games/:gameKey/performance", async (request, env, ctx) => {
    const user = await requireUser(request, env, true);
    await env.DB.prepare(
      "DELETE FROM community_performance WHERE uid=? AND game_key=?",
    )
      .bind(user.uid, key(ctx.params?.gameKey))
      .run();
    return jsonResponse({
      success: true,
    });
  });
}
