import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { deflateRawSync } from "node:zlib";
import { getDb, getGameById, getSavePaths, getSetting, setSetting } from "./db.ts";
import { detectSaveLocations } from "./save-manager.ts";
import type { ConfigCandidate, GraphicsContext } from "../shared/community.ts";
import type { Game } from "../shared/types.ts";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PCGW_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_EXTENSIONS = new Set([
  ".ini",
  ".cfg",
  ".json",
  ".xml",
  ".settings",
]);
const IGNORED_CONFIG_NAMES = new Set([
  "manifest.json",
  "gamevault.vault.json",
  "savevault.json",
  "steam_autocloud.vdf",
  "package.json",
  "tsconfig.json",
]);

function normalizeToggleValue(raw: string): string {
  const v = raw.trim().replace(/^"|"$/g, "").toLowerCase();
  if (!v) return "";
  if (["0", "false", "off", "none", "disabled", "no"].includes(v)) return "Off";
  if (["1", "true", "on", "enabled", "yes"].includes(v)) return "On";
  return raw.trim().slice(0, 40);
}

function normalizeLevelOrValue(raw: string): string {
  const v = raw.trim().replace(/^"|"$/g, "");
  if (!v) return "";
  if (/^[0-4]$/.test(v)) return ["Low", "Medium", "High", "Ultra", "Epic"][Number(v)];
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true" ? "On" : "Off";
  return v.length > 40 ? v.slice(0, 40) : v;
}

