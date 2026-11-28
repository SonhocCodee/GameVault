import { getDb, getGameById } from "./db.ts";
import { getHardwareInfo } from "./hardware.ts";
import {
  collectSharedConfigFiles,
  detectGameConfigs,
  getGameExecutableVersion,
} from "./game-settings.ts";
import type {
  GraphicsContext,
  PerformancePreview,
  PerformanceReport,
  SharedConfigFile,
} from "../shared/community.ts";
import type { HardwareInfo } from "../shared/types.ts";
export const EMPTY_GRAPHICS: GraphicsContext = {
  width: null,
  height: null,
  preset: "",
  upscaling: "",
  frameGeneration: "",
  rayTracing: "",
  source: "unknown",
};
export function ensurePerformanceSchema() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS performance_session_context (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,game_id INTEGER NOT NULL,hardware_json TEXT NOT NULL,graphics_json TEXT NOT NULL,captured_at TEXT NOT NULL
  );`);
}
export function validateGraphicsContext(
  input: Partial<GraphicsContext>,
): GraphicsContext {
  const width = input.width ?? null,
    height = input.height ?? null;
  for (const [value, min] of [
    [width, 320],
    [height, 200],
  ] as const)
    if (
      value !== null &&
      (!Number.isInteger(value) || value < min || value > 16384)
    )
      throw new Error("Invalid game resolution");
  const bounded = (v: unknown) => {
    if (v == null) return "";
    if (typeof v !== "string" || v.length > 80)
      throw new Error("Invalid graphics setting");
    return v.trim();
  };
  const details: Record<string, string> = {};
  if (input.details && typeof input.details === "object" && !Array.isArray(input.details)) {
    for (const [k, v] of Object.entries(input.details).slice(0, 80)) {
      if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
        details[k.trim().slice(0, 50)] = v.trim().slice(0, 80);
      }
    }
  }
  const configFiles: SharedConfigFile[] = [];
  if (Array.isArray(input.configFiles)) {
    for (const f of input.configFiles.slice(0, 2)) {
      if (
        f &&
        typeof f.fileName === "string" &&
        typeof f.folderHint === "string" &&
        typeof f.content === "string" &&
        f.content.length > 0 &&
        f.content.length <= 65536
      ) {
        configFiles.push({
          fileName: f.fileName.trim().slice(0, 80),
          folderHint: f.folderHint.trim().slice(0, 240),
          adapter: typeof f.adapter === "string" ? f.adapter.trim().slice(0, 40) : "config",
          content: f.content,
          size: Number.isFinite(f.size) ? f.size : f.content.length,
        });
      }
    }
  }
  const gameVersion =
    typeof input.gameVersion === "string" ? input.gameVersion.trim().slice(0, 40) : "";
  return {
    width,
    height,
    preset: bounded(input.preset),
    upscaling: bounded(input.upscaling),
    frameGeneration: bounded(input.frameGeneration),
    rayTracing: bounded(input.rayTracing),
    source:
      input.source === "config"
        ? "config"
        : input.source === "unknown"
          ? "unknown"
          : "manual",
    ...(gameVersion ? { gameVersion } : {}),
    ...(Object.keys(details).length > 0 ? { details } : {}),
    ...(configFiles.length > 0 ? { configFiles } : {}),
  };
}
export function getGameGraphics(gameId: number): GraphicsContext {
  if (!getGameById(gameId)) throw new Error("Game not found");
  const row = getDb()
    .prepare("SELECT value FROM app_settings WHERE key=?")
    .get(`graphics_context_${gameId}`) as any;
  let saved: GraphicsContext | null = null;
  try {
    if (row?.value) saved = validateGraphicsContext(JSON.parse(row.value));
  } catch {}
  const configs = detectGameConfigs(gameId);
  const config =
    configs.find((c) => c.graphics.width && c.graphics.height) ||
    configs.find(
      (c) =>
        c.graphics.preset ||
        c.graphics.upscaling ||
        c.graphics.frameGeneration ||
        c.graphics.rayTracing ||
        (c.graphics.details && Object.keys(c.graphics.details).length > 0),
    );
  if (config) {
    return validateGraphicsContext({
      ...EMPTY_GRAPHICS,
      ...saved,
      ...config.graphics,
      source: "config",
    });
  }
  return saved || { ...EMPTY_GRAPHICS };
}
export function saveGameGraphics(
  gameId: number,
  input: Partial<GraphicsContext>,
): GraphicsContext {
  if (!getGameById(gameId)) throw new Error("Game not found");
  const graphics = validateGraphicsContext(input);
  getDb()
    .prepare(
      "INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(`graphics_context_${gameId}`, JSON.stringify(graphics));
  return graphics;
}
export async function capturePerformanceContext(
  sessionId: number,
  gameId: number,
  hardware?: HardwareInfo,
  capturedAt = new Date().toISOString(),
): Promise<void> {
  const db = getDb();
  ensurePerformanceSchema();
  const graphics = getGameGraphics(gameId);
  const snapshot = hardware || (await getHardwareInfo());
  if (getDb() !== db) return;
  db
    .prepare(
      `INSERT INTO performance_session_context(session_id,game_id,hardware_json,graphics_json,captured_at) VALUES (?,?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET hardware_json=excluded.hardware_json,graphics_json=excluded.graphics_json,captured_at=excluded.captured_at
    WHERE excluded.captured_at>=performance_session_context.captured_at`,
    )
    .run(
      sessionId,
      gameId,
      JSON.stringify(snapshot),
      JSON.stringify(graphics),
      capturedAt,
    );
}
export function compatibleFpsAverage(
  measurements: Array<{
    fps: number;
    samples: number;
  }>,
): number | null {
  const valid = measurements.filter(
    (m) =>
      Number.isFinite(m.fps) &&
      m.fps > 0 &&
      Number.isFinite(m.samples) &&
      m.samples > 0,
  );
  const frames = valid.reduce((n, m) => n + m.samples, 0),
    seconds = valid.reduce((n, m) => n + m.samples / m.fps, 0);
  return frames && seconds ? frames / seconds : null;
}
export function getPerformancePreview(gameId: number): PerformancePreview {
  ensurePerformanceSchema();
  const game = getGameById(gameId);
  if (!game) throw new Error("Game not found");
  const gameKey =
    game.steam_id && game.steam_id > 0
      ? String(game.steam_id)
      : `t_${game.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const rows = getDb()
    .prepare(
      `SELECT s.*,c.hardware_json,c.graphics_json,c.captured_at FROM sessions s LEFT JOIN performance_session_context c ON c.session_id=s.id AND c.game_id=s.game_id
    WHERE s.game_id=? AND s.is_running=0 AND s.fps_avg>0 ORDER BY s.start_time DESC LIMIT 50`,
    )
    .all(gameId) as any[];
  const currentContext = getGameGraphics(gameId);
  const reports = rows.map((row) => {
    let hardware: HardwareInfo | null = null,
      graphics: GraphicsContext = {
        ...currentContext,
      };
    try {
      if (row.hardware_json) {
        hardware = JSON.parse(row.hardware_json);
      }
      if (row.graphics_json) {
        graphics = validateGraphicsContext(JSON.parse(row.graphics_json));
      }
    } catch {}
    return {
      gameKey,
      title: game.title,
      steamId: game.steam_id && game.steam_id > 0 ? game.steam_id : null,
      coverUrl: game.cover_url,
      completionStatus: (game.status === "completed" ? "completed" : "played") as "completed" | "played",
      cpu: hardware?.cpu_name || "",
      gpu: hardware?.gpus?.map((g) => g.name).join(" / ") || "",
      ramGb: hardware?.ram_gb || 0,
      fpsAverage: row.fps_avg,
      fpsLow: row.fps_1pct_low,
      samples: row.fps_samples || 0,
      source: "presentmon" as const,
      measuredAt: row.captured_at || row.end_time || row.start_time,
      graphics,
      sessionId: row.id,
      snapshotAvailable: !!hardware,
    };
  });
  const candidates = detectGameConfigs(gameId);
  return {
    game: {
      gameKey,
      title: game.title,
      steamId: game.steam_id && game.steam_id > 0 ? game.steam_id : null,
      coverUrl: game.cover_url,
      status: game.status,
    },
    context: getGameGraphics(gameId),
    reports,
    candidates,
    supported: candidates.length > 0,
  };
}
export function prepareMeasuredReport(
  gameId: number,
  sessionId: number,
): PerformanceReport {
  const preview = getPerformancePreview(gameId);
  if (preview.game.status !== "completed")
    throw new Error(
      "Mark the game as completed before sharing a completion report",
    );
  const r = preview.reports.find((r) => r.sessionId === sessionId);
  if (!r || !r.snapshotAvailable)
    throw new Error(
      "This session has no saved hardware snapshot. Use a new measured session or a self-reported result.",
    );
  if (!r.graphics.width || !r.graphics.height || !r.graphics.preset)
    throw new Error(
      "This session has no confirmed graphics context. Configure the next measurement or share a self-reported result.",
    );
  const { sessionId: _, snapshotAvailable: __, ...report } = r;
  return report;
}

export type PreviewReportEntry = PerformancePreview["reports"][number];

/**
 * Picks the best measured session to represent this game on the Community Hub.
 * Prefers sessions that have a saved hardware snapshot and detected graphics
 * resolution, falling back to the most recent valid measured session.
 */
export function selectBestMeasuredReport(
  reports: PreviewReportEntry[],
  preferredSessionId?: number,
): PreviewReportEntry | null {
  const valid = (reports || []).filter(
    (r) => Number.isFinite(r.fpsAverage) && r.fpsAverage > 0 && (r.samples || 0) >= 10,
  );
  if (valid.length === 0) return null;
  if (preferredSessionId) {
    const exact = valid.find((r) => r.sessionId === preferredSessionId);
    if (exact) return exact;
  }
  const withFullContext = valid.find(
    (r) =>
      r.snapshotAvailable &&
      r.cpu &&
      r.gpu &&
      r.ramGb > 0 &&
      r.graphics.width &&
      r.graphics.height,
  );
  if (withFullContext) return withFullContext;

  const withSnapshot = valid.find(
    (r) => r.snapshotAvailable && r.cpu && r.gpu && r.ramGb > 0,
  );
  if (withSnapshot) return withSnapshot;

  return valid[0];
}

/**
 * Builds a community-ready performance report for a game by auto-selecting the
 * best measured FPS session and filling missing hardware/config fields from
 * automatic local system & config-file detection (never manual input).
 */
export async function buildAutoCommunityPerformanceReport(
  gameId: number,
  preferredSessionId?: number,
): Promise<(PerformanceReport & { sessionId: number }) | null> {
  const preview = getPerformancePreview(gameId);
  const chosen = selectBestMeasuredReport(preview.reports, preferredSessionId);
  if (!chosen) return null;

  let cpu = chosen.cpu;
  let gpu = chosen.gpu;
  let ramGb = chosen.ramGb;
  if (!cpu || !gpu || !(ramGb > 0)) {
    try {
      const hw = await getHardwareInfo();
      if (!cpu) cpu = hw?.cpu_name || "";
      if (!gpu) gpu = hw?.gpus?.map((g) => g.name).filter(Boolean).join(" / ") || "";
      if (!(ramGb > 0)) ramGb = hw?.ram_gb || 0;
    } catch {}
  }

  if (!cpu || !gpu || !(ramGb > 0)) return null;

  const ctx = preview.context;
  const base =
    chosen.graphics.width && chosen.graphics.height
      ? chosen.graphics
      : ctx.width && ctx.height
        ? ctx
        : chosen.graphics;

  const mergedDetails = {
    ...(ctx.details || {}),
    ...(chosen.graphics.details || {}),
  };

  const gameVersion = getGameExecutableVersion(gameId);
  const configFiles = collectSharedConfigFiles(gameId);

  const normalizedGraphics: GraphicsContext = {
    width: base.width ?? null,
    height: base.height ?? null,
    preset: base.preset || ctx.preset || "",
    upscaling: base.upscaling || ctx.upscaling || "",
    frameGeneration: base.frameGeneration || ctx.frameGeneration || "",
    rayTracing: base.rayTracing || ctx.rayTracing || "",
    source:
      base.source === "config" || ctx.source === "config" ? "config" : "unknown",
    ...(gameVersion ? { gameVersion } : {}),
    ...(Object.keys(mergedDetails).length > 0 ? { details: mergedDetails } : {}),
    ...(configFiles.length > 0 ? { configFiles } : {}),
  };

  return {
    gameKey: chosen.gameKey,
    title: chosen.title,
    steamId: chosen.steamId ?? null,
    coverUrl: chosen.coverUrl ?? null,
    completionStatus: chosen.completionStatus,
    cpu,
    gpu,
    ramGb,
    fpsAverage: chosen.fpsAverage,
    fpsLow: chosen.fpsLow ?? null,
    samples: chosen.samples,
    graphics: normalizedGraphics,
    source: "presentmon",
    measuredAt: chosen.measuredAt,
    sessionId: chosen.sessionId,
  };
}
