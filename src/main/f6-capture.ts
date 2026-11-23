import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const execAsync = promisify(exec);
import {
  getDb,
  recordPendingF6Capture,
  getUnmatchedF6Captures,
  markF6CaptureMatched,
  recordScreenshotSync,
} from './db.ts';
import { getForegroundProcessInfo, getTracker } from './tracker.ts';
import {
  copyAndUnlink,
  parseScreenshotTimestamp,
  DEFAULT_SCREENSHOTS_DIR,
  DEFAULT_MEDIA_DIR,
  SUPPORTED_EXTENSIONS,
} from './sync-screenshots.ts';
import { ensureGameFolder } from './media.ts';
import type { Game } from '../shared/types.js';

let win32Ready = false;
let GetAsyncKeyState: any = null;

try {
  if (process.platform === 'win32') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    GetAsyncKeyState = user32.func('GetAsyncKeyState', 'int16', ['int']);
    win32Ready = true;
  }
} catch {
  win32Ready = false;
}

export interface F6SyncResult {
  file: string;
  gameTitle: string;
  targetPath: string;
  timestamp: string;
}

export class F6CaptureManager {
  private db: DatabaseSync;
  public screenshotsDir: string;
  public mediaDir: string;
  public isF6Down: boolean = false;
  public isEnabled: boolean = true;
  public hddMode: boolean = true;
  public hotkeyVk: number = 0x75; // VK_F6
  public hotkeyName: string = 'F6';
  private pollInterval: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private syncDebounceTimer: NodeJS.Timeout | null = null;

  public onScreenshotSynced?: (result: F6SyncResult) => void;
  public onF6Captured?: (info: { gameTitle: string; timestamp: Date }) => void;

  constructor(
    customDb?: DatabaseSync,
    screenshotsDir: string = DEFAULT_SCREENSHOTS_DIR,
    mediaDir: string = DEFAULT_MEDIA_DIR
  ) {
    this.db = customDb || getDb();
    this.screenshotsDir = screenshotsDir;
    this.mediaDir = mediaDir;
  }