function collectConfigValues(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const match = trimmed.match(/^([\w.-]+)\s*[:=]\s*(.{0,200})$/);
    if (match) {
      values.set(match[1].toLowerCase(), match[2].trim().replace(/^"|"$/g, ""));
    }
  }
  if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
    try {
      const walk = (v: any, depth: number) => {
        if (depth > 20 || !v || typeof v !== "object") return;
        if (
          typeof v.name === "string" &&
          ["string", "number", "boolean"].includes(typeof v.value)
        ) {
          values.set(v.name.toLowerCase(), String(v.value).slice(0, 200));
        }
        for (const [k, a] of Object.entries(v)) {
          if (a && typeof a === "object") walk(a, depth + 1);
          else if (["string", "number", "boolean"].includes(typeof a)) {
            values.set(k.toLowerCase(), String(a).slice(0, 200));
          }
        }
      };
      walk(JSON.parse(content), 0);
    } catch {}
  }
  if (content.trim().startsWith("<")) {
    for (const m of content.matchAll(/<([\w.-]+)(?:\s+[^>]*)?>([^<]{1,120})<\/\1>/g)) {
      values.set(m[1].toLowerCase(), m[2].trim());
    }
    for (const m of content.matchAll(/(?:name|key)\s*=\s*["']([\w.-]+)["'][^>]*?(?:value|val)\s*=\s*["']([^"']{1,120})["']/gi)) {
      values.set(m[1].toLowerCase(), m[2].trim());
    }
  }
  return values;
}

function firstValue(values: Map<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = values.get(k);
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

export function parseGraphicsConfig(content: string): Partial<GraphicsContext> {
  if (content.length > MAX_FILE_BYTES)
    throw new Error("Configuration file is too large");
  const values = collectConfigValues(content);

  const resolution = (
    firstValue(values, ["resolution", "screenresolution", "displayresolution", "renderresolution"]) || ""
  ).match(/^(\d{3,5})\s*[xX×,]\s*(\d{3,5})$/);
  const w = Number(
    firstValue(values, ["resolutionsizex", "screenwidth", "displaywidth", "windowwidth", "renderwidth", "width"]) ||
      resolution?.[1],
  );
  const h = Number(
    firstValue(values, ["resolutionsizey", "screenheight", "displayheight", "windowheight", "renderheight", "height"]) ||
      resolution?.[2],
  );
  const result: Partial<GraphicsContext> = {};
  if (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= 320 &&
    w <= 16384 &&
    h >= 200 &&
    h <= 16384
  ) {
    result.width = w;
    result.height = h;
    result.source = "config";
  }

  const levels = [
    "sg.viewdistancequality",
    "sg.shadowquality",
    "sg.texturequality",
    "sg.effectsquality",
    "sg.postprocessquality",
  ].map((k) => values.get(k));
  if (levels.every((v) => v !== undefined)) {
    const distinct = new Set(levels);
    result.preset =
      distinct.size === 1
        ? ["Low", "Medium", "High", "Ultra"][Number(levels[0])] || "Custom"
        : "Custom";
  } else {
    const rawPreset = firstValue(values, [
      "graphicspreset",
      "qualitypreset",
      "overallquality",
      "preset",
      "graphicsquality",
      "videoquality",
    ]);
    if (rawPreset) {
      result.preset = normalizeLevelOrValue(rawPreset);
    }
  }

  // Upscaling detection (DLSS / FSR / XeSS / TSR)
  const rawUpscaler = firstValue(values, [
    "upscaling",
    "upscaler",
    "superresolution",
    "scalingmethod",
    "upscalingtype",
    "resolutionupscaling",
  ]);
  const dlssVal = firstValue(values, ["dlss", "dlssmode", "dlssquality", "r.ngx.dlss.enable", "r.ngx.dlss.quality"]);
  const fsr3Val = firstValue(values, ["fsr3", "fsr3mode", "fsr3quality", "r.fidelityfx.fsr3.enabled", "r.fidelityfx.fsr3.qualitymode"]);
  const fsrVal = firstValue(values, ["fsr2", "fsr2mode", "fsr", "fsrmode", "fsrquality", "sg.fidelityfxfsrquality"]);
  const xessVal = firstValue(values, ["xess", "xessmode", "xessquality", "r.xess.enabled"]);

  if (rawUpscaler && normalizeToggleValue(rawUpscaler) !== "Off") {
    result.upscaling = rawUpscaler.slice(0, 60);
  } else if (dlssVal && normalizeToggleValue(dlssVal) !== "Off") {
    const mode = normalizeToggleValue(dlssVal) === "On" ? "" : ` ${normalizeLevelOrValue(dlssVal)}`;
    result.upscaling = `DLSS${mode}`.trim();
  } else if (fsr3Val && normalizeToggleValue(fsr3Val) !== "Off") {
    const mode = normalizeToggleValue(fsr3Val) === "On" ? "" : ` ${normalizeLevelOrValue(fsr3Val)}`;
    result.upscaling = `FSR 3${mode}`.trim();
  } else if (fsrVal && normalizeToggleValue(fsrVal) !== "Off") {
    const mode = normalizeToggleValue(fsrVal) === "On" ? "" : ` ${normalizeLevelOrValue(fsrVal)}`;
    result.upscaling = `FSR${mode}`.trim();
  } else if (xessVal && normalizeToggleValue(xessVal) !== "Off") {
    const mode = normalizeToggleValue(xessVal) === "On" ? "" : ` ${normalizeLevelOrValue(xessVal)}`;
    result.upscaling = `XeSS${mode}`.trim();
  }

  // Frame Generation detection
  const fgVal = firstValue(values, [
    "framegeneration",
    "dlssframegeneration",
    "dlssg",
    "fsr3framegeneration",
    "fsrframegen",
    "enableframegeneration",
    "framegen",
  ]);
  if (fgVal) {
    result.frameGeneration = normalizeToggleValue(fgVal);
  }

  // Ray Tracing detection
  const rtVal = firstValue(values, [
    "raytracing",
    "pathtracing",
    "r.raytracing",
    "raytracedreflections",
    "raytracedshadows",
    "raytracedlighting",
    "dxr",
  ]);
  if (rtVal) {
    result.rayTracing = normalizeToggleValue(rtVal);
  }

  // Allowlisted detailed graphics settings (safe, never leaks credentials)
  const detailRules: Array<[string, string[], (v: string) => string]> = [
    ["Window Mode", ["fullscreenmode", "windowmode", "displaymode", "fullscreen"], (v) => {
      if (v === "0") return "Fullscreen";
      if (v === "1") return "Borderless";
      if (v === "2") return "Windowed";
      return normalizeToggleValue(v);
    }],
    ["VSync", ["busevsync", "vsync", "verticalsync"], normalizeToggleValue],
    ["FPS Cap", ["frameratelimit", "maxfps", "fpslimit", "fpscap"], (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n <= 0 ? "Unlimited" : v.slice(0, 20);
    }],
    ["Textures", ["sg.texturequality", "texturequality", "textures"], normalizeLevelOrValue],
    ["Shadows", ["sg.shadowquality", "shadowquality", "shadows"], normalizeLevelOrValue],
    ["Anti-Aliasing", ["sg.antialiasingquality", "antialiasing", "aamode", "aa"], normalizeLevelOrValue],
    ["Effects", ["sg.effectsquality", "effectsquality", "vfxquality"], normalizeLevelOrValue],
    ["Post Processing", ["sg.postprocessquality", "postprocessquality", "postprocessing"], normalizeLevelOrValue],
    ["View Distance", ["sg.viewdistancequality", "viewdistance", "drawdistance"], normalizeLevelOrValue],
    ["Foliage", ["sg.foliagequality", "foliagequality", "grassquality"], normalizeLevelOrValue],
    ["Reflections", ["sg.reflectionquality", "reflectionquality", "reflections", "ssr"], normalizeLevelOrValue],
    ["Ambient Occlusion", ["ambientocclusion", "ao", "ssao"], normalizeLevelOrValue],
    ["Volumetric Fog", ["volumetricfog", "fogquality"], normalizeLevelOrValue],
    ["Anisotropic", ["anisotropicfiltering", "anisotropy"], (v) => v.slice(0, 20)],
    ["Motion Blur", ["motionblur"], normalizeToggleValue],
    ["Render Scale", ["sg.resolutionquality", "renderscale", "resolutionscale", "screenscale"], (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? `${Math.round(n <= 2 ? n * 100 : n)}%` : v.slice(0, 20);
    }],
    ["FOV", ["fov", "fieldofview"], (v) => v.slice(0, 16)],
    ["HDR", ["busehdrdisplayoutput", "hdr", "hdrenabled"], normalizeToggleValue],
  ];

  const details: Record<string, string> = {};
  for (const [label, keys, format] of detailRules) {
    const raw = firstValue(values, keys);
    if (raw !== undefined) {
      const formatted = format(raw);
      if (formatted) details[label] = formatted;
    }
  }
  if (Object.keys(details).length > 0) {
    result.details = details;
  }

  if (
    result.width ||
    result.preset ||
    result.upscaling ||
    result.frameGeneration ||
    result.rayTracing ||
    result.details
  ) {
    result.source = "config";
  }
  return result;
}
function readableConfig(file: string): boolean {
  try {
    if (!ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
    const resolved = path.resolve(file),
      real = fs.realpathSync(file);
    if (real.toLowerCase() !== resolved.toLowerCase()) return false;
    const info = fs.lstatSync(file);
    return (
      !info.isSymbolicLink() &&
      info.isFile() &&
      info.size > 0 &&
      info.size <= MAX_FILE_BYTES
    );
  } catch {
    return false;
  }
}
export function hasCredentialSettings(content: string): boolean {
  const names =
    "(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|accounttoken|client[_-]?secret|authorization)";
  return (
    new RegExp(`(?:^|[\\s"'<])${names}["'>\\s]*[:=]`, "im").test(content) ||
    new RegExp(`<(?:[\\w.-]+:)?${names}\\b[^>]*>`, "i").test(content) ||
    new RegExp(`\\b(?:name|key)\\s*=\\s*["']${names}["']`, "i").test(content)
  );
}
export function configPathsForGame(
  game: Game,
  roots = {
    local: process.env.LOCALAPPDATA || "",
    documents: path.join(os.homedir(), "Documents"),
  },
): Array<{
  path: string;
  adapter: string;
}> {
  const result: Array<{
    path: string;
    adapter: string;
  }> = [];
  if (game.steam_id === 292030)
    result.push({
      path: path.join(roots.documents, "The Witcher 3", "user.settings"),
      adapter: "witcher3",
    });
  if (game.steam_id === 1091500 && roots.local)
    result.push({
      path: path.join(
        roots.local,
        "CD Projekt Red",
        "Cyberpunk 2077",
        "UserSettings.json",
      ),
      adapter: "cyberpunk2077",
    });
  // Bounded Unreal candidates are only offered for executables with an Unreal shipping fingerprint.
  if (
    /-win(?:64|32)-shipping\.exe$/i.test(
      game.exe_name || path.basename(game.exe_path || ""),
    ) &&
    roots.local
  ) {
    const base = path
      .basename(game.exe_name || game.exe_path || "", ".exe")
      .replace(/-Win(?:64|32)-Shipping$/i, "");
    const names = Array.from(
      new Set([base, game.title.replace(/[^a-zA-Z0-9]/g, "")]),
    ).filter(
      (n) =>
        n.length >= 3 && !/^(game|client|launcher|engine|shipping)$/i.test(n),
    );
    for (const n of names)
      for (const platform of ["Windows", "WindowsNoEditor"])
        result.push({
          path: path.join(
            roots.local,
            n,
            "Saved",
            "Config",
            platform,
            "GameUserSettings.ini",
          ),
          adapter: "unreal-game-user-settings",
        });
  }
  return result;
}
export function registerManualConfig(gameId: number, file: string): void {
  if (!getGameById(gameId)) throw new Error("Game not found");
  if (!readableConfig(file))
    throw new Error(
      "Choose a readable INI, CFG, JSON, XML or SETTINGS file smaller than 2 MB",
    );
  const normalized = path.resolve(file);
  getDb()
    .prepare(
      "INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(`game_config_file_${gameId}`, normalized);
}
function collectReadableConfigsInDir(
  dir: string,
  adapter: string,
  depth = 0,
  budget = { remaining: 60 },
): Array<{ path: string; adapter: string }> {
  const found: Array<{ path: string; adapter: string }> = [];
  if (depth > 2 || budget.remaining <= 0 || !dir) return found;
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return found;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (budget.remaining <= 0) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/^(logs|crashes|shader|shadercache|temp|cache|backup|backups)$/i.test(entry.name)) continue;
        found.push(...collectReadableConfigsInDir(full, adapter, depth + 1, budget));
      } else if (entry.isFile()) {
        budget.remaining--;
        if (IGNORED_CONFIG_NAMES.has(entry.name.toLowerCase())) continue;
        if (!readableConfig(full)) continue;
        try {
          const content = fs.readFileSync(full, "utf8");
          if (hasCredentialSettings(content)) continue;
          const parsed = parseGraphicsConfig(content);
          if (
            parsed.width ||
            parsed.preset ||
            parsed.upscaling ||
            parsed.frameGeneration ||
            parsed.rayTracing ||
            parsed.details
          ) {
            found.push({ path: full, adapter });
          }
        } catch {}
      }
    }
  } catch {}
  return found;
}

export function scanSaveRelatedConfigs(game: Game): Array<{ path: string; adapter: string }> {
  const dirs = new Set<string>();
  try {
    for (const sp of getSavePaths(game.id)) {
      if (sp.source_path && sp.enabled !== 0) {
        dirs.add(sp.source_path);
        const parent = path.dirname(sp.source_path);
        for (const sibling of ["Config", "Settings", "Configuration"]) {
          dirs.add(path.join(parent, sibling));
        }
      }
    }
  } catch {}

  try {
    const detected = detectSaveLocations(game).filter((c) => c.confidence !== "low").slice(0, 3);
    for (const c of detected) {
      dirs.add(c.path);
      const parent = path.dirname(c.path);
      for (const sibling of ["Config", "Settings"]) {
        dirs.add(path.join(parent, sibling));
      }
    }
  } catch {}

  if (game.exe_path) {
    try {
      const exeDir = path.dirname(game.exe_path);
      dirs.add(exeDir);
      dirs.add(path.join(path.dirname(path.dirname(exeDir)), "Saved", "Config", "Windows"));
      dirs.add(path.join(path.dirname(path.dirname(exeDir)), "Saved", "Config", "WindowsNoEditor"));
    } catch {}
  }

  const results: Array<{ path: string; adapter: string }> = [];
  const budget = { remaining: 80 };
  for (const dir of dirs) {
    if (budget.remaining <= 0) break;
    results.push(...collectReadableConfigsInDir(dir, "auto-save-scan", 0, budget));
  }
  return results;
}

function expandPcgwPath(rawPath: string, game: Game): string[] {
  const local = process.env.LOCALAPPDATA || "";
  const roaming = process.env.APPDATA || "";
  const profile = process.env.USERPROFILE || os.homedir();
  const documents = path.join(profile, "Documents");
  const gameDir = game.exe_path ? path.dirname(game.exe_path) : "";

  let p = rawPath
    .trim()
    .replace(/\{\{p\|userprofile\}\}/gi, profile)
    .replace(/\{\{p\|localappdata\}\}/gi, local)
    .replace(/\{\{p\|appdata\}\}/gi, roaming)
    .replace(/\{\{p\|documents\}\}/gi, documents)
    .replace(/\{\{p\|savedgames\}\}/gi, path.join(profile, "Saved Games"))
    .replace(/\{\{p\|game\}\}/gi, gameDir)
    .replace(/%USERPROFILE%/gi, profile)
    .replace(/%LOCALAPPDATA%/gi, local)
    .replace(/%APPDATA%/gi, roaming)
    .replace(/%DOCUMENTS%/gi, documents)
    .replace(/<path-to-game>/gi, gameDir)
    .replace(/\//g, path.sep);

  if (!p || p.includes("<") || p.includes("{{")) return [];
  const resolved = path.resolve(p);
  if (readableConfig(resolved)) return [resolved];
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return collectReadableConfigsInDir(resolved, "pcgamingwiki", 0, { remaining: 20 }).map((x) => x.path);
    }
  } catch {}
  return [];
}

