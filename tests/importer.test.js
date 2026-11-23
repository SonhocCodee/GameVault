import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  createTestDb,
  createTempDirectory,
  cleanupTempDirectory,
  createMockAmdDatabase,
  extractTitleFromExe,
  hasRealAmdDatabase,
  REAL_AMD_PATH
} from './test-helpers.js';

describe('AMD Adrenalin 1-Click Importer Suite (R3)', () => {
  let db;
  let tempDir;
  let mockAmdPath;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_importer_test_');
    db = createTestDb(':memory:');
    mockAmdPath = path.join(tempDir, 'mock_RGStats.db');
    createMockAmdDatabase(mockAmdPath);
  });

  afterEach(() => {
    if (db) {
      try { db.close(); } catch {}
    }
    cleanupTempDirectory(tempDir);
  });

  // Importer Core Engine Reference Implementation
  function runImport(vaultDb, amdDbPath, options = {}) {
    if (!fs.existsSync(amdDbPath)) {
      throw new Error(`AMD Database file not found at: ${amdDbPath}`);
    }

    const amdDb = new DatabaseSync(amdDbPath, { readOnly: true });
    const games = amdDb.prepare('SELECT * FROM InstalledGames').all();
    const sessions = amdDb.prepare('SELECT * FROM GameSessions').all();
    amdDb.close();

    const insertGame = vaultDb.prepare(`
      INSERT INTO games (
        title, exe_name, exe_path, playtime_minutes, steam_id, uplay_id, origin_id, amd_game_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(title) DO UPDATE SET
        playtime_minutes = excluded.playtime_minutes,
        amd_game_id = excluded.amd_game_id,
        updated_at = datetime('now', 'localtime')
    `);

    let importedGames = 0;
    const gameIdMap = new Map(); // amdGameId -> vaultGameId

    for (const g of games) {
      if (options.excludeUtilities && (g.Title?.toLowerCase().includes('ollama') || g.ExePath?.toLowerCase().includes('crosshair'))) {
        continue;
      }

      let title = g.Title ? g.Title.trim() : '';
      if (!title) {
        title = extractTitleFromExe(g.ExePath);
      }

      const exeName = g.ExePath ? path.basename(g.ExePath) : '';
      const playtime = Number(g.PlayTotal) || 0;

      insertGame.run(
        title,
        exeName,
        g.ExePath,
        playtime,
        g.SteamID,
        g.UplayID,
        g.OriginID,
        g.GameID
      );

      const vaultGame = vaultDb.prepare('SELECT id FROM games WHERE title = ?').get(title);
      if (vaultGame) {
        gameIdMap.set(g.GameID, vaultGame.id);
      }
      importedGames++;
    }

    // Sessions import
    let importedSessions = 0;
    const insertSession = vaultDb.prepare(`
      INSERT INTO sessions (game_id, pid, start_time, end_time, duration_minutes, is_running, source)
      VALUES (?, ?, ?, ?, ?, ?, 'amd_import')
    `);

    for (const s of sessions) {
      const vaultGameId = gameIdMap.get(s.GameID);
      if (!vaultGameId) continue;

      // Normalize timestamps: replace space with T if needed
      const startTime = s.Start.replace(' ', 'T');
      const endTime = s.End ? s.End.replace(' ', 'T') : null;

      let duration = 0;
      if (startTime && endTime) {
        const startMs = new Date(startTime).getTime();
        const endMs = new Date(endTime).getTime();
        if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
          duration = Math.round((endMs - startMs) / 60000);
        }
      }

      insertSession.run(
        vaultGameId,
        s.PID,
        startTime,
        endTime,
        duration,
        s.IsRunning ? 1 : 0
      );
      importedSessions++;
    }

    return { importedGames, importedSessions };
  }

  // TIER 1: FEATURE COVERAGE (R3)
  describe('Tier 1: Feature Coverage (R3 AMD Import)', () => {
    it('R3-1: extracts game records with correct fields and converts PlayTotal to minutes', () => {
      const result = runImport(db, mockAmdPath);
      assert.equal(result.importedGames, 5);

      const pbz = db.prepare('SELECT * FROM games WHERE title = ?').get('Phantom Blade Zero');
      assert.ok(pbz, 'Phantom Blade Zero must be imported');
      assert.equal(pbz.playtime_minutes, 2232, 'Playtime must equal 2232 minutes (~37.2 hours)');
      assert.equal(pbz.steam_id, 4115450);
      assert.equal(pbz.amd_game_id, 65);
      assert.equal(pbz.exe_name, 'PBZ.exe');

      const onimusha = db.prepare('SELECT * FROM games WHERE title = ?').get('Onimusha: The Way of the Sword');
      assert.ok(onimusha);
      assert.equal(onimusha.playtime_minutes, 747);
      assert.equal(onimusha.steam_id, 2638890);
    });

    it('R3-2: extracts sessions and normalizes heterogeneous timestamp formats', () => {
      runImport(db, mockAmdPath);
      const pbz = db.prepare('SELECT id FROM games WHERE title = ?').get('Phantom Blade Zero');
      const sessions = db.prepare('SELECT * FROM sessions WHERE game_id = ? ORDER BY start_time ASC').all(pbz.id);

      assert.equal(sessions.length, 2, 'Should import 2 sessions for PBZ');
      assert.equal(sessions[0].start_time, '2026-10-29T19:50:00.000');
      assert.equal(sessions[0].end_time, '2026-10-29T20:30:00');
      assert.equal(sessions[0].duration_minutes, 40);
      assert.equal(sessions[0].source, 'amd_import');
    });

    it('R3-3: synthesizes clean game title when Title field is empty in RGStats.db', () => {
      runImport(db, mockAmdPath);
      // In mock DB: GameID 50 had empty title and ExePath '...\\Cyberpunk2077.exe'
      const synthesized = db.prepare('SELECT * FROM games WHERE amd_game_id = 50').get();
      assert.ok(synthesized, 'Game with empty title must be imported');
      assert.equal(synthesized.title, 'Cyberpunk 2077');
    });

    it('R3-4: achieves strict idempotency across multiple import executions', () => {
      // First run
      const first = runImport(db, mockAmdPath);
      assert.equal(first.importedGames, 5);

      const countBefore = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
      assert.equal(countBefore, 5);

      // Second run (re-import)
      const second = runImport(db, mockAmdPath);
      const countAfter = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
      assert.equal(countAfter, 5, 'Game count must remain identical after re-import');

      const pbz = db.prepare('SELECT playtime_minutes FROM games WHERE title = ?').get('Phantom Blade Zero');
      assert.equal(pbz.playtime_minutes, 2232);
    });

    it('R3-5: filters or isolates non-game desktop applications when requested', () => {
      const result = runImport(db, mockAmdPath, { excludeUtilities: true });
      assert.equal(result.importedGames, 4, 'Utility apps like Ollama must be filtered out');

      const ollama = db.prepare('SELECT * FROM games WHERE title LIKE ?').get('%Ollama%');
      assert.equal(ollama, undefined);
    });
  });

  // TIER 2: BOUNDARY & CORNER CASES
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2-1: throws clear error when AMD database file does not exist', () => {
      assert.throws(() => {
        runImport(db, path.join(tempDir, 'non_existent_file.db'));
      }, /not found/i);
    });

    it('T2-2: handles empty AMD database tables gracefully', () => {
      const emptyDbPath = path.join(tempDir, 'empty_RGStats.db');
      const emptyDb = new DatabaseSync(emptyDbPath);
      emptyDb.exec(`
        CREATE TABLE InstalledGames('GameID' INTEGER PRIMARY KEY, 'ExePath' VARCHAR, 'Title' VARCHAR, 'SteamID' INTEGER, 'UplayID' INTEGER, 'OriginID' INTEGER, 'PlayTotal' INTEGER);
        CREATE TABLE GameSessions('GameID' INTEGER, 'PID' INTEGER, 'Start' DATETIME, 'End' DATETIME, 'IsRunning' BOOLEAN);
      `);
      emptyDb.close();

      const result = runImport(db, emptyDbPath);
      assert.equal(result.importedGames, 0);
      assert.equal(result.importedSessions, 0);
    });

    it('T2-3: handles title extraction from various irregular executable names', () => {
      assert.equal(extractTitleFromExe('C:\\Games\\DoomEternal-Win64-Shipping.exe'), 'Doom Eternal');
      assert.equal(extractTitleFromExe('D:\\Steam\\steamapps\\common\\DeadSpace\\DeadSpace.exe'), 'Dead Space');
      assert.equal(extractTitleFromExe('E:\\Epic\\wwzRetailEgs.exe'), 'wwz');
      assert.equal(extractTitleFromExe(''), 'Unknown Game');
      assert.equal(extractTitleFromExe(null), 'Unknown Game');
    });
  });

  // TIER 4: REAL-WORLD AMD DATABASE SCENARIO
  describe('Tier 4: Real-World RGStats.db Verification', () => {
    it('T4-1: validates real AMD Adrenalin database at C:\\Users\\MacPro\\AppData\\Local\\AMD\\CN\\RGStats.db', (t) => {
      if (!hasRealAmdDatabase()) {
        t.skip('Real AMD database not present on this machine');
        return;
      }

      const amdDb = new DatabaseSync(REAL_AMD_PATH, { readOnly: true });

      // Verify exact counts established in survey
      const gameCount = amdDb.prepare('SELECT COUNT(*) as c FROM InstalledGames').get().c;
      const sessionCount = amdDb.prepare('SELECT COUNT(*) as c FROM GameSessions').get().c;

      assert.ok(gameCount >= 68, `Real AMD database must contain at least 68 games (got ${gameCount})`);
      assert.ok(sessionCount >= 1474, `Real AMD database must contain at least 1,474 sessions (got ${sessionCount})`);

      // Verify specific game metadata
      const pbz = amdDb.prepare('SELECT * FROM InstalledGames WHERE GameID = 65').get();
      assert.equal(pbz.Title, 'Phantom Blade Zero');
      assert.equal(pbz.SteamID, 4115450);
      assert.equal(pbz.PlayTotal, 2232);

      const onimusha = amdDb.prepare('SELECT * FROM InstalledGames WHERE GameID = 68').get();
      assert.equal(onimusha.Title, 'Onimusha: The Way of the Sword');
      assert.ok(onimusha.PlayTotal >= 747);

      const crimson = amdDb.prepare('SELECT * FROM InstalledGames WHERE GameID = 3').get();
      assert.equal(crimson.Title, 'Crimson Desert');
      assert.equal(crimson.PlayTotal, 216);

      amdDb.close();

      // Test real import into GameVault
      const vaultDb = createTestDb(':memory:');
      const importStats = runImport(vaultDb, REAL_AMD_PATH);
      assert.ok(importStats.importedGames >= 68);
      assert.ok(importStats.importedSessions >= 1474);

      const pbzVault = vaultDb.prepare('SELECT * FROM games WHERE amd_game_id = 65').get();
      assert.equal(pbzVault.title, 'Phantom Blade Zero');
      assert.equal(pbzVault.playtime_minutes, 2232);
      vaultDb.close();
    });
  });
});
