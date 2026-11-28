import { getDb, getGameById } from "./db.ts";
import { getHardwareInfo } from "./hardware.ts";
import { detectGameConfigs } from "./game-settings.ts";
import type {
  GraphicsContext,
  PerformancePreview,
  PerformanceReport,
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
  const config = detectGameConfigs(gameId).find(
    (c) => c.graphics.width && c.graphics.height,
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
  const reports = rows.map((row) => {
    let hardware: HardwareInfo | null = null,
      graphics: GraphicsContext = {
        ...EMPTY_GRAPHICS,
      };
    try {
      if (row.hardware_json) {
        hardware = JSON.parse(row.hardware_json);
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
