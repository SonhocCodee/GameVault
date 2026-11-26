import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { deflateRawSync } from "node:zlib";
import { getDb, getGameById } from "./db.ts";
import type { ConfigCandidate, GraphicsContext } from "../shared/community.ts";
import type { Game } from "../shared/types.ts";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".ini",
  ".cfg",
  ".json",
  ".xml",
  ".settings",
]);
export function parseGraphicsConfig(content: string): Partial<GraphicsContext> {
  if (content.length > MAX_FILE_BYTES)
    throw new Error("Configuration file is too large");
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.{0,200})$/);
    if (match)
      values.set(match[1].toLowerCase(), match[2].replace(/^"|"$/g, ""));
  }
  if (content.trim().startsWith("{")) {
    try {
      const walk = (v: any, depth: number) => {
        if (depth > 20 || !v || typeof v !== "object") return;
        if (
          typeof v.name === "string" &&
          ["string", "number", "boolean"].includes(typeof v.value)
        )
          values.set(v.name.toLowerCase(), String(v.value).slice(0, 200));
        for (const [k, a] of Object.entries(v)) {
          if (a && typeof a === "object") walk(a, depth + 1);
          else if (["string", "number", "boolean"].includes(typeof a))
            values.set(k.toLowerCase(), String(a).slice(0, 200));
        }
      };
      walk(JSON.parse(content), 0);
    } catch {}
  }
  const resolution = (values.get("resolution") || "").match(
    /^(\d{3,5})[xX×](\d{3,5})$/,
  );
  const w = Number(values.get("resolutionsizex") || resolution?.[1]),
    h = Number(values.get("resolutionsizey") || resolution?.[2]);
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
export function detectGameConfigs(gameId: number): ConfigCandidate[] {
  const game = getGameById(gameId);
  if (!game) throw new Error("Game not found");
  const candidates = configPathsForGame(game);
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
