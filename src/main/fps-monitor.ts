import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, getDbDir, getSetting, updateSessionFps } from './db.ts';
import { findPresentMon, downloadPresentMon, getManagedPresentMonPath } from './presentmon.ts';
import type { FpsStatus } from '../shared/types.js';

const TASK_NAME = 'GameVaultFPS';

export interface FpsMetrics {
  fps_avg: number;
  fps_samples: number;
  fps_1pct_low: number | null;
}

export interface FpsSetupResult {
  ok: boolean;
  taskCreated: boolean;
  error?: string;
}

/** Info about the session whose frames are being captured right now. */
interface ActiveCapture {
  sessionId: number;
  csvPath: string;
  stopPath: string;
  donePath: string;
  startedAt: Date;
  exeName: string | null;
}

/** Minimal session shape needed to start a capture. */
export interface CaptureTarget {
  sessionId: number;
  exeName?: string | null;
  processId?: number | null;
}

/**
 * Splits one CSV line (PresentMon output has no quoted commas — plain split).
 */
function splitCsvLine(line: string): string[] {
  return line.split(',');
}

export interface CsvParseOptions {
  /** PresentMon v2 CSV records every presenting process — filter by the game's exe name. */
  applicationName?: string | null;
  /** Fallback filter: the game process id from the tracker session. */
  processId?: number | null;
}

/**
 * Parses a PresentMon CSV into aggregate FPS metrics. Supports both metric
 * layouts: v2 default columns (Application,ProcessID,...,FrameTime) and legacy
 * --v1_metrics columns (MsBetweenPresents). Average FPS = 1000 / mean frame
 * time; 1% low = 1000 / mean(worst 1% frame times) — the CapFrameX convention.
 * Returns null when the CSV is unusable or too sparse.
 */
export function parsePresentMonCsv(content: string, options: CsvParseOptions | number = {}, minSamples: number = 10): FpsMetrics | null {
  // Legacy numeric signature — minSamples passed as the second argument
  let min = minSamples;
  if (typeof options === 'number') {
    min = options;
    options = {};
  }
  const opts = (options || {}) as CsvParseOptions;

  if (!content) return null;
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return null;

  const header = splitCsvLine(lines[0].replace(/^\uFEFF/, ''))
    .map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));

  // Frame-time column: v2 default (FrameTime) or v1 (MsBetweenPresents)
  let timeIdx = header.indexOf('frametime');
  if (timeIdx < 0) timeIdx = header.indexOf('msbetweenpresents');
  if (timeIdx < 0) timeIdx = header.indexOf('msbetweendisplaychange');
  if (timeIdx < 0) return null;

  const appIdx = header.indexOf('application');
  const pidIdx = header.indexOf('processid');
  const wantApp = (opts.applicationName || '').toLowerCase();
  const wantPid = opts.processId != null && opts.processId > 0 ? Number(opts.processId) : null;
  const hasFilter = Boolean(wantApp) || wantPid !== null;

  const frameTimes: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (hasFilter) {
      let matched = false;
      if (wantApp && appIdx >= 0) {
        matched = (cols[appIdx] || '').trim().toLowerCase() === wantApp;
      }
      if (!matched && wantPid !== null && pidIdx >= 0) {
        matched = parseInt(cols[pidIdx], 10) === wantPid;
      }
      if (!matched) continue;
    }
    const v = parseFloat(cols[timeIdx]);
    if (Number.isFinite(v) && v > 0) {
      frameTimes.push(v);
    }
  }

  if (frameTimes.length < min) return null;

  const mean = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  if (!(mean > 0)) return null;

  // Worst 1% of frames (at least one) averaged, converted back to FPS
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
  let worstSum = 0;
  for (let i = sorted.length - worstCount; i < sorted.length; i++) {
    worstSum += sorted[i];
  }
  const worstMean = worstSum / worstCount;

  return {
    fps_avg: 1000 / mean,
    fps_samples: frameTimes.length,
    fps_1pct_low: worstMean > 0 ? 1000 / worstMean : null,
  };
}

