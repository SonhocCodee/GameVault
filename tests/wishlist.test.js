import test, { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTempDirectory, cleanupTempDirectory } from './test-helpers.js';

// Wishlist games must NEVER create folders in the real E:\Game media root —
// point the media module at a temp directory BEFORE importing app modules.
// Top-level statements run before the dynamic imports below.
const tempDir = createTempDirectory('gv_wishlist_test_');
process.env.GAMEVAULT_MEDIA_ROOT = tempDir;

// Dynamic imports so the env override above is picked up at module load time
const { initDb, getDb, closeDb } = await import('../src/main/db.ts');
const { addWishlistGame, searchWishlistGames } = await import('../src/main/wishlist.ts');
const { PlaytimeTracker } = await import('../src/main/tracker.ts');
const { DEFAULT_MEDIA_ROOT } = await import('../src/main/media.ts');

// Fetch stub: every CDN HEAD check and search returns a healthy response
const fetchStub = async () => ({ ok: true, json: async () => [] });

// Single in-memory DB for the whole file
initDb(':memory:');

after(() => {
  closeDb();
  cleanupTempDirectory(tempDir);
  delete process.env.GAMEVAULT_MEDIA_ROOT;
});

describe('Wishlist ("Chờ chơi") Suite', () => {
  it('searchWishlistGames returns mapped Steam candidates (empty query -> empty list)', async () => {
    const results = await searchWishlistGames('', { limit: 5 });
    assert.deepEqual(results, []);
  });

  it('addWishlistGame creates a backlog game with cover/banner only — no media folder', async () => {
    const created = await addWishlistGame(
      { title: 'Elden Ring', steamId: 1245620 },
      { fetchImpl: fetchStub }
    );

    assert.equal(created.status, 'backlog');
    assert.equal(created.media_folder, null);
    assert.ok(created.cover_url, 'cover_url should be resolved');
    assert.ok(created.banner_url, 'banner_url should be resolved');
    assert.equal(created.steam_id, 1245620);

    // No folder may exist for a wishlist game
    const wishlistFolder = path.join(DEFAULT_MEDIA_ROOT, 'Elden Ring');
    assert.equal(
      fs.existsSync(wishlistFolder),
      false,
      'Wishlist game must not create a media folder on disk'
    );
    // And the temp media root must contain nothing at all
    assert.deepEqual(fs.readdirSync(DEFAULT_MEDIA_ROOT), []);
  });

  it('addWishlistGame rejects duplicates already in the library', async () => {
    await assert.rejects(
      () => addWishlistGame({ title: 'Elden Ring' }, { fetchImpl: fetchStub }),
      /Wishlist/
    );

    // And rejects when the title exists in another status
    getDb()
      .prepare(`INSERT INTO games (title, status) VALUES ('Wishlist Duplicate', 'playing')`)
      .run();
    await assert.rejects(
      () => addWishlistGame({ title: 'Wishlist Duplicate' }, { fetchImpl: fetchStub }),
      /thư viện/
    );
  });

  it('addWishlistGame can add games played elsewhere as completed (Đã phá đảo)', async () => {
    const created = await addWishlistGame(
      { title: 'Sekiro', steamId: 814380, status: 'completed' },
      { fetchImpl: fetchStub }
    );

    assert.equal(created.status, 'completed');
    assert.equal(created.media_folder, null, 'search-added completed games have no folder yet');
    assert.ok(created.cover_url, 'cover_url should be resolved');
    assert.ok(created.banner_url, 'banner_url should be resolved');
    assert.equal(created.steam_id, 814380);

    // No folder created at add time even for completed games
    assert.equal(fs.existsSync(path.join(DEFAULT_MEDIA_ROOT, 'Sekiro')), false);
  });

  it('rejects re-adding a title that already exists regardless of requested status', async () => {
    // Sekiro exists as 'completed' from the previous test
    await assert.rejects(
      () => addWishlistGame({ title: 'Sekiro', status: 'completed' }, { fetchImpl: fetchStub }),
      /thư viện/
    );
    await assert.rejects(
      () => addWishlistGame({ title: 'Sekiro', status: 'backlog' }, { fetchImpl: fetchStub }),
      /thư viện/
    );
  });

  it('addWishlistGame stores optional rating and review from the add dialog', async () => {
    const created = await addWishlistGame(
      { title: 'Outer Wilds', steamId: 753640, status: 'completed', user_rating: 9.5, notes: 'Kiệt tác về vũ trụ' },
      { fetchImpl: fetchStub }
    );
    assert.equal(created.status, 'completed');
    assert.equal(created.user_rating, 9.5);
    assert.equal(created.notes, 'Kiệt tác về vũ trụ');

    // Out-of-range rating + whitespace-only review → both stored as null
    const bland = await addWishlistGame(
      { title: 'Outer Wilds Echoes', steamId: 753641, status: 'backlog', user_rating: 99, notes: '   ' },
      { fetchImpl: fetchStub }
    );
    assert.equal(bland.user_rating, null);
    assert.equal(bland.notes, null);
  });

  it('launching a wishlist game auto-promotes it to playing, then creates the folder', async () => {
    const wish = await addWishlistGame(
      { title: 'Hollow Knight', steamId: 367520 },
      { fetchImpl: fetchStub }
    );
    assert.equal(wish.status, 'backlog');

    // Attach an exe so the tracker can match it, then poll as if the game runs
    getDb()
      .prepare(`UPDATE games SET exe_name = 'hollowknight.exe' WHERE id = ?`)
      .run(wish.id);

    const tracker = new PlaytimeTracker(getDb(), { autoDetectNewGames: false });
    try {
      const res = tracker.handleProcessPoll('hollowknight.exe', 4242);
      assert.equal(res.action, 'started');

      const promoted = getDb().prepare('SELECT * FROM games WHERE id = ?').get(wish.id);
      assert.equal(promoted.status, 'playing', 'wishlist game must become playing when it runs');

      // Folder is created only AFTER the promotion
      const promotedFolder = path.join(DEFAULT_MEDIA_ROOT, 'Hollow Knight');
      assert.equal(fs.existsSync(promotedFolder), true, 'media folder must be created upon promotion');
    } finally {
      tracker.stop();
    }
  });

  it('tracker auto-registers brand-new running games as playing (never backlog)', async () => {
    const tracker = new PlaytimeTracker(getDb(), { autoDetectNewGames: true });
    try {
      const game = tracker.autoRegisterNewGame('brandnewgame.exe', 'C:\\Games\\Brand New Game\\brandnewgame.exe');
      assert.ok(game);
      assert.equal(game.status, 'playing');
      assert.equal(fs.existsSync(path.join(DEFAULT_MEDIA_ROOT, game.title)), true);
    } finally {
      tracker.stop();
    }
  });
});