export function extractPcgwConfigPathsFromWikitext(wikitext: string): string[] {
  const found: string[] = [];
  for (const m of wikitext.matchAll(/\{\{Game data\/config\|Windows\|((?:\{\{[^}]+\}\}|[^|}])+)(?:\|(?:[^}]|\{\{[^}]+\}\})*)?\}\}/gi)) {
    const raw = m[1].trim();
    if (raw && !found.includes(raw)) found.push(raw);
  }
  return found;
}

export async function discoverGameConfigsAsync(
  gameId: number,
  options: { fetchImpl?: (url: string, init?: any) => Promise<any>; forceRefresh?: boolean } = {},
): Promise<ConfigCandidate[]> {
  const game = getGameById(gameId);
  if (!game) throw new Error("Game not found");

  const cacheKey = `pcgw_config_cache_v1:${game.steam_id && game.steam_id > 0 ? game.steam_id : game.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  let rawPaths: string[] = [];
  let fromCache = false;

  if (!options.forceRefresh) {
    try {
      const cached = getSetting(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - Number(parsed?.ts || 0) < PCGW_CACHE_TTL_MS && Array.isArray(parsed?.paths)) {
          rawPaths = parsed.paths;
          fromCache = true;
        }
      }
    } catch {}
  }

  if (!fromCache) {
    const fetchImpl = options.fetchImpl || fetch;
    try {
      let pageTitle = "";
      if (game.steam_id && game.steam_id > 0) {
        const cargoUrl = `https://www.pcgamingwiki.com/w/api.php?action=cargoquery&tables=Infobox_game&fields=Infobox_game._pageName=Page&where=Steam_AppID%20HOLDS%20%27${game.steam_id}%27&format=json`;
        const resp = await fetchImpl(cargoUrl, { headers: { "User-Agent": "GameVault/1.0" } });
        if (resp?.ok) {
          const data = await resp.json();
          pageTitle = data?.cargoquery?.[0]?.title?.Page || "";
        }
      }
      if (!pageTitle && game.title) {
        const searchUrl = `https://www.pcgamingwiki.com/w/api.php?action=opensearch&search=${encodeURIComponent(game.title)}&limit=1&format=json`;
        const resp = await fetchImpl(searchUrl, { headers: { "User-Agent": "GameVault/1.0" } });
        if (resp?.ok) {
          const data = await resp.json();
          pageTitle = Array.isArray(data?.[1]) ? data[1][0] || "" : "";
        }
      }
      if (pageTitle) {
        const parseUrl = `https://www.pcgamingwiki.com/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json`;
        const resp = await fetchImpl(parseUrl, { headers: { "User-Agent": "GameVault/1.0" } });
        if (resp?.ok) {
          const data = await resp.json();
          const wikitext = data?.parse?.wikitext?.["*"] || "";
          rawPaths = extractPcgwConfigPathsFromWikitext(wikitext);
        }
      }
      setSetting(cacheKey, JSON.stringify({ ts: Date.now(), paths: rawPaths }));
    } catch {}
  }

  const expanded: string[] = [];
  for (const raw of rawPaths) {
    for (const p of expandPcgwPath(raw, game)) {
      if (!expanded.includes(p)) expanded.push(p);
    }
  }
  try {
    setSetting(`pcgw_config_paths_${gameId}`, JSON.stringify(expanded));
  } catch {}

  return detectGameConfigs(gameId);
}