  public setHotkey(keyName: string, vk?: number): void {
    this.hotkeyName = keyName;
    if (vk !== undefined && !isNaN(vk)) {
      this.hotkeyVk = vk;
    }
    console.log(`[F6Capture] Hotkey set to ${keyName} (VK: 0x${this.hotkeyVk.toString(16)})`);
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.isF6Down = false;
    }
    console.log(`[F6Capture] Hotkey capture ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  public setPaths(screenshotsDir?: string, mediaDir?: string): void {
    if (screenshotsDir && screenshotsDir !== this.screenshotsDir) {
      this.screenshotsDir = screenshotsDir;
      if (this.watcher) {
        try {
          this.watcher.close();
        } catch {}
        this.watcher = null;
        this.startWatcher();
      }
    }
    if (mediaDir) {
      this.mediaDir = mediaDir;
    }
  }

  public setHddMode(mode: boolean): void {
    this.hddMode = mode;
    console.log(`[F6Capture] HDD Mode ${mode ? 'ENABLED (buffer & sync)' : 'DISABLED (direct save / SSD)'}`);
  }

  /**
   * Directly captures primary screen and saves directly to the game's media folder
   * without creating temporary buffer files, optimizing SSD endurance.
   */
  public async captureDirectToGameFolder(
    gameId: number,
    gameTitle: string,
    now: Date = new Date(),
    captureId?: number
  ): Promise<F6SyncResult | null> {
    try {
      const { fullPath: destFolder } = ensureGameFolder(gameTitle, this.mediaDir);
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `Screenshot-F6-${timeStr}.png`;
      const targetPath = path.join(destFolder, filename);

      const psScript = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${targetPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
`.trim();

      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`);

      if (fs.existsSync(targetPath)) {
        if (captureId) {
          markF6CaptureMatched(captureId, this.db);
        }
        recordScreenshotSync(
          {
            game_id: gameId,
            original_filename: filename,
            target_path: targetPath,
            file_timestamp: now.toISOString(),
          },
          this.db
        );

        const resultItem: F6SyncResult = {
          file: filename,
          gameTitle,
          targetPath,
          timestamp: now.toISOString(),
        };

        if (this.onScreenshotSynced) {
          this.onScreenshotSynced(resultItem);
        }

        console.log(`[F6Capture] Direct SSD capture saved: ${targetPath}`);
        return resultItem;
      }
    } catch (err) {
      // Direct capture fallback to buffer watcher
      console.warn('[F6Capture] Direct capture fell back to watcher:', err);
    }
    return null;
  }

  /**
   * Starts periodic polling for configured hotkey and file watching on screenshots directory.
   */
  public start(pollMs: number = 50): void {
    if (this.pollInterval) return;

    if (win32Ready && GetAsyncKeyState) {
      this.pollInterval = setInterval(() => {
        this.pollKey();
      }, pollMs);
    }

    this.startWatcher();
  }

  /**
   * Stops polling and closes file watchers.
   */
  public stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = null;
    }
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
  }

  /**
   * Polls the physical state of the configured hotkey.
   * Triggers handleF6Down on keydown transition (low-to-high).
   */
  public pollKey(): void {
    if (!this.isEnabled || !GetAsyncKeyState) return;
    try {
      const state = GetAsyncKeyState(this.hotkeyVk);
      const isDown = (state & 0x8000) !== 0;

      if (isDown && !this.isF6Down) {
        this.isF6Down = true;
        this.handleF6Down();
      } else if (!isDown && this.isF6Down) {
        this.isF6Down = false;
      }
    } catch {
      // Non-throwing guarantee
    }
  }

  /**
   * Evaluates foreground window at the exact moment F6 is pressed.
   * If a game is active, records a pending capture event in SQLite.
   * If not a game, ignores to prevent non-game screenshots from being synced.
   */
  public handleF6Down(now: Date = new Date()): { gameTitle: string; timestamp: Date } | null {
    const fg = getForegroundProcessInfo();
    const tracker = getTracker();

    let activeGame: Game | null = null;

    if (tracker.activeSession) {
      // Currently tracking an active session
      activeGame = tracker.findGameByProcess(fg.exeName) || {
        id: tracker.activeSession.gameId,
        title: tracker.activeSession.gameTitle,
      } as Game;
    } else if (fg.exeName) {
      activeGame = tracker.findGameByProcess(fg.exeName);
      if (!activeGame && tracker.autoDetectNewGames && !tracker.isSystemProcess(fg.exeName) && !tracker.isPathIgnored(fg.exePath)) {
        activeGame = tracker.autoRegisterNewGame(fg.exeName, fg.exePath);
      }
    }

    if (activeGame) {
      const timestampIso = now.toISOString();
      const captureId = recordPendingF6Capture(activeGame.id, activeGame.title, timestampIso, this.db);
      console.log(`[F6Capture] Logged capture token for "${activeGame.title}" at ${timestampIso} (HDD Mode: ${this.hddMode ? 'ON' : 'OFF'})`);

      if (this.onF6Captured) {
        this.onF6Captured({ gameTitle: activeGame.title, timestamp: now });
      }

      // If HDD Mode is disabled (SSD mode), attempt direct capture to avoid double-writes
      if (!this.hddMode && process.platform === 'win32') {
        this.captureDirectToGameFolder(activeGame.id, activeGame.title, now, captureId);
      }

      // Proactively schedule sync sweeps to pick up file as soon as screenshot tool writes it
      setTimeout(() => this.scanAndSync(), 400);
      setTimeout(() => this.scanAndSync(), 1200);
      setTimeout(() => this.scanAndSync(), 2500);

      return { gameTitle: activeGame.title, timestamp: now };
    }

    console.log(
      `[F6Capture] F6 pressed, but active foreground "${fg.exeName || 'Desktop'}" is not a game. Skipping capture queue.`
    );
    return null;
  }

  /**
   * Sets up directory watcher on screenshots folder.
   */
  private startWatcher(): void {
    if (!fs.existsSync(this.screenshotsDir)) {
      return;
    }

    try {
      this.watcher = fs.watch(this.screenshotsDir, (_eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) return;

        if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
        this.syncDebounceTimer = setTimeout(() => {
          this.scanAndSync();
        }, 500);
      });
    } catch (err) {
      console.warn('[F6Capture] Could not watch screenshots dir:', err);
    }
  }

  /**
   * Scans screenshots directory and matches files with pending F6 capture records.
   * Only files matching a recorded F6 capture timestamp (within tolerance) will be moved!
   */
  public scanAndSync(toleranceMs: number = 20000): F6SyncResult[] {
    if (!fs.existsSync(this.screenshotsDir)) return [];

    // Check the queue FIRST: with nothing pending, return before touching the
    // media drive root — a bare existsSync on E:\ wakes a sleeping HDD
    const unmatchedCaptures = getUnmatchedF6Captures(this.db);
    if (!unmatchedCaptures || unmatchedCaptures.length === 0) {
      return [];
    }

    // If target HDD drive is offline or unmounted, keep queue and files safe on C:
    const targetRoot = path.parse(this.mediaDir).root;
    if (targetRoot && !fs.existsSync(targetRoot)) {
      console.warn(`[F6Capture] Target media drive (${targetRoot}) is offline. Retaining screenshots safely on C:`);
      return [];
    }

    let files: string[] = [];
    try {
      files = fs.readdirSync(this.screenshotsDir);
    } catch {
      return [];
    }

    const syncedResults: F6SyncResult[] = [];

    for (const filename of files) {
      const ext = path.extname(filename).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const fullPath = path.join(this.screenshotsDir, filename);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory() || stat.size === 0) continue;

      const fileTime = parseScreenshotTimestamp(filename, stat.mtime);
      if (!fileTime) continue;
      const fileMs = fileTime.getTime();

      // Find the closest pending capture for this file
      let bestCaptureIndex = -1;
      let minDiff = Infinity;

      for (let i = 0; i < unmatchedCaptures.length; i++) {
        const capture = unmatchedCaptures[i];
        const captureMs = new Date(capture.timestamp).getTime();
        const diff = Math.abs(fileMs - captureMs);

        if (diff <= toleranceMs && diff < minDiff) {
          minDiff = diff;
          bestCaptureIndex = i;
        }
      }

      if (bestCaptureIndex >= 0) {
        const capture = unmatchedCaptures[bestCaptureIndex];

        // Wishlist ('Chờ chơi') games have no media folder yet — keep the
        // capture queued until the game actually runs and is promoted
        let captureGameStatus: string | null = null;
        try {
          const row = this.db
            .prepare('SELECT status FROM games WHERE id = ?')
            .get(capture.game_id) as any;
          captureGameStatus = row?.status ?? null;
        } catch {}
        if (captureGameStatus === 'backlog') {
          continue;
        }

        try {
          const { fullPath: destFolder } = ensureGameFolder(capture.game_title, this.mediaDir);
          const moveRes = copyAndUnlink(fullPath, destFolder, filename);

          // Mark capture matched
          markF6CaptureMatched(capture.id, this.db);

          // Record in sync history
          recordScreenshotSync(
            {
              game_id: capture.game_id,
              original_filename: filename,
              target_path: moveRes.targetPath,
              file_timestamp: fileTime.toISOString(),
            },
            this.db
          );

          const resultItem: F6SyncResult = {
            file: filename,
            gameTitle: capture.game_title,
            targetPath: moveRes.targetPath,
            timestamp: fileTime.toISOString(),
          };

          syncedResults.push(resultItem);

          if (this.onScreenshotSynced) {
            this.onScreenshotSynced(resultItem);
          }

          // Remove matched capture from in-memory pool so it won't match multiple files
          unmatchedCaptures.splice(bestCaptureIndex, 1);
        } catch (err) {
          console.error(`[F6Capture] Failed to sync ${filename} for ${capture.game_title}:`, err);
        }
      }
    }

    return syncedResults;
  }

  public getStatus() {
    const unmatchedCaptures = getUnmatchedF6Captures(this.db);
    return {
      isEnabled: this.isEnabled,
      hddMode: this.hddMode,
      hotkey: this.hotkeyName,
      hotkeyVk: this.hotkeyVk,
      screenshotsDir: this.screenshotsDir,
      mediaDir: this.mediaDir,
      isListening: this.pollInterval !== null && this.isEnabled,
      isWatcherActive: this.watcher !== null,
      pendingCapturesCount: unmatchedCaptures.length,
      pendingCaptures: unmatchedCaptures,
    };
  }
}

let globalF6Manager: F6CaptureManager | null = null;

export function getF6CaptureManager(): F6CaptureManager {
  if (!globalF6Manager) {
    globalF6Manager = new F6CaptureManager();
  }
  return globalF6Manager;
}
