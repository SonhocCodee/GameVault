import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parsePresentMonCsv, percentileSorted, FpsMonitor } from '../src/main/fps-monitor.ts';
import {
  initDb,
  closeDb,
  createGame,
  createSession,
  updateSessionFps,
  getSessions,
  getFpsLeaderboard,
} from '../src/main/db.ts';

// Builds a synthetic PresentMon --v1_metrics CSV with the given frame times (ms)
function buildV1Csv(frameTimes) {
  const header =
    'ApplicationPresentTime,SyncInterval,PresentBatch,UntilDisplayed,InPresent,AllowedTearing,' +
    'MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,MsUntilRenderComplete,MsUntilDisplayed,MsBetweenAppPresent';
  const rows = frameTimes.map(
    (ft, i) => `1320900000000000${i}.000000,0,0,0.000000,0.000000,0,${ft.toFixed(6)},${ft.toFixed(6)},0.000000,0.000000,0.000000,${ft.toFixed(6)}`
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

// Builds a synthetic PresentMon v2 default CSV (the Adrenalin-bundled build
// records every presenting process; GameVault filters rows client-side)
function buildV2Csv(entries) {
  // entries: Array<{ app: string, pid: number, ft: number }>
  const header =
    'Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,' +
    'PresentMode,CPUStartTime,FrameTime,CPUBusy,CPUWait,GPULatency,GPUTime,GPUBusy,GPUWait,' +
    'DisplayLatency,DisplayedTime,AnimationError,ClickToPhotonLatency';
  const rows = entries.map(
    (e, i) =>
      `${e.app},${e.pid},0x1,0,0,0,0,Composed Flip,2026-11-21 10:00:0${i % 10}.000,${e.ft.toFixed(6)},1.0,0.5,0.2,4.0,3.0,0.1,1.0,16.9,0.0,8.0`
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

describe('PresentMon CSV Parser', () => {
  it('computes average FPS, samples and 1% low from a v1 metrics CSV', () => {
    const frameTimes = Array(9).fill(16.6667).concat([33.3333]); // 9x60fps drops + 1x30fps
    const metrics = parsePresentMonCsv(buildV1Csv(frameTimes));

    assert.ok(metrics, 'metrics should be parsed');
    assert.equal(metrics.fps_samples, 10);

    const mean = (9 * 16.6667 + 33.3333) / 10;
    assert.ok(Math.abs(metrics.fps_avg - 1000 / mean) < 0.01, `avg fps ${metrics.fps_avg} vs ${1000 / mean}`);
    // 10 samples, p99 nearest-rank -> worst frame time (33.3333ms)
    assert.ok(Math.abs(metrics.fps_1pct_low - 30.0) < 0.01, `1% low ${metrics.fps_1pct_low}`);
  });

  it('uses all presented frames including dropped ones (v1 semantics)', () => {
    const frameTimes = Array(99).fill(16.6667).concat([100]); // one long stall
    const metrics = parsePresentMonCsv(buildV1Csv(frameTimes));
    assert.equal(metrics.fps_samples, 100);
    assert.ok(Math.abs(metrics.fps_1pct_low - 10) < 0.01, `stall defines 1% low: ${metrics.fps_1pct_low}`);
  });

  it('returns null for CSV without frame-time column', () => {
    const csv = 'Foo,Bar\r\n1.0,2.0\r\n3.0,4.0\r\n';
    assert.equal(parsePresentMonCsv(csv), null);
  });

  it('returns null when there are too few frames', () => {
    const metrics = parsePresentMonCsv(buildV1Csv([16.6, 16.7, 16.8]), 10);
    assert.equal(metrics, null);
  });

  it('returns null for empty or header-only content', () => {
    assert.equal(parsePresentMonCsv(''), null);
    assert.equal(parsePresentMonCsv(buildV1Csv([])), null);
  });

  it('tolerates a BOM and mixed line endings', () => {
    const csv = '\uFEFF' + buildV1Csv(Array(12).fill(10));
    const metrics = parsePresentMonCsv(csv);
    assert.ok(metrics, 'BOM should be stripped');
    assert.ok(Math.abs(metrics.fps_avg - 100) < 0.01);
  });

  it('percentileSorted picks nearest-rank values from an ascending array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentileSorted(sorted, 0.99), 10);
    assert.equal(percentileSorted(sorted, 0.5), 5);
    assert.equal(percentileSorted([5], 0.99), 5);
    assert.ok(Number.isNaN(percentileSorted([], 0.5)));
  });

  it('parses v2 default CSV and filters rows by Application name', () => {
    // The game presents 60fps while a browser bursts 120fps in the background
    const entries = [];
    for (let i = 0; i < 30; i++) {
      entries.push({ app: 'Cyberpunk2077.exe', pid: 4242, ft: 16.6667 });
    }
    for (let i = 0; i < 60; i++) {
      entries.push({ app: 'msedge.exe', pid: 999, ft: 8.3333 });
    }
    const metrics = parsePresentMonCsv(buildV2Csv(entries), { applicationName: 'cyberpunk2077.exe' });

    assert.ok(metrics, 'metrics parsed from v2 CSV');
    assert.equal(metrics.fps_samples, 30, 'only game rows counted');
    assert.ok(Math.abs(metrics.fps_avg - 60) < 0.1, `avg ${metrics.fps_avg}`);
    assert.ok(Math.abs(metrics.fps_1pct_low - 60) < 0.1, '1% low equals avg for uniform frames');
  });

  it('falls back to ProcessID filter when Application name is missing', () => {
    const entries = [];
    for (let i = 0; i < 20; i++) {
      entries.push({ app: 'Game.exe', pid: 777, ft: 16.6667 });
      entries.push({ app: 'Other.exe', pid: 888, ft: 33.3333 });
    }
    const metrics = parsePresentMonCsv(buildV2Csv(entries), { applicationName: 'game.exe' });
    assert.ok(metrics, 'application filter matched');
    assert.equal(metrics.fps_samples, 20);
    assert.ok(Math.abs(metrics.fps_avg - 60) < 0.1);
  });

  it('returns null when the filtered target has too few frames', () => {
    const entries = [];
    for (let i = 0; i < 30; i++) {
      entries.push({ app: 'msedge.exe', pid: 999, ft: 8.3333 });
    }
    entries.push({ app: 'Cyberpunk2077.exe', pid: 4242, ft: 16.6667 });
    const metrics = parsePresentMonCsv(buildV2Csv(entries), { applicationName: 'Cyberpunk2077.exe' });
    assert.equal(metrics, null, 'single frame is below minSamples');
  });
});

describe('FPS session metrics persistence', () => {
  let gameId;
  let sessionIds = [];

  beforeEach(() => {
    initDb(':memory:');
    const game = createGame({ title: 'Cyberpunk 2077', exe_name: 'Cyberpunk2077.exe' });
    gameId = game.id;
    sessionIds = [];
  });

  afterEach(() => {
    closeDb();
  });

  it('updateSessionFps stores fps_avg, samples and 1% low on the session row', () => {
    const s = createSession({ game_id: gameId, start_time: '2026-11-20T20:00:00', end_time: '2026-11-20T21:00:00', duration_minutes: 60 });
    updateSessionFps(s.id, { fps_avg: 95.55, fps_samples: 123456, fps_1pct_low: 71.2 });

    const stored = getSessions(gameId)[0];
    assert.equal(stored.fps_avg, 95.6);
    assert.equal(stored.fps_samples, 123456);
    assert.equal(stored.fps_1pct_low, 71.2);
  });

  it('updateSessionFps ignores invalid values instead of throwing', () => {
    const s = createSession({ game_id: gameId, start_time: '2026-11-20T20:00:00' });
    assert.doesNotThrow(() => updateSessionFps(s.id, { fps_avg: NaN, fps_samples: 0, fps_1pct_low: -5 }));
    const stored = getSessions(gameId)[0];
    assert.equal(stored.fps_avg, null);
    assert.equal(stored.fps_samples, null);
  });

  it('updateSessionFps silently drops metrics for a deleted session', () => {
    assert.doesNotThrow(() => updateSessionFps(999999, { fps_avg: 60, fps_samples: 100 }));
  });
});

describe('FPS Leaderboard aggregation', () => {
  beforeEach(() => {
    initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  it('aggregates weighted average FPS per game ordered by performance', () => {
    const g1 = createGame({ title: 'Light Game', exe_name: 'light.exe' });
    const g2 = createGame({ title: 'Heavy Game', exe_name: 'heavy.exe' });

    // Light game: two sessions (100 FPS x 6000 frames, 50 FPS x 3000 frames) -> weighted 83.33
    const s1 = createSession({ game_id: g1.id, start_time: '2026-11-19T20:00:00', end_time: '2026-11-19T21:00:00', duration_minutes: 60 });
    updateSessionFps(s1.id, { fps_avg: 100, fps_samples: 6000, fps_1pct_low: 85 });
    const s2 = createSession({ game_id: g1.id, start_time: '2026-11-20T20:00:00', end_time: '2026-11-20T21:00:00', duration_minutes: 60 });
    updateSessionFps(s2.id, { fps_avg: 50, fps_samples: 3000, fps_1pct_low: 45 });

    // Heavy game: one session at 60 FPS x 9000 frames
    const s3 = createSession({ game_id: g2.id, start_time: '2026-11-20T22:00:00', end_time: '2026-11-20T23:00:00', duration_minutes: 60 });
    updateSessionFps(s3.id, { fps_avg: 60, fps_samples: 9000, fps_1pct_low: 52 });

    // Session without FPS data must not affect the aggregation
    createSession({ game_id: g2.id, start_time: '2026-11-21T10:00:00', end_time: '2026-11-21T11:00:00', duration_minutes: 60 });

    const board = getFpsLeaderboard();
    assert.equal(board.length, 2, 'only games with measured sessions appear');

    const light = board.find((e) => e.title === 'Light Game');
    const heavy = board.find((e) => e.title === 'Heavy Game');

    assert.ok(light, 'light game in leaderboard');
    assert.ok(heavy, 'heavy game in leaderboard');

    assert.ok(Math.abs(light.fps_avg - (100 * 6000 + 50 * 3000) / 9000) < 0.01, `weighted avg ${light.fps_avg}`);
    assert.equal(light.samples, 9000);
    assert.equal(light.sessions_with_fps, 2);
    assert.equal(light.best_fps, 100);
    assert.equal(light.worst_fps, 50);
    assert.ok(Math.abs(light.fps_1pct_low - (85 * 6000 + 45 * 3000) / 9000) < 0.01);

    assert.ok(Math.abs(heavy.fps_avg - 60) < 0.01);
    assert.equal(heavy.samples, 9000);

    assert.ok(board[0].fps_avg >= board[1].fps_avg, 'board sorted by FPS desc');
    assert.equal(board[0].game_id, g1.id, 'lighter game ranks first');
  });

  it('returns an empty list when no session has FPS data', () => {
    const g = createGame({ title: 'Unmeasured', exe_name: 'unmeasured.exe' });
    createSession({ game_id: g.id, start_time: '2026-11-20T20:00:00', end_time: '2026-11-20T21:00:00', duration_minutes: 60 });
    assert.deepEqual(getFpsLeaderboard(), []);
  });
});

describe('FpsMonitor lifecycle helpers', () => {
  it('reports status shape on Windows', () => {
    const monitor = new FpsMonitor();
    const status = monitor.getStatus();
    assert.equal(typeof status.platformSupported, 'boolean');
    assert.equal(typeof status.presentMonFound, 'boolean');
    assert.equal(typeof status.taskInstalled, 'boolean');
    assert.equal(typeof status.ready, 'boolean');
  });

  it('finishCapture without an active capture is a no-op', async () => {
    const monitor = new FpsMonitor();
    await assert.doesNotReject(() => monitor.finishCapture({ sessionId: 1 }));
  });
});