export function detectGameConfigs(gameId: number): ConfigCandidate[] {
  const game = getGameById(gameId);
  if (!game) throw new Error("Game not found");
  const candidates = configPathsForGame(game);

  try {
    const pcgwRaw = getSetting(`pcgw_config_paths_${gameId}`);
    if (pcgwRaw) {
      const pcgwPaths = JSON.parse(pcgwRaw);
      if (Array.isArray(pcgwPaths)) {
        for (const p of pcgwPaths) {
          if (typeof p === "string") candidates.push({ path: p, adapter: "pcgamingwiki" });
        }
      }
    }
  } catch {}

  candidates.push(...scanSaveRelatedConfigs(game));

  const manual = getDb()
    .prepare("SELECT value FROM app_settings WHERE key=?")
    .get(`game_config_file_${gameId}`) as any;
  if (manual?.value)
    candidates.push({
      path: manual.value,
      adapter: "user-selected",
    });
  return candidates
    .filter(
      (v, i, a) =>
        a.findIndex(
          (x) =>
            path.resolve(x.path).toLowerCase() ===
            path.resolve(v.path).toLowerCase(),
        ) === i && readableConfig(v.path),
    )
    .map((v) => ({
      ...v,
      path: path.resolve(v.path),
      name: path.basename(v.path),
      size: fs.statSync(v.path).size,
      graphics: parseGraphicsConfig(fs.readFileSync(v.path, "utf8")),
    }));
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function makeSettingsZip(
  entries: Array<{
    name: string;
    bytes: Buffer;
  }>,
): Buffer {
  if (entries.length > 11) throw new Error("Too many configuration files");
  const seen = new Set<string>(),
    local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0,
    total = 0;
  for (const entry of entries) {
    if (
      !/^[a-zA-Z0-9_. -]{1,120}$/.test(entry.name) ||
      entry.name === "." ||
      entry.name === ".." ||
      seen.has(entry.name.toLowerCase())
    )
      throw new Error("Invalid or duplicate archive name");
    seen.add(entry.name.toLowerCase());
    total += entry.bytes.length;
    if (entry.bytes.length > MAX_FILE_BYTES || total > 16 * 1024 * 1024)
      throw new Error("Settings export exceeds size limit");
    const name = Buffer.from(entry.name, "utf8"),
      data = deflateRawSync(entry.bytes),
      crc = crc32(entry.bytes),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x21, 12); // Valid DOS date: 1980-01-01.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(entry.bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function exportGameSettings(
  gameId: number,
  selectedPaths: string[],
  destination: string,
): {
  files: number;
  destination: string;
} {
  const game = getGameById(gameId);
  if (!game) throw new Error("Game not found");
  if (
    !Array.isArray(selectedPaths) ||
    selectedPaths.length < 1 ||
    selectedPaths.length > 10 ||
    new Set(selectedPaths).size !== selectedPaths.length
  )
    throw new Error("Select 1-10 distinct configuration files");
  if (path.extname(destination).toLowerCase() !== ".zip")
    throw new Error("Export destination must be a ZIP file");
  const candidates = detectGameConfigs(gameId),
    entries: Array<{
      name: string;
      bytes: Buffer;
    }> = [],
    manifest: any[] = [];
  for (const selected of selectedPaths) {
    const allowed = candidates.find(
      (c) => c.path.toLowerCase() === path.resolve(selected).toLowerCase(),
    );
    if (!allowed || !readableConfig(allowed.path))
      throw new Error("Selected file is not an approved game configuration");
    const handle = fs.openSync(allowed.path, "r");
    let bytes: Buffer;
    try {
      const stat = fs.fstatSync(handle);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
        throw new Error("Configuration file changed or is too large");
      bytes = fs.readFileSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
      }).decode(bytes);
    } catch {
      throw new Error("Only UTF-8 text configuration files can be exported");
    }
    if (hasCredentialSettings(content))
      throw new Error(
        "Configuration contains credential settings; export a graphics-only file instead",
      );
    const name = `${entries.length + 1}_${allowed.name.replace(/[^a-zA-Z0-9_. -]/g, "_")}`;
    entries.push({
      name,
      bytes,
    });
    manifest.push({
      name,
      adapter: allowed.adapter,
      size: bytes.length,
      graphics: allowed.graphics,
    });
  }
  entries.push({
    name: "manifest.json",
    bytes: Buffer.from(
      JSON.stringify(
        {
          version: 1,
          title: game.title,
          steamId: game.steam_id || null,
          exportedAt: new Date().toISOString(),
          files: manifest,
        },
        null,
        2,
      ),
      "utf8",
    ),
  });
  fs.writeFileSync(destination, makeSettingsZip(entries));
  return {
    files: selectedPaths.length,
    destination,
  };
}
