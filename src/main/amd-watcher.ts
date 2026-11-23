import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_AMD_DB_PATH, importAMDDatabase } from './importer.ts';
import { ensureGameFolder } from './media.ts';
import { autoEnrichAllGameCovers } from './covers.ts';
import { getDb } from './db.ts';
import type { Game } from '../shared/types.ts';

export class AMDWatcher {
  private amdDbPath: string;
  private blbPath: string;
  private targetDb?: any;
  private lastDbMtime: number = 0;
  private lastBlbMtime: number = 0;
  private checkInterval: NodeJS.Timeout | null = null;
  public onGameAdded?: (game: Game) => void;
  public onPlaytimeUpdated?: (info: { gameTitle: string; totalMinutes: number }) => void;

  constructor(customPath?: string, targetDb?: any) {
    this.amdDbPath = customPath || DEFAULT_AMD_DB_PATH;
    this.blbPath = path.join(path.dirname(this.amdDbPath), 'gmdb.blb');
    this.targetDb = targetDb;
  }

  /**
   * Checks if AMD database or profile cache has been modified,
   * and synchronizes new games, playtimes, and sessions.
   */
  public checkAndSync(customVaultDb?: any): { newlyImported: number; updated: boolean } {
    if (!fs.existsSync(this.amdDbPath)) {
      return { newlyImported: 0, updated: false };
    }

    let changed = false;
    try {
      const dbStat = fs.statSync(this.amdDbPath);
      if (dbStat.mtimeMs > this.lastDbMtime) {
        this.lastDbMtime = dbStat.mtimeMs;
        changed = true;
      }
    } catch {}

    try {
      if (fs.existsSync(this.blbPath)) {
        const blbStat = fs.statSync(this.blbPath);
        if (blbStat.mtimeMs > this.lastBlbMtime) {
          this.lastBlbMtime = blbStat.mtimeMs;
          changed = true;
        }
      }
    } catch {}

    if (!changed) {
      return { newlyImported: 0, updated: false };
    }

    const db = customVaultDb || this.targetDb || getDb();
    // Snapshot existing game titles and playtimes before import
    const existingMap = new Map<string, number>();
    try {
      const rows = db.prepare('SELECT title, playtime_minutes FROM games').all() as any[];
      for (const r of rows) {
        existingMap.set(r.title.toLowerCase().trim(), r.playtime_minutes || 0);
      }
    } catch {}

    // Execute safe, read-only AMD import
    const summary = importAMDDatabase(this.amdDbPath, { excludeUtilities: true, targetDb: db });

    // Check for newly imported games and playtime changes
    let newlyAdded = 0;
    try {
      const currentGames = db.prepare('SELECT * FROM games').all() as any[];
      for (const g of currentGames) {
        const key = g.title.toLowerCase().trim();
        if (!existingMap.has(key)) {
          newlyAdded++;
          // Brand new game detected from AMD!
          // Wishlist games keep cover/banner only — no media folder until they actually run
          if (g.status !== 'backlog') {
            try {
              ensureGameFolder(g.title);
            } catch {}
          }
          if (this.onGameAdded) {
            this.onGameAdded(g);
          }
        } else if (g.playtime_minutes > (existingMap.get(key) || 0)) {
          // Playtime updated in AMD
          if (g.status === 'backlog') {
            // The wishlist game has real playtime now: promote to 'playing', then create folder
            try {
              db.prepare(`
                UPDATE games
                SET status = 'playing', updated_at = datetime('now', 'localtime')
                WHERE id = ?
              `).run(g.id);
              try {
                ensureGameFolder(g.title);
              } catch {}
              g.status = 'playing';
            } catch {}
          }
          if (this.onPlaytimeUpdated) {
            this.onPlaytimeUpdated({ gameTitle: g.title, totalMinutes: g.playtime_minutes });
          }
        }
      }
    } catch {}

    // Cover enrichment is event-driven: only when a brand-new game appeared.
    // Startup + the 6h re-scan in main.ts handle the rest — enriching after
    // every mtime change would stat game folders (often on a sleeping HDD)
    // every 5 seconds while a game is running.
    if (newlyAdded > 0) {
      try {
        autoEnrichAllGameCovers(db);
      } catch {}
    }

    return { newlyImported: summary.importedGames, updated: true };
  }

  /**
   * Starts periodic polling of AMD database changes (default every 5 seconds).
   */
  public start(intervalMs: number = 5000): void {
    if (this.checkInterval) return;
    // Initial check and sync
    try {
      this.checkAndSync();
    } catch {}

    this.checkInterval = setInterval(() => {
      try {
        this.checkAndSync();
      } catch {}
    }, intervalMs);
  }

  /**
   * Stops polling.
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

let amdWatcherInstance: AMDWatcher | null = null;
export function getAMDWatcher(): AMDWatcher {
  if (!amdWatcherInstance) {
    amdWatcherInstance = new AMDWatcher();
  }
  return amdWatcherInstance;
}
