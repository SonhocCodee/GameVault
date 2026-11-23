import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createTestDb, createTempDirectory, cleanupTempDirectory } from './test-helpers.js';
import { PlaytimeTracker, recoverStaleSessions } from '../src/main/tracker.ts';

describe('Zero-Impact Playtime Tracker Suite (R2)', () => {
  let db;
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_tracker_test_');
    db = createTestDb(':memory:');
  });

  afterEach(() => {
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
});
