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
  mergeFragmentedSessions,
} from "../src/main/db.ts";
import { validatePerformanceReport } from "../worker/src/routes/discovery.ts";
import {
  configPathsForGame,
  parseGraphicsConfig,
  registerManualConfig,
  detectGameConfigs,
  exportGameSettings,
  makeSettingsZip,
} from "../src/main/game-settings.ts";
import {
  capturePerformanceContext,
  getPerformancePreview,
  saveGameGraphics,
  prepareMeasuredReport,
  compatibleFpsAverage,
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