/** Nearest-rank percentile of an ascending-sorted array. */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

/**
 * FPS capture orchestrator.
 *
 * PresentMon needs an ETW trace session (admin). Instead of elevating the whole
 * app, a one-time Scheduled Task ("GameVaultFPS", RunLevel Highest) starts
 * resources/fps-helper.ps1 elevated per capture: GameVault hands it a config
 * file, the helper drives PresentMon and signals completion back via files.
 */
export class FpsMonitor {
  private activeCapture: ActiveCapture | null = null;
  /** Session ids whose capture is being finalized — startCapture must skip
   *  them so a stale finish never deletes a fresh capture's handoff files. */
  private finishingSessions: Set<number> = new Set();

  public getStatus(): FpsStatus {
    const platformSupported = process.platform === 'win32';
    const presentMonPath = platformSupported ? findPresentMon() : null;
    const taskInstalled = platformSupported ? this.isTaskInstalled() : false;
    return {
      platformSupported,
      presentMonFound: Boolean(presentMonPath),
      presentMonPath,
      taskInstalled,
      ready: platformSupported && Boolean(presentMonPath) && taskInstalled,
    };
  }

  /**
   * Guarantees a PresentMon binary: returns an existing install or downloads
   * the official Intel release (needed on NVIDIA machines without AMD
   * Adrenalin's bundled copy). Returns the path, or null on failure.
   */
  public async ensurePresentMon(force: boolean = false): Promise<string | null> {
    if (process.platform !== 'win32') {
      return null;
    }
    return downloadPresentMon(force);
  }

