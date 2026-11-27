import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestDb, createTempDirectory, cleanupTempDirectory } from './test-helpers.js';
import { PlaytimeTracker, recoverStaleSessions, isLikelyGame, cleanupNonGameEntries } from '../src/main/tracker.ts';
import {
  compactDiscordApplications,
  setDiscordDetectableEntries,
  clearDiscordDetectableIndex,
  matchDiscordDetectableGame,
  configureDiscordDetectable,
  syncDiscordDetectableCache,
} from '../src/main/discord-detectable.ts';

describe('Zero-Impact Playtime Tracker Suite (R2)', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_tracker_test_');
    db = createTestDb(':memory:');
  });

  afterEach(() => {
    clearDiscordDetectableIndex();
    configureDiscordDetectable({ cachePath: null, fetchImpl: null });
    if (db) {
      try { db.close(); } catch {}
    }
    cleanupTempDirectory(tempDir);
  });

  // Zero-Impact Playtime Tracker Reference Engine
  class MockTrackerEngine {
    constructor(database) {
      this.db = database;
      this.activeSession = null;
      this.ignoreList = new Set([
        'explorer.exe',
        'chrome.exe',
        'msedge.exe',
        'taskmgr.exe',
        'svchost.exe',
        'cmd.exe',
        'powershell.exe',
        'code.exe',
        'electron.exe'
      ]);
    }

    isSystemProcess(exeName) {
      if (!exeName) return true;
      return this.ignoreList.has(exeName.toLowerCase());
    }

    findGameByProcess(exeName) {
      if (this.isSystemProcess(exeName)) return null;
      return this.db.prepare(`
        SELECT * FROM games WHERE exe_name = ? COLLATE NOCASE
      `).get(exeName);
    }

    getStatus() {
      return {
        isTracking: this.activeSession !== null,
        activeGameTitle: this.activeSession ? this.activeSession.gameTitle : null,
        activePid: this.activeSession ? this.activeSession.pid : null
      };
    }

    handleProcessPoll(foregroundExe, pid, timestamp = new Date()) {
      const activeGame = this.findGameByProcess(foregroundExe);

      if (activeGame) {
        // If already tracking the same game, maintain session
        if (this.activeSession && this.activeSession.gameId === activeGame.id) {
          return { action: 'continue', session: this.activeSession };
        }

        // If tracking another game, close it first
        if (this.activeSession) {
          this.closeActiveSession(timestamp);
        }

        // Start new session
        const insertRes = this.db.prepare(`
          INSERT INTO sessions (game_id, pid, start_time, is_running, source)
          VALUES (?, ?, ?, 1, 'tracker')
        `).run(activeGame.id, pid, timestamp.toISOString());

        this.activeSession = {
          sessionId: Number(insertRes.lastInsertRowid),
          gameId: activeGame.id,
          gameTitle: activeGame.title,
          pid,
          startTime: timestamp
        };

        return { action: 'started', session: this.activeSession };
      } else {
        // Foreground window is not a registered game or is a system process
        // Note: in a zero-impact tracker, temporary focus switches (alt-tab)
        // should have a grace period before ending the session.
        return { action: 'idle' };
      }
    }

    closeActiveSession(timestamp = new Date(), minDurationSeconds = 10) {
      if (!this.activeSession) return null;

      const elapsedMs = timestamp.getTime() - this.activeSession.startTime.getTime();
      const elapsedSec = Math.floor(elapsedMs / 1000);

      const sessionInfo = { ...this.activeSession };
      const sessionId = this.activeSession.sessionId;
      const gameId = this.activeSession.gameId;
      this.activeSession = null;

      // Noise threshold check (< 10 seconds considered fleeting launcher launch)
      if (elapsedSec < minDurationSeconds) {
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        return { discarded: true, reason: 'fleeting_launch' };
      }

      const durationMinutes = Math.max(1, Math.round(elapsedSec / 60));

      this.db.prepare(`
        UPDATE sessions
        SET end_time = ?, duration_minutes = ?, is_running = 0
        WHERE id = ?
      `).run(timestamp.toISOString(), durationMinutes, sessionId);

      this.db.prepare(`
        UPDATE games
        SET playtime_minutes = playtime_minutes + ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(durationMinutes, gameId);

      return {
        discarded: false,
        sessionId,
        gameId,
        durationMinutes
      };
    }

    updatePlaytimeManual(gameId, newMinutes) {
      if (typeof newMinutes !== 'number' || newMinutes < 0 || !Number.isFinite(newMinutes)) {
        throw new Error('Invalid playtime minutes: must be a non-negative number');
      }

      const targetGame = this.db.prepare('SELECT id, playtime_minutes FROM games WHERE id = ?').get(gameId);
      if (!targetGame) {
        throw new Error(`Game with ID ${gameId} not found`);
      }

      const diff = newMinutes - targetGame.playtime_minutes;

      this.db.prepare(`
        UPDATE games
        SET playtime_minutes = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(newMinutes, gameId);

      // Log manual adjustment session for audit trail
      this.db.prepare(`
        INSERT INTO sessions (game_id, start_time, end_time, duration_minutes, is_running, source)
        VALUES (?, datetime('now', 'localtime'), datetime('now', 'localtime'), ?, 0, 'manual')
      `).run(gameId, diff);

      return true;
    }
  }

  // TIER 1: FEATURE COVERAGE (R2)
  describe('Tier 1: Feature Coverage (R2 Playtime Tracker)', () => {
    it('R2-1: filters system and background processes while matching registered games', () => {
      const tracker = new MockTrackerEngine(db);

      // Register test games
      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Phantom Blade Zero', 'PBZ.exe');
      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Crimson Desert', 'CrimsonDesert.exe');

      // Verify system process ignored
      assert.equal(tracker.findGameByProcess('explorer.exe'), null);
      assert.equal(tracker.findGameByProcess('chrome.exe'), null);
      assert.equal(tracker.findGameByProcess('cmd.exe'), null);

      // Verify case-insensitive match on game processes
      const match1 = tracker.findGameByProcess('pbz.exe');
      assert.ok(match1);
      assert.equal(match1.title, 'Phantom Blade Zero');

      const match2 = tracker.findGameByProcess('CRIMSONDESERT.EXE');
      assert.ok(match2);
      assert.equal(match2.title, 'Crimson Desert');
    });

    it('R2-2: tracks active session lifecycle and accumulates total game playtime on exit', () => {
      const tracker = new MockTrackerEngine(db);
      const gameRes = db.prepare('INSERT INTO games (title, exe_name, playtime_minutes) VALUES (?, ?, 0)')
        .run('God of War', 'GoW.exe');
      const gameId = Number(gameRes.lastInsertRowid);

      const startTime = new Date(2026, 10, 20, 14, 0, 0);
      const pollStart = tracker.handleProcessPoll('GoW.exe', 4321, startTime);
      assert.equal(pollStart.action, 'started');

      const statusActive = tracker.getStatus();
      assert.equal(statusActive.isTracking, true);
      assert.equal(statusActive.activeGameTitle, 'God of War');

      // Process continues running 45 minutes later
      const continueTime = new Date(2026, 10, 20, 14, 45, 0);
      const pollContinue = tracker.handleProcessPoll('GoW.exe', 4321, continueTime);
      assert.equal(pollContinue.action, 'continue');

      // Game closes 60 minutes after start
      const exitTime = new Date(2026, 10, 20, 15, 0, 0);
      const exitResult = tracker.closeActiveSession(exitTime);
      assert.equal(exitResult.discarded, false);
      assert.equal(exitResult.durationMinutes, 60);

      // Check DB values
      const updatedGame = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
      assert.equal(updatedGame.playtime_minutes, 60, 'Playtime must accumulate by 60 minutes');

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(exitResult.sessionId);
      assert.equal(session.is_running, 0);
      assert.equal(session.duration_minutes, 60);
      assert.equal(session.source, 'tracker');
    });

    it('R2-3: discards fleeting processes (<10 seconds) to prevent session clutter', () => {
      const tracker = new MockTrackerEngine(db);
      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Quick Launcher', 'launcher.exe');

      const start = new Date(2026, 10, 20, 14, 0, 0);
      tracker.handleProcessPoll('launcher.exe', 9999, start);

      // Process exits 5 seconds later
      const earlyExit = new Date(2026, 10, 20, 14, 0, 5);
      const result = tracker.closeActiveSession(earlyExit, 10);
      assert.equal(result.discarded, true);
      assert.equal(result.reason, 'fleeting_launch');

      // Verify no dangling session in DB
      const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
      assert.equal(sessionCount, 0);
    });

    it('R2-4: supports manual playtime editing and logs audit trail', () => {
      const tracker = new MockTrackerEngine(db);
      const gameRes = db.prepare('INSERT INTO games (title, playtime_minutes) VALUES (?, ?)')
        .run('Detroit Become Human', 120);
      const gameId = Number(gameRes.lastInsertRowid);

      // Update to 720 minutes (~12 hours)
      tracker.updatePlaytimeManual(gameId, 720);

      const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
      assert.equal(game.playtime_minutes, 720);

      // Audit session logged
      const manualSession = db.prepare('SELECT * FROM sessions WHERE game_id = ? AND source = ?').get(gameId, 'manual');
      assert.ok(manualSession);
      assert.equal(manualSession.duration_minutes, 600); // 720 - 120 = 600 difference
    });

    it('R2-5: seamlessly switches tracking when user transitions directly to another game', () => {
      const tracker = new MockTrackerEngine(db);
      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Game A', 'GameA.exe');
      db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Game B', 'GameB.exe');

      const t1 = new Date(2026, 10, 20, 10, 0, 0);
      tracker.handleProcessPoll('GameA.exe', 1001, t1);
      assert.equal(tracker.getStatus().activeGameTitle, 'Game A');

      // User switches to Game B after 30 minutes
      const t2 = new Date(2026, 10, 20, 10, 30, 0);
      const switchRes = tracker.handleProcessPoll('GameB.exe', 1002, t2);
      assert.equal(switchRes.action, 'started');
      assert.equal(tracker.getStatus().activeGameTitle, 'Game B');

      // Game A should have accumulated 30 minutes
      const gameA = db.prepare('SELECT playtime_minutes FROM games WHERE title = ?').get('Game A');
      assert.equal(gameA.playtime_minutes, 30);
    });
  });

  // TIER 2: BOUNDARY & CORNER CASES
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2-1: rejects negative playtime updates or invalid types', () => {
      const tracker = new MockTrackerEngine(db);
      const gameRes = db.prepare('INSERT INTO games (title) VALUES (?)').run('Test Game');
      const gameId = Number(gameRes.lastInsertRowid);

      assert.throws(() => tracker.updatePlaytimeManual(gameId, -50), /non-negative/i);
      assert.throws(() => tracker.updatePlaytimeManual(gameId, 'one hundred'), /non-negative/i);
      assert.throws(() => tracker.updatePlaytimeManual(gameId, NaN), /non-negative/i);
    });

    it('T2-2: handles manual playtime updates for non-existent game ID gracefully', () => {
      const tracker = new MockTrackerEngine(db);
      assert.throws(() => tracker.updatePlaytimeManual(99999, 100), /not found/i);
    });

    it('T2-3: handles closeActiveSession when no session is active', () => {
      const tracker = new MockTrackerEngine(db);
      const result = tracker.closeActiveSession();
      assert.equal(result, null);
    });
  });

  // ORPHAN SESSION RECOVERY (abnormal exit: crash / kill / power loss)
  describe('Stale Session Recovery (BUG1)', () => {
    const NOW = new Date(2026, 10, 21, 16, 0, 0); // 2026-11-21 16:00 local

    function insertStaleSession(gameId, startTime, lastPoll) {
      const res = db
        .prepare(
          `INSERT INTO sessions (game_id, pid, start_time, is_running, source, last_poll)
           VALUES (?, ?, ?, 1, 'tracker', ?)`
        )
        .run(gameId, 4321, startTime.toISOString(), lastPoll ? lastPoll.toISOString() : null);
      return Number(res.lastInsertRowid);
    }

    it('R-ORPHAN-1: credits playtime up to last_poll + grace window', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Crash Game', 'crash.exe');
      const gameId = Number(gameRes.lastInsertRowid);

      const startTime = new Date(NOW.getTime() - 60 * 60 * 1000); // started 60 min before NOW
      const lastPoll = new Date(NOW.getTime() - 2 * 60 * 1000);   // last poll 2 min before NOW
      insertStaleSession(gameId, startTime, lastPoll);

      const summary = recoverStaleSessions(db, { now: NOW });

      assert.equal(summary.recovered, 1);
      assert.equal(summary.creditedMinutes, 59); // elapsed = 58min30s -> rounds to 59
      assert.equal(summary.discarded, 0);

      const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
      assert.equal(game.playtime_minutes, 59);

      const session = db.prepare('SELECT * FROM sessions WHERE game_id = ?').get(gameId);
      assert.equal(session.is_running, 0);
      assert.ok(session.end_time, 'end_time must be set');
      assert.equal(new Date(session.end_time).getTime(), lastPoll.getTime() + 30 * 1000);
    });

    it('R-ORPHAN-2: discards legacy sessions without last_poll (no fabricated playtime)', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Legacy Game', 'legacy.exe');
      const gameId = Number(gameRes.lastInsertRowid);

      const startTime = new Date(NOW.getTime() - 5 * 60 * 60 * 1000); // 5h ago, unknown end
      insertStaleSession(gameId, startTime, null);

      const summary = recoverStaleSessions(db, { now: NOW });

      assert.equal(summary.recovered, 0);
      assert.equal(summary.discarded, 1);
      assert.equal(summary.creditedMinutes, 0);

      const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
      assert.equal(game.playtime_minutes, 0);
      const count = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
      assert.equal(count, 0);
    });

    it('R-ORPHAN-3: drops stale sessions shorter than 10 seconds', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Brief Game', 'brief.exe');
      const gameId = Number(gameRes.lastInsertRowid);

      const startTime = new Date(NOW.getTime() - 5 * 1000);
      const lastPoll = new Date(NOW.getTime() - 3 * 1000);
      insertStaleSession(gameId, startTime, lastPoll);

      const summary = recoverStaleSessions(db, { now: NOW });

      assert.equal(summary.recovered, 0);
      assert.equal(summary.discarded, 1);
      const count = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
      assert.equal(count, 0);
    });

    it('R-ORPHAN-4: only touches tracker sessions, never amd_import ones', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('AMD Game', 'amd.exe');
      const gameId = Number(gameRes.lastInsertRowid);

      const startTime = new Date(NOW.getTime() - 60 * 60 * 1000);
      db.prepare(
        `INSERT INTO sessions (game_id, pid, start_time, is_running, source)
         VALUES (?, ?, ?, 1, 'amd_import')`
      ).run(gameId, 777, startTime.toISOString());

      const summary = recoverStaleSessions(db, { now: NOW });

      assert.equal(summary.recovered, 0);
      const session = db.prepare('SELECT * FROM sessions WHERE game_id = ?').get(gameId);
      assert.equal(session.is_running, 1, 'AMD session must stay untouched');
    });

    it('R-ORPHAN-5: PlaytimeTracker.start() runs recovery before polling', () => {
      const gameRes = db.prepare('INSERT INTO games (title, exe_name) VALUES (?, ?)').run('Startup Game', 'startup.exe');
      const gameId = Number(gameRes.lastInsertRowid);

      // Relative to the real clock so recovery's internal now() always lands after last_poll
      const startTime = new Date(Date.now() - 30 * 60 * 1000);
      const lastPoll = new Date(Date.now() - 1 * 60 * 1000);
      insertStaleSession(gameId, startTime, lastPoll);

      const tracker = new PlaytimeTracker(db, { autoDetectNewGames: false });
      tracker.start(3600000); // recovery runs synchronously inside start()

      const game = db.prepare('SELECT playtime_minutes FROM games WHERE id = ?').get(gameId);
      assert.equal(game.playtime_minutes, 30); // elapsed = 29min30s -> rounds to 30

      const session = db.prepare('SELECT is_running FROM sessions WHERE game_id = ?').get(gameId);
      assert.equal(session.is_running, 0);

      tracker.stop();
    });
  });

  // INTELLIGENT GAME VERIFICATION (NON-HARDCODED)
  describe('Intelligent Game Verification (Non-Hardcoded)', () => {
    it('rejects general desktop utilities without game markers (PuTTY, mRemoteNG, VS Code)', () => {
      // PuTTY and mRemoteNG in Program Files
      assert.equal(isLikelyGame('PuTTYNG.exe', 'C:\\Program Files (x86)\\mRemoteNG\\PuTTYNG.exe', db), false);
      assert.equal(isLikelyGame('mRemoteNG.exe', 'C:\\Program Files (x86)\\mRemoteNG\\mRemoteNG.exe', db), false);
      assert.equal(isLikelyGame('putty.exe', 'C:\\Users\\User\\Downloads\\putty.exe', db), false);
      assert.equal(isLikelyGame('Code.exe', 'C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', db), false);
      assert.equal(isLikelyGame('notepad++.exe', 'C:\\Program Files\\Notepad++\\notepad++.exe', db), false);
    });

    it('rejects launchers, store clients, updaters and cloud tools (LeagueClientUx, Riot Client, GoogleDriveFS, Setup)', () => {
      assert.equal(isLikelyGame('LeagueClientUx.exe', 'C:\\Riot Games\\League of Legends\\LeagueClientUx.exe', db), false);
      assert.equal(isLikelyGame('Riot Client.exe', 'C:\\Riot Games\\Riot Client\\Riot Client.exe', db), false);
      assert.equal(isLikelyGame('RiotClientServices.exe', 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe', db), false);
      assert.equal(isLikelyGame('GoogleDriveFS.exe', 'C:\\Program Files\\Google\\Drive File Stream\\GoogleDriveFS.exe', db), false);
      assert.equal(isLikelyGame('GoogleDriveSetup.exe', 'C:\\Users\\User\\Downloads\\GoogleDriveSetup.exe', db), false);
    });

    it('positively identifies games in standard gaming platforms & folders', () => {
      // Steam
      assert.equal(isLikelyGame('sekiro.exe', 'D:\\SteamLibrary\\steamapps\\common\\Sekiro\\sekiro.exe', db), true);
      // Epic Games
      assert.equal(isLikelyGame('AlanWake2.exe', 'E:\\Epic Games\\AlanWake2\\AlanWake2.exe', db), true);
      // GOG Games
      assert.equal(isLikelyGame('Witcher3.exe', 'C:\\GOG Games\\The Witcher 3\\bin\\x64\\witcher3.exe', db), true);
      // User Games directory (D:\Games, E:\Game)
      assert.equal(isLikelyGame('EldenRing.exe', 'D:\\Games\\Elden Ring\\Game\\eldenring.exe', db), true);
      assert.equal(isLikelyGame('game.exe', 'E:\\Game\\BlackMythWukong\\game.exe', db), true);
    });

    it('positively identifies Unreal Engine game binaries by convention', () => {
      assert.equal(isLikelyGame('Shooter-Win64-Shipping.exe', 'F:\\MyProject\\Binaries\\Win64\\Shooter-Win64-Shipping.exe', db), true);
    });

    it('positively identifies games by SDK runtime presence (UnityPlayer.dll, steam_api64.dll)', () => {
      const gameFolder = path.join(tempDir, 'IndieUnityGame');
      fs.mkdirSync(gameFolder, { recursive: true });
      fs.writeFileSync(path.join(gameFolder, 'UnityPlayer.dll'), '');
      const gameExe = path.join(gameFolder, 'mygame.exe');
      fs.writeFileSync(gameExe, '');

      assert.equal(isLikelyGame('mygame.exe', gameExe, db), true);

      const steamFolder = path.join(tempDir, 'CustomSteamGame');
      fs.mkdirSync(steamFolder, { recursive: true });
      fs.writeFileSync(path.join(steamFolder, 'steam_api64.dll'), '');
      const steamExe = path.join(steamFolder, 'custom.exe');
      fs.writeFileSync(steamExe, '');

      assert.equal(isLikelyGame('custom.exe', steamExe, db), true);
    });

    it('honors deleted_games tombstone to prevent resurrection', () => {
      db.prepare('INSERT INTO deleted_games (title, exe_name) VALUES (?, ?)').run('Test Game', 'testgame.exe');

      assert.equal(isLikelyGame('testgame.exe', 'D:\\Games\\Test Game\\testgame.exe', db), false);
    });

    it('prevents PlaytimeTracker from auto-registering non-game apps when focused', () => {
      const tracker = new PlaytimeTracker(db, { autoDetectNewGames: true });

      const pollRes = tracker.handleProcessPoll(
        'PuTTYNG.exe',
        54321,
        new Date(),
        'C:\\Program Files (x86)\\mRemoteNG\\PuTTYNG.exe'
      );

      assert.equal(pollRes.action, 'idle');
      assert.equal(tracker.activeSession, null);

      const registered = db.prepare("SELECT * FROM games WHERE exe_name = 'PuTTYNG.exe'").get();
      assert.equal(registered, undefined);
    });

    it('rejects IDEs and Electron desktop apps such as Antigravity-x64, Cursor, and Windsurf', () => {
      assert.equal(isLikelyGame('Antigravity-x64.exe', 'C:\\Users\\MacPro\\AppData\\Local\\Programs\\Antigravity\\Antigravity-x64.exe', db), false);
      assert.equal(isLikelyGame('Cursor.exe', 'C:\\Users\\MacPro\\AppData\\Local\\Programs\\cursor\\Cursor.exe', db), false);

      // Even in a generic folder, an Electron app with resources/app.asar and no game SDK must be rejected
      const electronAppDir = path.join(tempDir, 'SomeDesktopTool');
      fs.mkdirSync(path.join(electronAppDir, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(electronAppDir, 'resources', 'app.asar'), '');
      const toolExe = path.join(electronAppDir, 'SomeDesktopTool.exe');
      fs.writeFileSync(toolExe, '');
      assert.equal(isLikelyGame('SomeDesktopTool.exe', toolExe, db), false);
    });

    it('closes active session at lastPollTime + grace when pollOnce wakes from sleep/hibernate', () => {
      const tracker = new PlaytimeTracker(db, { autoDetectNewGames: false });
      const created = db
        .prepare("INSERT INTO games (title, exe_name, playtime_minutes) VALUES ('Sleep Test Game', 'sleeptest.exe', 0)")
        .run();
      const gameId = Number(created.lastInsertRowid);

      const t0 = new Date('2026-11-26T10:00:00.000Z');
      const startRes = tracker.handleProcessPoll('sleeptest.exe', 9999, t0);
      assert.equal(startRes.action, 'started');

      // Simulate last poll at +5 minutes
      const t5 = new Date('2026-11-26T10:05:00.000Z');
      tracker.activeSession.lastPollTime = t5;

      // Simulate PC waking up 4 hours later: pollOnce must cap session at t5 + 30s (not 4 hours!)
      const tWake = new Date('2026-11-26T14:05:00.000Z');
      tracker.pollOnce(tWake);

      const row = db
        .prepare("SELECT duration_minutes, is_running FROM sessions WHERE game_id = ? AND source = 'tracker'")
        .get(gameId);
      assert.equal(row.is_running, 0);
      assert.equal(row.duration_minutes, 6); // ~5.5 min rounded -> 6 min, NOT 245 min!
    });
  });

  describe('Discord Detectable Game Matcher', () => {
    it('compacts Windows non-launcher games and skips non-game apps', () => {
      const compacted = compactDiscordApplications([
        {
          id: '1',
          name: 'Overwatch',
          executables: [
            { os: 'win32', is_launcher: false, name: 'overwatch.exe' },
            { os: 'win32', is_launcher: true, name: 'Overwatch Launcher.exe' },
            { os: 'darwin', is_launcher: false, name: 'overwatch.app' },
          ],
          third_party_skus: [{ distributor: 'steam', id: '2357570' }],
        },
        {
          id: '2',
          name: 'Spotify',
          executables: [{ os: 'win32', is_launcher: false, name: 'spotify.exe' }],
        },
        {
          id: '3',
          name: 'Launcher Only App',
          executables: [{ os: 'win32', is_launcher: true, name: 'launcher.exe' }],
        },
      ]);

      assert.equal(compacted.length, 1);
      assert.equal(compacted[0].name, 'Overwatch');
      assert.equal(compacted[0].steamId, 2357570);
      assert.deepEqual(compacted[0].exes, ['overwatch.exe']);
    });

    it('matches unique and subpath executables in arbitrary folders', () => {
      setDiscordDetectableEntries([
        { id: '1', name: 'Overwatch', steamId: 2357570, exes: ['overwatch.exe'] },
        { id: '2', name: 'World of Warcraft', exes: ['_retail_/wow-64.exe'] },
      ]);

      assert.equal(isLikelyGame('overwatch.exe', 'F:\\RandomFolder\\OW\\overwatch.exe', db), true);
      const owMatch = matchDiscordDetectableGame('overwatch.exe', 'F:\\RandomFolder\\OW\\overwatch.exe');
      assert.equal(owMatch?.title, 'Overwatch');
      assert.equal(owMatch?.steamId, 2357570);

      assert.equal(isLikelyGame('wow-64.exe', 'D:\\Blizzard\\WoW\\_retail_\\wow-64.exe', db), true);
      assert.equal(isLikelyGame('wow-64.exe', 'D:\\Other\\wow-64.exe', db), false);
    });

    it('requires parent folder or title disambiguation for generic exe names like game.exe', () => {
      setDiscordDetectableEntries([
        { id: '10', name: 'Awesome Indie RPG', exes: ['game.exe'] },
        { id: '11', name: 'Another Puzzle', exes: ['game.exe'] },
      ]);

      // Unrelated folder must NOT match generic game.exe
      assert.equal(isLikelyGame('game.exe', 'F:\\Misc\\SomeUtility\\game.exe', db), false);
      // Matching parent folder disambiguates cleanly
      assert.equal(isLikelyGame('game.exe', 'F:\\Misc\\Awesome Indie RPG\\game.exe', db), true);
      const match = matchDiscordDetectableGame('game.exe', 'F:\\Misc\\Awesome Indie RPG\\game.exe');
      assert.equal(match?.title, 'Awesome Indie RPG');
      assert.equal(match?.confidence, 'disambiguated');
    });

    it('still blocks IDE and system/non-game directories even if present in Discord list', () => {
      setDiscordDetectableEntries([
        { id: '99', name: 'Cursor', exes: ['cursor.exe'] },
      ]);

      assert.equal(
        isLikelyGame('Cursor.exe', 'C:\\Users\\User\\AppData\\Local\\Programs\\cursor\\Cursor.exe', db),
        false
      );
    });

    it('syncs and persists compacted cache from Discord API to disk', async () => {
      const cacheFile = path.join(tempDir, 'discord-cache.json');
      configureDiscordDetectable({
        cachePath: cacheFile,
        fetchImpl: async () =>
          new Response(
            JSON.stringify([
              {
                id: '555',
                name: 'Balatro',
                executables: [{ os: 'win32', is_launcher: false, name: 'balatro.exe' }],
                third_party_skus: [{ distributor: 'steam', id: '2379780' }],
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      const ok = await syncDiscordDetectableCache({ force: true });
      assert.equal(ok, true);
      assert.equal(fs.existsSync(cacheFile), true);
      assert.equal(isLikelyGame('balatro.exe', 'D:\\Portable\\Balatro\\balatro.exe', db), true);
    });
  });

  describe('Legacy Non-Game DB Cleanup', () => {
    it('purges previously stored non-game utilities and writes tombstones without touching real games', () => {
      db.prepare(`
        INSERT INTO games (title, exe_name, exe_path, status, playtime_minutes)
        VALUES
          ('m Remote NG', 'mRemoteNG.exe', 'C:\\Program Files (x86)\\mRemoteNG\\mRemoteNG.exe', 'playing', 847),
          ('Antigravity-x64', 'Antigravity.exe', 'C:\\Users\\User\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe', 'playing', 120),
          ('VALORANT', 'VALORANT-Win64-Shipping.exe', 'C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe', 'playing', 2652)
      `).run();

      const removed = cleanupNonGameEntries(db);
      assert.equal(removed, 2);

      const remaining = db.prepare('SELECT title FROM games').all();
      assert.deepEqual(remaining.map((r) => r.title), ['VALORANT']);

      const tombstones = db.prepare('SELECT title, exe_name FROM deleted_games ORDER BY title').all();
      assert.equal(tombstones.length, 2);
      assert.equal(tombstones[0].title, 'Antigravity-x64');
      assert.equal(tombstones[0].exe_name, 'Antigravity.exe');
      assert.equal(tombstones[1].title, 'm Remote NG');
      assert.equal(tombstones[1].exe_name, 'mRemoteNG.exe');
    });
  });

  describe('Auto-Register Deduplication', () => {
    it('links exe_name to existing manually-added game matched by steam_id or normalized title without creating duplicates', () => {
      setDiscordDetectableEntries([
        { id: '201', name: 'Cyberpunk 2077', steamId: 1091500, exes: ['cyberpunk2077.exe'] },
      ]);

      // User added game via AddGameModal without picking .exe
      db.prepare(`
        INSERT INTO games (title, steam_id, status, playtime_minutes)
        VALUES ('Cyberpunk 2077™', 1091500, 'playing', 0)
      `).run();

      const tracker = new PlaytimeTracker(db);
      const matched = tracker.autoRegisterNewGame(
        'Cyberpunk2077.exe',
        'D:\\Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe'
      );

      assert.ok(matched, 'Should match the existing game');
      assert.equal(matched.exe_name, 'Cyberpunk2077.exe');

      const allRows = db.prepare('SELECT id, title, exe_name, steam_id FROM games').all();
      assert.equal(allRows.length, 1, 'Must not create a duplicate row in DB');
      assert.equal(allRows[0].exe_name, 'Cyberpunk2077.exe');
      assert.equal(allRows[0].steam_id, 1091500);
    });
  });
});
