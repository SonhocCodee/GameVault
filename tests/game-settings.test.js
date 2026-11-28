import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { inflateRawSync } from "node:zlib";
import {
  initDb,
  closeDb,
  createGame,
  getDb,
  addSavePath,
  mergeFragmentedSessions,
} from "../src/main/db.ts";
import { validatePerformanceReport } from "../worker/src/routes/discovery.ts";
import {
  configPathsForGame,
  parseGraphicsConfig,
  registerManualConfig,
  detectGameConfigs,
  discoverGameConfigsAsync,
  extractPcgwConfigPathsFromWikitext,
  toPortableFolderHint,
  importSharedConfigFile,
  exportGameSettings,
  makeSettingsZip,
} from "../src/main/game-settings.ts";
import {
  capturePerformanceContext,
  getPerformancePreview,
  saveGameGraphics,
  prepareMeasuredReport,
  compatibleFpsAverage,
  selectBestMeasuredReport,
  buildAutoCommunityPerformanceReport,
} from "../src/main/performance-context.ts";
let dir;
beforeEach(() => {
  initDb(":memory:");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gv-config-"));
});
afterEach(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("parses supported resolution and preset without publishing arbitrary config values", () => {
  const result = parseGraphicsConfig(
    "ResolutionSizeX=1920\nResolutionSizeY=1080\nsg.ViewDistanceQuality=2\nsg.ShadowQuality=2\nsg.TextureQuality=2\nsg.EffectsQuality=2\nsg.PostProcessQuality=2\nAccountToken=SECRET",
  );
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.preset, "High");
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  assert.deepEqual(
    parseGraphicsConfig("ResolutionSizeX=999999\nResolutionSizeY=0"),
    {},
  );
});
test("automatic detection is bounded by game adapters and does not claim unknown games", () => {
  assert.deepEqual(
    configPathsForGame(
      { title: "Unrelated", exe_name: "app.exe" },
      { local: dir, documents: dir },
    ),
    [],
  );
  const paths = configPathsForGame(
    { title: "The Witcher 3", steam_id: 292030 },
    { local: dir, documents: dir },
  );
  assert.equal(paths.length, 1);
  assert.equal(path.basename(paths[0].path), "user.settings");
});
test("explicit config export preserves source bytes and produces an actual ZIP", () => {
  const game = createGame({ title: "Test game" }),
    file = path.join(dir, "GameUserSettings.ini"),
    body = "ResolutionSizeX=1920\nResolutionSizeY=1080";
  fs.writeFileSync(file, body);
  registerManualConfig(game.id, file);
  assert.equal(detectGameConfigs(game.id).length, 1);
  const dest = path.join(dir, "export.zip");
  exportGameSettings(game.id, [file], dest);
  assert.equal(fs.readFileSync(file, "utf8"), body);
  const zip = fs.readFileSync(dest);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLength = zip.readUInt16LE(26),
    dataLength = zip.readUInt32LE(18);
  assert.equal(
    inflateRawSync(
      zip.subarray(30 + nameLength, 30 + nameLength + dataLength),
    ).toString(),
    body,
  );
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
test("export rejects unapproved files, traversal archive names, duplicates and oversized files", () => {
  const game = createGame({ title: "Test game" }),
    unknown = path.join(dir, "private.json");
  fs.writeFileSync(unknown, "{}");
  assert.throws(
    () => exportGameSettings(game.id, [unknown], path.join(dir, "out.zip")),
    /approved/,
  );
  assert.throws(
    () =>
      makeSettingsZip([{ name: "../private.ini", bytes: Buffer.from("x") }]),
    /archive name/,
  );
  assert.throws(
    () =>
      makeSettingsZip([
        { name: "a.ini", bytes: Buffer.from("x") },
        { name: "a.ini", bytes: Buffer.from("x") },
      ]),
    /duplicate/,
  );
  const huge = path.join(dir, "huge.ini");
  fs.writeFileSync(huge, Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.throws(() => registerManualConfig(game.id, huge), /smaller than 2 MB/);
});
test("configuration snapshots keep session hardware and never use monitor size as game resolution", async () => {
  const game = createGame({ title: "Test game", status: "completed" });
  getDb()
    .prepare(
      "INSERT INTO sessions(game_id,start_time,end_time,fps_avg,fps_samples) VALUES (?,datetime('now'),datetime('now'),60,1000)",
    )
    .run(game.id);
  const id = Number(getDb().prepare("SELECT id FROM sessions").get().id),
    hw = {
      cpu_name: "Old CPU",
      gpus: [{ name: "Old GPU" }],
      ram_gb: 16,
      display: { width: 3840, height: 2160 },
    };
  await capturePerformanceContext(id, game.id, hw);
  let preview = getPerformancePreview(game.id);
  assert.equal(preview.reports[0].graphics.width, null);
  assert.throws(() => prepareMeasuredReport(game.id, id), /graphics context/);
  saveGameGraphics(game.id, { width: 1920, height: 1080, preset: "High" });
  await capturePerformanceContext(id, game.id, hw);
  const report = prepareMeasuredReport(game.id, id);
  assert.equal(report.steamId, null);
  assert.equal(validatePerformanceReport(report).gameKey, report.gameKey);
  assert.equal(report.gpu, "Old GPU");
  assert.equal(report.graphics.width, 1920);
  saveGameGraphics(game.id, { width: 2560, height: 1440, preset: "Ultra" });
  assert.equal(prepareMeasuredReport(game.id, id).graphics.width, 1920);
});
test("old sessions without snapshots cannot be relabeled as a measured hardware benchmark", () => {
  const game = createGame({ title: "Test game", status: "completed" });
  getDb()
    .prepare(
      "INSERT INTO sessions(game_id,start_time,end_time,fps_avg,fps_samples) VALUES (?,datetime('now'),datetime('now'),60,1000)",
    )
    .run(game.id);
  const id = Number(getDb().prepare("SELECT id FROM sessions").get().id);
  assert.throws(
    () => prepareMeasuredReport(game.id, id),
    /no saved hardware snapshot/,
  );
});
test("compatible FPS combination uses measured duration rather than arithmetic weighting", () => {
  assert.equal(
    compatibleFpsAverage([
      { fps: 30, samples: 300 },
      { fps: 60, samples: 300 },
    ]),
    40,
  );
  assert.equal(compatibleFpsAverage([]), null);
});
test("credential-bearing configuration is never copied into an export", () => {
  const game = createGame({ title: "Test game" }),
    file = path.join(dir, "settings.ini"),
    destination = path.join(dir, "safe.zip");
  fs.writeFileSync(file, "ResolutionSizeX=1920\nAccessToken=SECRET");
  registerManualConfig(game.id, file);
  assert.throws(
    () => exportGameSettings(game.id, [file], destination),
    /credential/,
  );
  assert.equal(fs.existsSync(destination), false);
  assert.ok(fs.readFileSync(file, "utf8").includes("SECRET"));
});

test("credential XML elements and named settings are rejected without changing their source", () => {
  const game = createGame({ title: "Test game" });
  for (const [index, content] of [
    "<settings><password>SECRET</password></settings>",
    "<access_token>SECRET</access_token>",
    '<auth:password xmlns:auth="test">SECRET</auth:password>',
    '<setting name="AccessToken" value="SECRET"/>',
  ].entries()) {
    const file = path.join(dir, `config-${index}.xml`),
      destination = path.join(dir, `export-${index}.zip`);
    fs.writeFileSync(file, content);
    registerManualConfig(game.id, file);
    assert.throws(
      () => exportGameSettings(game.id, [file], destination),
      /credential/,
    );
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
});

test("legacy churn repair never merges benchmark sessions or their different graphics contexts", async () => {
  const game = createGame({ title: "Measured game", status: "completed" });
  const hw = { cpu_name: "CPU", gpus: [{ name: "GPU" }], ram_gb: 16 };
  for (const [start, end, fps, preset] of [
    ["2026-11-24T10:00:00Z", "2026-11-24T10:01:00Z", 60, "High"],
    ["2026-11-24T10:01:20Z", "2026-11-24T10:02:20Z", 120, "Low"],
  ]) {
    const res = getDb()
      .prepare(
        "INSERT INTO sessions(game_id,start_time,end_time,fps_avg,fps_samples,source) VALUES (?,?,?,?,1000,'tracker')",
      )
      .run(game.id, start, end, fps);
    saveGameGraphics(game.id, { width: 1920, height: 1080, preset });
    await capturePerformanceContext(
      Number(res.lastInsertRowid),
      game.id,
      hw,
      start,
    );
  }
  assert.equal(mergeFragmentedSessions().removedRows, 0);
  const preview = getPerformancePreview(game.id);
  assert.equal(preview.reports.length, 2);
  assert.equal(
    preview.reports.find((r) => r.graphics.preset === "High").fpsAverage,
    60,
  );
  assert.equal(
    preview.reports.find((r) => r.graphics.preset === "Low").fpsAverage,
    120,
  );
});

test("auto-selection prefers snapshot+resolution sessions and fills cached hardware without manual input", async () => {
  const game = createGame({ title: "Auto Sync Game", status: "playing" });
  getDb()
    .prepare(
      "INSERT INTO app_settings(key,value) VALUES ('hardware_info', ?)",
    )
    .run(
      JSON.stringify({
        collected_at: new Date().toISOString(),
        os_name: "Windows 11",
        os_build: "26100",
        cpu_name: "Ryzen 7 7800X3D",
        cpu_cores: 8,
        cpu_threads: 16,
        ram_gb: 32,
        gpus: [{ name: "AMD Radeon RX 7800 XT", driver: "1.0", vram_mb: 16384 }],
        display: { width: 2560, height: 1440, refresh_hz: 165 },
        presentmon_path: null,
      }),
    );

  // Session 1: measured FPS without snapshot
  const s1 = Number(
    getDb()
      .prepare(
        "INSERT INTO sessions(game_id,start_time,end_time,fps_avg,fps_samples,fps_1pct_low,source) VALUES (?,?,?,80,500,45,'amd_import')",
      )
      .run(game.id, "2026-11-24T10:00:00Z", "2026-11-24T11:00:00Z")
      .lastInsertRowid,
  );
  const autoFromFallback = await buildAutoCommunityPerformanceReport(game.id);
  assert.ok(autoFromFallback);
  assert.equal(autoFromFallback.sessionId, s1);
  assert.equal(autoFromFallback.cpu, "Ryzen 7 7800X3D");
  assert.equal(autoFromFallback.gpu, "AMD Radeon RX 7800 XT");
  assert.equal(autoFromFallback.ramGb, 32);
  assert.equal(autoFromFallback.source, "presentmon");
  assert.equal(autoFromFallback.graphics.source, "unknown");
  assert.equal(validatePerformanceReport(autoFromFallback).gameKey, autoFromFallback.gameKey);

  // Session 2: measured FPS with full snapshot + graphics resolution
  const s2 = Number(
    getDb()
      .prepare(
        "INSERT INTO sessions(game_id,start_time,end_time,fps_avg,fps_samples,fps_1pct_low,source) VALUES (?,?,?,110,2000,72,'tracker')",
      )
      .run(game.id, "2026-11-25T10:00:00Z", "2026-11-25T11:00:00Z")
      .lastInsertRowid,
  );
  saveGameGraphics(game.id, { width: 2560, height: 1440, preset: "High", source: "config" });
  await capturePerformanceContext(
    s2,
    game.id,
    { cpu_name: "Ryzen 7 7800X3D", gpus: [{ name: "RX 7800 XT" }], ram_gb: 32 },
    "2026-11-25T10:00:00Z",
  );
  const preview = getPerformancePreview(game.id);
  const best = selectBestMeasuredReport(preview.reports);
  assert.equal(best?.sessionId, s2);
});

test("performance UI removes manual FPS/config input forms", () => {
  const panel = fs.readFileSync(
    path.resolve("src/renderer/community/PerformancePanel.tsx"),
    "utf8",
  );
  const hub = fs.readFileSync(
    path.resolve("src/renderer/community/GameHub.tsx"),
    "utf8",
  );
  assert.equal(panel.includes("Nhập kết quả tự khai báo"), false);
  assert.equal(panel.includes("Lưu cấu hình phiên tiếp theo"), false);
  assert.equal(panel.includes("Chọn file thủ công"), false);
  assert.equal(hub.includes("Chia sẻ thủ công"), false);
  assert.equal(fs.existsSync(path.resolve("src/renderer/community/PerformanceShareForm.tsx")), false);
});

test("generic parser extracts upscaling, frame gen, ray tracing, and safe details", () => {
  const parsed = parseGraphicsConfig(
    JSON.stringify({
      Resolution: "2560x1440",
      GraphicsPreset: "Ultra",
      FSR3: "Quality",
      FrameGeneration: true,
      RayTracing: false,
      VSync: false,
      TextureQuality: 3,
      ShadowQuality: 2,
      RenderScale: 67,
      Password: "should-not-appear",
    }),
  );
  assert.equal(parsed.width, 2560);
  assert.equal(parsed.height, 1440);
  assert.equal(parsed.preset, "Ultra");
  assert.equal(parsed.upscaling, "FSR 3 Quality");
  assert.equal(parsed.frameGeneration, "On");
  assert.equal(parsed.rayTracing, "Off");
  assert.equal(parsed.details?.VSync, "Off");
  assert.equal(parsed.details?.Textures, "Ultra");
  assert.equal(parsed.details?.Shadows, "High");
  assert.equal(parsed.details?.["Render Scale"], "67%");
  assert.equal(JSON.stringify(parsed).includes("should-not-appear"), false);
});

test("detectGameConfigs scans sibling Config folder next to registered save path", () => {
  const game = createGame({ title: "Custom Indie Game" });
  const saveDir = path.join(dir, "Saved", "SaveGames");
  const configDir = path.join(dir, "Saved", "Config");
  fs.mkdirSync(saveDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "settings.ini"),
    "ScreenWidth=1920\nScreenHeight=1080\nDLSS=Balanced\nVSync=0\n",
  );
  addSavePath(game.id, saveDir);
  const found = detectGameConfigs(game.id);
  assert.equal(found.length, 1);
  assert.equal(found[0].adapter, "auto-save-scan");
  assert.equal(found[0].graphics.width, 1920);
  assert.equal(found[0].graphics.upscaling, "DLSS Balanced");
  assert.equal(found[0].graphics.details?.VSync, "Off");
});

test("discoverGameConfigsAsync extracts PCGamingWiki config paths and caches them", async () => {
  const wikitext =
    "{{Game data/config|Windows|{{p|localappdata}}/TestPcgwGame/config.ini}}";
  assert.deepEqual(extractPcgwConfigPathsFromWikitext(wikitext), [
    "{{p|localappdata}}/TestPcgwGame/config.ini",
  ]);
  const game = createGame({ title: "Test PCGW Game", steam_id: 999888 });
  const mockLocal = process.env.LOCALAPPDATA || dir;
  const targetDir = path.join(mockLocal, "TestPcgwGame");
  const targetFile = path.join(targetDir, "config.ini");
  const prevExisted = fs.existsSync(targetDir);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetFile, "Resolution=1920x1080\nFSR=Quality\n");
    const fakeFetch = async (url) => {
      if (url.includes("cargoquery")) {
        return {
          ok: true,
          json: async () => ({ cargoquery: [{ title: { Page: "Test PCGW Game" } }] }),
        };
      }
      if (url.includes("action=parse")) {
        return {
          ok: true,
          json: async () => ({ parse: { wikitext: { "*": wikitext } } }),
        };
      }
      return { ok: false };
    };
    const found = await discoverGameConfigsAsync(game.id, {
      fetchImpl: fakeFetch,
      forceRefresh: true,
    });
    assert.ok(found.some((c) => c.adapter === "pcgamingwiki" && c.graphics.upscaling === "FSR Quality"));
  } finally {
    if (!prevExisted) fs.rmSync(targetDir, { recursive: true, force: true });
    else fs.rmSync(targetFile, { force: true });
  }
});

test("parseGraphicsConfig extracts arbitrary safe graphics keys and importSharedConfigFile backs up existing file", () => {
  const parsed = parseGraphicsConfig(
    "[Performance]\nCharacterQuality=3\nEnvironmentQuality=2\nCrowdDensity=High\nAccountToken=SECRET\n",
  );
  assert.equal(parsed.details?.Characterquality, "3");
  assert.equal(parsed.details?.Environmentquality, "2");
  assert.equal(parsed.details?.Crowddensity, "High");
  assert.equal(JSON.stringify(parsed).includes("SECRET"), false);

  const localBase = process.env.LOCALAPPDATA || dir;
  const sub = path.join(localBase, "GVImportTest");
  const prevExisted = fs.existsSync(sub);
  try {
    fs.mkdirSync(sub, { recursive: true });
    const targetFile = path.join(sub, "settings.ini");
    fs.writeFileSync(targetFile, "Old=1\n", "utf8");
    const hint = toPortableFolderHint(targetFile);
    assert.ok(hint.includes("%LOCALAPPDATA%") || hint.includes("GVImportTest"));

    const res = importSharedConfigFile(hint, "settings.ini", "New=2\n");
    assert.equal(fs.readFileSync(res.importedPath, "utf8"), "New=2\n");
    assert.ok(res.backupPath && fs.existsSync(res.backupPath));
    assert.equal(fs.readFileSync(res.backupPath, "utf8"), "Old=1\n");

    assert.throws(
      () => importSharedConfigFile(hint, "../evil.ini", "x=1"),
      /Invalid configuration/,
    );
    assert.throws(
      () => importSharedConfigFile(hint, "settings.ini", "Password=123"),
      /credential/,
    );
  } finally {
    if (!prevExisted) fs.rmSync(sub, { recursive: true, force: true });
  }
});