  /**
   * One-time elevation setup: registers the Scheduled Task via a UAC prompt.
   * The task itself runs every future capture elevated with NO further prompts.
   */
  public async setupElevation(): Promise<FpsSetupResult> {
    if (process.platform !== 'win32') {
      return { ok: false, taskCreated: false, error: 'FPS measurement is only supported on Windows' };
    }
    const helperPath = this.resolveHelperPath();
    if (!helperPath) {
      return { ok: false, taskCreated: false, error: 'fps-helper.ps1 not found' };
    }
    if (this.isTaskInstalled()) {
      return { ok: true, taskCreated: true };
    }

    const workDir = getDbDir();
    fs.mkdirSync(workDir, { recursive: true });
    const setupPath = path.join(workDir, 'fps-task-setup.ps1');
    const configPath = this.getConfigPath();

    const launcherPath = this.resolveLauncherPath();
    const actionArgument = launcherPath
      ? `//nologo "${launcherPath}" "${helperPath}" "${configPath}"`
      : `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${helperPath}" -ConfigFile "${configPath}"`;
    const actionExecute = launcherPath ? 'wscript.exe' : 'powershell.exe';

    const setupScript = [
      "$ErrorActionPreference = 'Stop'",
      `$action = New-ScheduledTaskAction -Execute '${actionExecute}' ` +
        `-Argument '${actionArgument.replace(/'/g, "''")}'`,
      "$principal = New-ScheduledTaskPrincipal -UserId \"$env:USERDOMAIN\\$env:USERNAME\" " +
        '-LogonType Interactive -RunLevel Highest',
      "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries " +
        '-ExecutionTimeLimit (New-TimeSpan -Hours 24)',
      `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    ].join('\r\n');
    fs.writeFileSync(setupPath, setupScript, 'utf8');

    try {
      const exitCode = await this.runElevated(setupPath);
      if (exitCode !== 0) {
        return {
          ok: false,
          taskCreated: false,
          error: 'UAC prompt was declined or task registration failed (exit ' + exitCode + ')',
        };
      }
    } catch (err: any) {
      return { ok: false, taskCreated: false, error: String(err?.message || err) };
    } finally {
      try { fs.unlinkSync(setupPath); } catch {}
    }

    const created = this.isTaskInstalled();
    return { ok: created, taskCreated: created, error: created ? undefined : 'Scheduled task not found after setup' };
  }

  /**
   * Starts PresentMon capture for a tracker session (non-blocking; failures
   * only mean "no FPS for this session", never break or freeze the tracker).
   */
  public async startCapture(target: CaptureTarget): Promise<boolean> {
    if (process.platform !== 'win32' || !target?.sessionId || !target.exeName) {
      return false;
    }
    if (getSetting('fps_auto_capture_enabled') === 'false') return false;
    if (this.finishingSessions.has(target.sessionId)) {
      return false; // previous capture of this session is still being finalized
    }
    const status = this.getStatus();
    if (!status.ready || !status.presentMonPath) {
      return false;
    }

    try {
      const workDir = getDbDir();
      fs.mkdirSync(workDir, { recursive: true });
      this.cleanupStaleFiles(workDir, target.sessionId);

      const csvPath = path.join(workDir, `fps-session-${target.sessionId}.csv`);
      const stopPath = path.join(workDir, `fps-session-${target.sessionId}.stop`);
      const donePath = path.join(workDir, `fps-session-${target.sessionId}.done`);
      const configPath = this.getConfigPath();

      // Record ONLY the game's frames when we can: the official Intel
      // PresentMon handles --process_name correctly, which keeps a 2-hour
      // session's CSV at a few MB instead of hundreds (every process on
      // screen presents frames). The Adrenalin-bundled fork ignores/breaks
      // on targeting, so it keeps the record-all + filter-on-parse path.
      const useProcessTargeting = status.presentMonPath === getManagedPresentMonPath();

      const config = {
        sessionId: target.sessionId,
        processName: target.exeName,
        processId: target.processId != null && target.processId > 0 ? target.processId : null,
        useProcessTargeting,
        csvPath,
        stopPath,
        donePath,
        presentMon: status.presentMonPath,
      };
      fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

      // schtasks /run can transiently fail while a previous helper instance is
      // still finishing — retry asynchronously without blocking Electron's main thread
      let started = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const ok = await new Promise<boolean>((resolve) => {
          execFile('schtasks', ['/Run', '/TN', TASK_NAME], { windowsHide: true, timeout: 5000 }, (err) => {
            resolve(!err);
          });
        });
        if (ok) {
          started = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!started) {
        try { fs.unlinkSync(configPath); } catch {}
        console.warn('[fps] Failed to start GameVaultFPS task (is it registered?)');
        return false;
      }

      this.activeCapture = {
        sessionId: target.sessionId,
        csvPath,
        stopPath,
        donePath,
        startedAt: new Date(),
        exeName: target.exeName || null,
      };
      console.log(`[fps] Capture started for session ${target.sessionId} (${target.exeName})`);
      return true;
    } catch (err) {
      console.warn('[fps] startCapture failed:', err);
      return false;
    }
  }

  /**
   * Signals the helper to stop, waits for the finalized CSV, parses FPS metrics
   * and stores them on the session row. Safe to call fire-and-forget.
   */
  public async finishCapture(result: { sessionId?: number; discarded?: boolean }): Promise<void> {
    const db = getDb();
    const cap = this.activeCapture;
    if (!cap) return;
    if (result?.sessionId && result.sessionId !== cap.sessionId) return; // stale close event
    this.activeCapture = null;
    this.finishingSessions.add(cap.sessionId);

    try {
      if (result?.discarded) {
        this.removeFiles([cap.csvPath, cap.stopPath, cap.donePath]);
        return;
      }

      // Ask the elevated helper to terminate PresentMon
      try { fs.writeFileSync(cap.stopPath, 'stop', 'utf8'); } catch {}

      // Wait for the done signal (helper polls every 500ms + flush grace)
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline && !fs.existsSync(cap.donePath)) {
        await new Promise((r) => setTimeout(r, 250));
      }

      let metrics: FpsMetrics | null = null;
      try {
        if (fs.existsSync(cap.csvPath)) {
          // Record-all captures (Adrenalin fork) contain every presenting
          // process — filter rows down to the game by Application name.
          // Targeted captures only hold the game's rows, which also match.
          metrics = parsePresentMonCsv(fs.readFileSync(cap.csvPath, 'utf8'), {
            applicationName: cap.exeName,
          });
        }
      } catch (err) {
        console.warn('[fps] Failed to read/parse PresentMon CSV:', err);
      }

      if (metrics && getDb() === db) {
        updateSessionFps(cap.sessionId, {
          fps_avg: metrics.fps_avg,
          fps_samples: metrics.fps_samples,
          fps_1pct_low: metrics.fps_1pct_low,
        });
        console.log(
          `[fps] Session ${cap.sessionId}: avg ${metrics.fps_avg.toFixed(1)} FPS ` +
          `(${metrics.fps_samples} frames, 1% low ${metrics.fps_1pct_low?.toFixed(1) ?? 'n/a'})`
        );
      } else {
        console.log(`[fps] Session ${cap.sessionId}: no usable frame data (capture too short or helper absent)`);
      }

      this.removeFiles([cap.csvPath, cap.stopPath, cap.donePath]);
    } catch (err) {
      console.warn('[fps] finishCapture failed:', err);
      this.removeFiles([cap.csvPath, cap.stopPath, cap.donePath]);
    } finally {
      this.finishingSessions.delete(cap.sessionId);
    }
  }

  /** Removes leftover handoff files on app start (crash recovery). */
  public recoverOrphans(): void {
    if (process.platform !== 'win32') return;
    try {
      const workDir = getDbDir();
      this.cleanupStaleFiles(workDir, Number.POSITIVE_INFINITY);
    } catch {}
  }

  private getConfigPath(): string {
    return path.join(getDbDir(), 'fps-task.json');
  }

  private resolveHelperPath(): string | null {
    const candidates = [
      path.join(__dirname, '..', 'resources', 'fps-helper.ps1'),
      path.join(__dirname, '..', '..', 'resources', 'fps-helper.ps1'),
      path.join(__dirname, '..', '..', '..', 'resources', 'fps-helper.ps1'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }
    return null;
  }

  private resolveLauncherPath(): string | null {
    const candidates = [
      path.join(__dirname, '..', 'resources', 'fps-launcher.vbs'),
      path.join(__dirname, '..', '..', 'resources', 'fps-launcher.vbs'),
      path.join(__dirname, '..', '..', '..', 'resources', 'fps-launcher.vbs'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }
    return null;
  }

  private isTaskInstalled(): boolean {
    if (process.platform !== 'win32') return false;
    try {
      const res = spawnSync('schtasks', ['/Query', '/TN', TASK_NAME], { windowsHide: true });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  /** Runs a .ps1 elevated (one UAC prompt) and resolves with its exit code. */
  private runElevated(scriptPath: string): Promise<number> {
    const quoted = `'${scriptPath.replace(/'/g, "''")}'`;
    const command =
      `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', ${quoted}); ` +
      `if ($p) { exit $p.ExitCode } else { exit 1 }`;
    return new Promise((resolve, reject) => {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        windowsHide: true,
        stdio: 'ignore',
      })
        .on('exit', (code) => resolve(code ?? 1))
        .on('error', reject);
    });
  }

  private cleanupStaleFiles(workDir: string, keepSessionId: number): void {
    try {
      for (const name of fs.readdirSync(workDir)) {
        if (!/^fps-(session-\d+\.(csv|stop|done)|task\.json|task-setup\.ps1)$/.test(name)) continue;
        // Keep files belonging to the session we are about to capture
        const m = name.match(/^fps-session-(\d+)\./);
        if (m && Number(m[1]) === keepSessionId) continue;
        try { fs.unlinkSync(path.join(workDir, name)); } catch {}
      }
    } catch {}
  }

  private removeFiles(paths: string[]): void {
    for (const p of paths) {
      try { fs.unlinkSync(p); } catch {}
    }
  }
}

let globalFpsMonitor: FpsMonitor | null = null;

export function getFpsMonitor(): FpsMonitor {
  if (!globalFpsMonitor) {
    globalFpsMonitor = new FpsMonitor();
  }
  return globalFpsMonitor;
}
