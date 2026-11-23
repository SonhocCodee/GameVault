import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { AMDWatcher } from '../src/main/amd-watcher.ts';
import { getDb } from '../src/main/db.ts';
import { createTestDb, SCHEMA_SQL } from './test-helpers.js';

describe('AMD Adrenalin Real-time Live Watcher Suite', () => {
  let tmpDir;
  let mockAmdPath;
  let mockBlbPath;
  let mockVaultDb;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamevault_amd_watcher_test_'));
    mockAmdPath = path.join(tmpDir, 'RGStats.db');
    mockBlbPath = path.join(tmpDir, 'gmdb.blb');

    // Create a mock AMD database
    const amdDb = new DatabaseSync(mockAmdPath);
    amdDb.exec(`
      CREATE TABLE InstalledGames (
        GameID INTEGER PRIMARY KEY,
        ExePath TEXT,
        Title TEXT,
        SteamID INTEGER,
        UplayID INTEGER,
        OriginID INTEGER,
        PlayTotal INTEGER
      );
      CREATE TABLE GameSessions (
        SessionID INTEGER PRIMARY KEY AUTOINCREMENT,
        GameID INTEGER,
        Start TEXT,
        End TEXT,
        IsRunning INTEGER
      );
    `);

    // Insert an initial game
    amdDb.prepare(`
      INSERT INTO InstalledGames (GameID, ExePath, Title, SteamID, PlayTotal)
      VALUES (1, 'C:\\Games\\Hades\\Hades.exe', 'Hades', 1145360, 120)
    `).run();

    amdDb.close();

    // Create mock vault DB
    mockVaultDb = new DatabaseSync(':memory:');
    mockVaultDb.exec(SCHEMA_SQL);
  });

  after(() => {
    try {
      mockVaultDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('detects new games from AMD database when modified', () => {
    const watcher = new AMDWatcher(mockAmdPath, mockVaultDb);
    let capturedGame = null;
    watcher.onGameAdded = (g) => {
      capturedGame = g;
    };

    // First check should sync Hades
    const res1 = watcher.checkAndSync();
    assert.equal(res1.updated, true);
    assert.equal(res1.newlyImported, 1);

    // Second check without file change should return updated: false
    const res2 = watcher.checkAndSync();
    assert.equal(res2.updated, false);

    // Now simulate user playing a new game recorded by AMD Adrenalin
    const amdDb = new DatabaseSync(mockAmdPath);
    amdDb.prepare(`
      INSERT INTO InstalledGames (GameID, ExePath, Title, SteamID, PlayTotal)
      VALUES (2, 'C:\\Games\\Silksong\\Silksong.exe', 'Hollow Knight: Silksong', 1030300, 45)
    `).run();
    amdDb.close();

    // Touch file to ensure mtime increases
    const now = new Date(Date.now() + 1000);
    fs.utimesSync(mockAmdPath, now, now);

    const res3 = watcher.checkAndSync();
    assert.equal(res3.updated, true);
    assert.equal(res3.newlyImported, 2);
    assert.ok(capturedGame);
    assert.equal(capturedGame.title, 'Hollow Knight: Silksong');
  });

  it('ignores utilities and non-game desktop applications from AMD', () => {
    const watcher = new AMDWatcher(mockAmdPath, mockVaultDb);
    const amdDb = new DatabaseSync(mockAmdPath);

    amdDb.prepare(`
      INSERT INTO InstalledGames (GameID, ExePath, Title, PlayTotal)
      VALUES (3, 'C:\\Riot Games\\Riot Client\\RiotClientCrashHandler.exe', 'Riot Client Crash Handler', 10)
    `).run();
    amdDb.prepare(`
      INSERT INTO InstalledGames (GameID, ExePath, Title, PlayTotal)
      VALUES (4, 'C:\\Program Files\\AMD\\CNext\\AMDRSSrcExt.exe', 'AMDRSSrc Ext', 0)
    `).run();
    amdDb.close();

    const now = new Date(Date.now() + 2000);
    fs.utimesSync(mockAmdPath, now, now);

    watcher.checkAndSync();

    // Verify neither utility made it into vault games
    const riot = mockVaultDb.prepare('SELECT * FROM games WHERE title LIKE ?').get('%Riot Client Crash%');
    assert.equal(riot, undefined);

    const amdUtil = mockVaultDb.prepare('SELECT * FROM games WHERE title LIKE ?').get('%AMDRSSrc%');
    assert.equal(amdUtil, undefined);
  });
});
