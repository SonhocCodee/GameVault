import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTestDb,
  hasRealMediaDir,
  REAL_MEDIA_PATH
} from './test-helpers.js';
import {
  sanitizeTitleForFolder,
  resolveFolderAlias,
  findGameFolder,
  ensureGameFolder,
  scanMediaFiles,
  getGameMedia,
} from '../src/main/media.ts';
import {
  calculateHttp206Range,
  getMimeType,
  parseMediaUrlToFilePath,
} from '../src/main/protocol.ts';
import {
  buildSteamCdnUrls,
  resolveSteamAppId,
  searchSteamCovers,
  setCoverFromScreenshot,
  autoEnrichAllGameCovers,
  pickBestAppMatch,
  resolveAppIdLive,
  resolveVerifiedSteamUrls,
  flushAppIdCache,
  isSteamStaticUrl,
  searchWebImages,
  setGoogleConfig,
  getGoogleConfig,
  setIgdbConfig,
  CURATED_STEAM_APP_IDS,
} from '../src/main/covers.ts';
import {
  getThumbnailCacheKey,
  getThumbnailsCacheDir,
  optimizeAndSaveCover,
} from '../src/main/thumbnails.ts';

describe('Media Management & HTTP 206 Streaming Suite (R5 & R6)', () => {
  let tempDir;
  let mediaRoot;

  beforeEach(() => {
    tempDir = createTempDirectory('gv_media_test_');
    mediaRoot = path.join(tempDir, 'GameMedia');
    fs.mkdirSync(mediaRoot, { recursive: true });
  });

  afterEach(() => {
    cleanupTempDirectory(tempDir);
  });

  // TIER 1: FEATURE COVERAGE (R5 Media & Streaming)
  describe('Tier 1: Feature Coverage (R5 Media & Streaming)', () => {
    it('R5-1: automatically creates game media directories with sanitized titles', () => {
      const result = ensureGameFolder('Final Fantasy VII: Rebirth', mediaRoot);
      assert.equal(result.folderName, 'Final Fantasy VII Rebirth');
      assert.ok(fs.existsSync(result.fullPath), 'Directory must be created on disk');
    });

    it('R5-2: sanitizes illegal Windows characters while preserving readability', () => {
      assert.equal(sanitizeTitleForFolder('Game: With <Illegal> "Characters" / \\ | ? *'), 'Game With Illegal Characters');
      assert.equal(sanitizeTitleForFolder('Normal Game Title'), 'Normal Game Title');
      assert.equal(sanitizeTitleForFolder('   Spaced   Title   '), 'Spaced Title');
      assert.equal(sanitizeTitleForFolder(''), 'Unknown_Game');
      assert.equal(sanitizeTitleForFolder(null), 'Unknown_Game');
      assert.equal(sanitizeTitleForFolder(undefined), 'Unknown_Game');
    });

    it('R5-3: resolves custom folder aliases and typo conventions', () => {
      assert.equal(resolveFolderAlias('PBZ'), 'Phantom Blade Zero');
      assert.equal(resolveFolderAlias('pbz'), 'Phantom Blade Zero');
      assert.equal(resolveFolderAlias('CrimsonDersert'), 'Crimson Desert');
      assert.equal(resolveFolderAlias('ds2'), 'Dead Space 2');
      assert.equal(resolveFolderAlias('Warhammer 40k'), 'Warhammer 40000 Space Marine 2');
      assert.equal(resolveFolderAlias('Unknown Title'), 'Unknown Title');
    });

    it('R5-4: scans and categorizes image and video assets while ignoring system files', () => {
      const gameFolder = path.join(mediaRoot, 'ScanTest');
      fs.mkdirSync(gameFolder, { recursive: true });

      // Create test files
      fs.writeFileSync(path.join(gameFolder, 'shot1.png'), 'PNG_DATA');
      fs.writeFileSync(path.join(gameFolder, 'shot2.JPG'), 'JPG_DATA');
      fs.writeFileSync(path.join(gameFolder, 'clip1.mp4'), 'MP4_DATA');
      fs.writeFileSync(path.join(gameFolder, 'clip2.mov'), 'MOV_DATA');
      fs.writeFileSync(path.join(gameFolder, 'desktop.ini'), 'SYS_DATA');
      fs.writeFileSync(path.join(gameFolder, 'notes.txt'), 'TXT_DATA');

      const media = scanMediaFiles(gameFolder);
      assert.equal(media.images.length, 2);
      assert.equal(media.videos.length, 2);
      assert.equal(media.totalCount, 4);

      const imgNames = media.images.map(i => i.filename);
      assert.ok(imgNames.includes('shot1.png'));
      assert.ok(imgNames.includes('shot2.JPG'));

      const vidNames = media.videos.map(v => v.filename);
      assert.ok(vidNames.includes('clip1.mp4'));
      assert.ok(vidNames.includes('clip2.mov'));
    });

    it('R5-5: calculates HTTP 206 Partial Content byte ranges for large video streaming', () => {
      const totalSize = 3 * 1024 * 1024 * 1024; // 3 GB file

      // Case 1: Initial chunk request
      const chunk1 = calculateHttp206Range('bytes=0-1048575', totalSize); // 1 MB chunk
      assert.equal(chunk1.statusCode, 206);
      assert.equal(chunk1.start, 0);
      assert.equal(chunk1.end, 1048575);
      assert.equal(chunk1.contentLength, 1048576);
      assert.equal(chunk1.contentRange, `bytes 0-1048575/${totalSize}`);

      // Case 2: Open-ended range (from byte 5000 to end)
      const chunk2 = calculateHttp206Range('bytes=5000-', totalSize);
      assert.equal(chunk2.statusCode, 206);
      assert.equal(chunk2.start, 5000);
      assert.equal(chunk2.end, totalSize - 1);
      assert.equal(chunk2.contentLength, totalSize - 5000);

      // Case 3: Suffix range (last 1000 bytes)
      const chunk3 = calculateHttp206Range('bytes=-1000', totalSize);
      assert.equal(chunk3.statusCode, 206);
      assert.equal(chunk3.start, totalSize - 1000);
      assert.equal(chunk3.end, totalSize - 1);
      assert.equal(chunk3.contentLength, 1000);

      // Case 4: No Range header -> Full content 200
      const full = calculateHttp206Range(null, totalSize);
      assert.equal(full.statusCode, 200);
      assert.equal(full.contentLength, totalSize);
      assert.equal(full.contentRange, null);
    });

    it('R5-6: getGameMedia returns formatted items with game-media:// protocol URLs', async () => {
      const gameFolder = path.join(mediaRoot, 'PBZ');
      fs.mkdirSync(gameFolder, { recursive: true });

      const file1 = path.join(gameFolder, 'Screenshot-F6-20261120-100000.png');
      const file2 = path.join(gameFolder, 'Boss_Fight.mp4');
      fs.writeFileSync(file1, 'SAMPLE_IMAGE');
      fs.writeFileSync(file2, 'SAMPLE_VIDEO');

      const items = await getGameMedia('Phantom Blade Zero', mediaRoot);
      assert.equal(items.length, 2);

      const imgItem = items.find(i => i.type === 'image');
      assert.ok(imgItem);
      assert.ok(imgItem.url.startsWith('game-media://local/'));
      assert.equal(imgItem.name, 'Screenshot-F6-20261120-100000.png');
      assert.ok(imgItem.createdAt);
      assert.ok(imgItem.captureDate);

      const vidItem = items.find(i => i.type === 'video');
      assert.ok(vidItem);
      assert.ok(vidItem.url.startsWith('game-media://local/'));
      assert.equal(vidItem.name, 'Boss_Fight.mp4');
    });

    it('R5-7: findGameFolder resolves folders via multi-tier heuristics (alias, normalized, fuzzy)', () => {
      // Create directories with realistic user naming variations
      fs.mkdirSync(path.join(mediaRoot, 'PBZ'), { recursive: true });
      fs.mkdirSync(path.join(mediaRoot, 'CrimsonDersert'), { recursive: true });
      fs.mkdirSync(path.join(mediaRoot, 'HorizonForbiddenWest'), { recursive: true });
      fs.mkdirSync(path.join(mediaRoot, 'God Of War Raknarok'), { recursive: true });

      // Match reverse alias
      const pbzFolder = findGameFolder('Phantom Blade Zero', mediaRoot);
      assert.ok(pbzFolder);
      assert.equal(path.basename(pbzFolder), 'PBZ');

      // Match typo alias
      const cdFolder = findGameFolder('Crimson Desert', mediaRoot);
      assert.ok(cdFolder);
      assert.equal(path.basename(cdFolder), 'CrimsonDersert');

      // Match normalized
      const hfwFolder = findGameFolder('Horizon Forbidden West', mediaRoot);
      assert.ok(hfwFolder);
      assert.equal(path.basename(hfwFolder), 'HorizonForbiddenWest');

      // Match fuzzy Levenshtein
      const gowFolder = findGameFolder('God of War Ragnarok', mediaRoot);
      assert.ok(gowFolder);
      assert.equal(path.basename(gowFolder), 'God Of War Raknarok');
    });
  });

  // TIER 2: PROTOCOL & URL PARSING
  describe('Tier 2: Protocol & URL Parsing', () => {
    it('T2-1: returns HTTP 416 for out-of-bounds or unsatisfiable byte ranges', () => {
      const fileSize = 1000;
      // Start beyond EOF
      const invalid1 = calculateHttp206Range('bytes=2000-3000', fileSize);
      assert.equal(invalid1.statusCode, 416);
      assert.equal(invalid1.contentRange, `bytes */${fileSize}`);

      // Start greater than end
      const invalid2 = calculateHttp206Range('bytes=500-400', fileSize);
      assert.equal(invalid2.statusCode, 416);
    });

    it('T2-2: handles empty or non-existent folders cleanly in scanner', () => {
      const emptyDir = path.join(tempDir, 'EmptyFolder');
      fs.mkdirSync(emptyDir, { recursive: true });
      const emptyResult = scanMediaFiles(emptyDir);
      assert.deepEqual(emptyResult.images, []);
      assert.deepEqual(emptyResult.videos, []);
      assert.equal(emptyResult.totalCount, 0);

      const nonExistentResult = scanMediaFiles(path.join(tempDir, 'DoesNotExist'));
      assert.equal(nonExistentResult.totalCount, 0);
    });

    it('T2-3: parseMediaUrlToFilePath correctly decodes URLs to Windows file paths', () => {
      const p1 = parseMediaUrlToFilePath('game-media://local/E:/Game/PBZ/screenshot.png');
      assert.equal(path.normalize(p1), path.normalize('E:\\Game\\PBZ\\screenshot.png'));

      const p2 = parseMediaUrlToFilePath('game-media://local/E%3A%2FGame%2FCrimsonDersert%2Fclip.mp4');
      assert.equal(path.normalize(p2), path.normalize('E:\\Game\\CrimsonDersert\\clip.mp4'));

      const p3 = parseMediaUrlToFilePath('game-media:///C:/Users/test/shot.png');
      assert.equal(path.normalize(p3), path.normalize('C:\\Users\\test\\shot.png'));
    });

    it('T2-4: getMimeType maps media extensions accurately', () => {
      assert.equal(getMimeType('test.png'), 'image/png');
      assert.equal(getMimeType('test.jpg'), 'image/jpeg');
      assert.equal(getMimeType('test.jpeg'), 'image/jpeg');
      assert.equal(getMimeType('test.webp'), 'image/webp');
      assert.equal(getMimeType('test.mp4'), 'video/mp4');
      assert.equal(getMimeType('test.webm'), 'video/webm');
      assert.equal(getMimeType('test.mov'), 'video/quicktime');
      assert.equal(getMimeType('test.mkv'), 'video/x-matroska');
      assert.equal(getMimeType('test.unknown'), 'application/octet-stream');
    });
  });

  // TIER 3: STEAM CDN & COVER ART SUITE (R6)
  describe('Tier 3: Steam CDN & Cover Art Suite (R6)', () => {
    it('R6-1: builds direct unblocked Steam Fastly CDN URLs', () => {
      const urls = buildSteamCdnUrls(1091500); // Cyberpunk 2077
      assert.equal(
        urls.posterUrl,
        'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/library_600x900_2x.jpg'
      );
      assert.equal(
        urls.bannerUrl,
        'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/library_hero.jpg'
      );
    });

    it('R6-2: resolves popular games to curated Steam AppIDs', () => {
      assert.equal(resolveSteamAppId('Cyberpunk 2077'), 1091500);
      assert.equal(resolveSteamAppId('Final Fantasy VII Rebirth'), 2909400);
      assert.equal(resolveSteamAppId('ff7 rebirth'), 2909400);
      assert.equal(resolveSteamAppId('Detroit: Become Human'), 1222140);
      assert.equal(resolveSteamAppId('The Witcher 3'), 292030);
      assert.equal(resolveSteamAppId('Horizon Forbidden West'), 2420110);
      assert.equal(resolveSteamAppId('Crimson Desert'), 3321460);
      assert.equal(resolveSteamAppId('Phantom Blade Zero'), 4115450);
      assert.equal(resolveSteamAppId('Unknown Custom Game', 999999), 999999);
    });

    it('R6-3: searchSteamCovers returns poster and banner URLs for recognized titles', async () => {
      const res = await searchSteamCovers('Cyberpunk 2077');
      assert.ok(res.posterUrl);
      assert.ok(res.bannerUrl);
      assert.ok(res.posterUrl.includes('1091500'));
      assert.ok(res.bannerUrl.includes('library_hero.jpg'));
    });

    it('R6-5: setCoverFromScreenshot validates screenshot file existence', () => {
      const dummyShot = path.join(tempDir, 'shot.png');
      fs.writeFileSync(dummyShot, 'TEST_SCREENSHOT');

      const setRes = setCoverFromScreenshot(0, 'poster', dummyShot);
      assert.equal(setRes, dummyShot);

      assert.throws(() => {
        setCoverFromScreenshot(0, 'poster', path.join(tempDir, 'non_existent.png'));
      }, /Screenshot file not found/);
    });

    it('R6-6: getThumbnailCacheKey generates deterministic hashes for cache files', () => {
      const key1 = getThumbnailCacheKey('E:\\Game\\PBZ\\shot.png', 1700000000, 5000000, 480);
      const key2 = getThumbnailCacheKey('E:\\Game\\PBZ\\shot.png', 1700000000, 5000000, 480);
      const keyDiffWidth = getThumbnailCacheKey('E:\\Game\\PBZ\\shot.png', 1700000000, 5000000, 240);

      assert.equal(key1, key2, 'Same inputs must produce exact same cache filename');
      assert.notEqual(key1, keyDiffWidth, 'Different target dimensions must produce distinct cache filenames');
      assert.ok(key1.startsWith('thumb_'));
      assert.ok(key1.endsWith('.jpg'));
    });

    it('R6-7: parseMediaUrlToFilePath correctly strips query parameters', () => {
      const p1 = parseMediaUrlToFilePath('game-media://local/E:/Game/PBZ/screenshot.png?thumb=1&w=480');
      assert.equal(path.normalize(p1), path.normalize('E:\\Game\\PBZ\\screenshot.png'));

      const p2 = parseMediaUrlToFilePath('game-media:///C:/Users/test/shot.png?thumb=true');
      assert.equal(path.normalize(p2), path.normalize('C:\\Users\\test\\shot.png'));
    });

    it('R6-8: optimizeAndSaveCover saves optimized cover to target directory on SSD', () => {
      const dummyShot = path.join(tempDir, 'banner_shot.png');
      fs.writeFileSync(dummyShot, 'TEST_BANNER_DATA');
      const coversDir = path.join(tempDir, 'covers');

      const savedPath = optimizeAndSaveCover(dummyShot, 42, 'banner', coversDir);
      assert.ok(fs.existsSync(savedPath), 'Optimized file must exist in covers directory');
      assert.ok(savedPath.includes('cover_42_banner_'));
    });
  });

  // TIER 3.5: LIVE STEAM RESOLUTION & VERIFICATION (R9)
  describe('Tier 3.5: Live Steam Resolution & URL Verification (R9)', () => {
    /**
     * Offline fetch stub routing steamcommunity search + steamstatic CDN HEAD
     * checks. `okAppIds` return 200 for every CDN asset of that AppID;
     * `deadAppIds` always 404 (simulating a dead/blind URL).
     */
    const makeRouteStub = ({ searchResults = {}, okAppIds = [], deadAppIds = [] } = {}) => {
      const searchCalls = [];
      const stub = async (url) => {
        if (url.includes('steamcommunity.com/actions/SearchApps')) {
          const term = decodeURIComponent(url.split('/actions/SearchApps/')[1] || '');
          searchCalls.push(term);
          const results = searchResults[term.toLowerCase()] || [];
          return { ok: true, status: 200, json: async () => results };
        }
        const m = url.match(/\/apps\/(\d+)\//);
        const id = m ? Number(m[1]) : 0;
        const ok = okAppIds.includes(id) && !deadAppIds.includes(id);
        return { ok, status: ok ? 200 : 404 };
      };
      stub.searchCalls = searchCalls;
      return stub;
    };

    it('R9-1: pickBestAppMatch prefers exact > result-contains-title > title-contains', () => {
      const exact = pickBestAppMatch('Metro', [
        { appid: 1549000, name: 'Metro Exodus' },
        { appid: 286690, name: 'Metro' },
      ]);
      assert.equal(exact.appid, 286690, 'exact name match must win over superstring matches');

      const partial = pickBestAppMatch('Dying Light 2', [
        { appid: 239140, name: 'Dying Light' },
        { appid: 534380, name: 'Dying Light 2 Stay Human' },
      ]);
      assert.equal(partial.appid, 534380, 'result containing the full query beats shorter prefix games');

      assert.equal(
        pickBestAppMatch('Zqxwv Useless Probe 9001', [{ appid: 1, name: 'Supermarket Simulator' }]),
        null,
        'garbage titles must not match anything'
      );

      assert.equal(
        pickBestAppMatch('Totally Made Up Game Xyz 42', [{ appid: 275530, name: 'Z' }]),
        null,
        'tiny names must not match via title-contains poisoning'
      );

      const typo = pickBestAppMatch('Eldne Ring', [{ appid: 1245620, name: 'ELDEN RING' }]);
      assert.equal(typo.appid, 1245620, 'small typos still resolve via levenshtein tolerance');
    });

    it('R9-2: resolveAppIdLive caches hits to disk and serves them offline', async () => {
      const cacheDir = path.join(tempDir, 'appid_cache');
      const stub = makeRouteStub({
        searchResults: { 'elden ring': [{ appid: 1245620, name: 'ELDEN RING' }] },
      });

      const first = await resolveAppIdLive('Elden Ring', { fetchImpl: stub, cacheDir });
      assert.equal(first.appId, 1245620);
      flushAppIdCache(cacheDir);
      const cacheFile = path.join(cacheDir, 'steam-appid-cache.json');
      assert.ok(fs.existsSync(cacheFile), 'cache file must be persisted to disk');

      // Offline (fetch throws) — the positive cache still resolves the AppID
      const offline = await resolveAppIdLive('Elden Ring', {
        fetchImpl: async () => { throw new Error('offline'); },
        cacheDir,
      });
      assert.equal(offline.appId, 1245620, 'cached AppID must be usable without network');
    });

    it('R9-3: negative cache suppresses repeated lookups within the 7-day TTL', async () => {
      const cacheDir = path.join(tempDir, 'appid_cache_neg');
      const stub = makeRouteStub({ searchResults: {} });
      const miss = await resolveAppIdLive('No Match Probe Zqx 42', { fetchImpl: stub, cacheDir });
      assert.equal(miss, null);
      assert.equal(stub.searchCalls.length, 1);

      // Within TTL: even a stub that WOULD match must not be consulted
      const stub2 = makeRouteStub({
        searchResults: { 'no match probe zqx 42': [{ appid: 424242, name: 'No Match Probe Zqx 42' }] },
      });
      const stillMiss = await resolveAppIdLive('No Match Probe Zqx 42', { fetchImpl: stub2, cacheDir });
      assert.equal(stillMiss, null);
      assert.equal(stub2.searchCalls.length, 0, 'negative cache must prevent a network call');
    });

    it('R9-4: expired negative cache entries are retried against the API', async () => {
      const cacheDir = path.join(tempDir, 'appid_cache_ttl');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, 'steam-appid-cache.json');
      fs.writeFileSync(cacheFile, JSON.stringify({
        nomatchprobezqx42: { appId: null, resolvedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 },
      }));

      const stub = makeRouteStub({
        searchResults: { 'no match probe zqx 42': [{ appid: 424242, name: 'No Match Probe Zqx 42' }] },
      });
      const res = await resolveAppIdLive('No Match Probe Zqx 42', { fetchImpl: stub, cacheDir });
      assert.equal(res.appId, 424242, 'expired negative entry must trigger a fresh lookup');
    });

    it('R9-5: resolveVerifiedSteamUrls falls back through the asset chain and fails open offline', async () => {
      // _2x poster missing → must fall back to library_600x900.jpg
      const stub = async (url) => {
        if (url.includes('library_600x900_2x.jpg')) return { ok: false, status: 404 };
        return { ok: true, status: 200 };
      };
      const r1 = await resolveVerifiedSteamUrls(7770001, { fetchImpl: stub });
      assert.equal(r1.verified, true);
      assert.ok(r1.posterUrl.includes('/library_600x900.jpg'), 'must pick the alive 600x900 asset');
      assert.ok(!r1.posterUrl.includes('_2x'));
      assert.ok(r1.bannerUrl.includes('library_hero.jpg'));

      // Everything 404 → verified but no URLs (never save a dead link)
      const stub404 = async () => ({ ok: false, status: 404 });
      const r2 = await resolveVerifiedSteamUrls(7770001, { fetchImpl: stub404 });
      assert.equal(r2.verified, true);
      assert.equal(r2.posterUrl, undefined);
      assert.equal(r2.bannerUrl, undefined);

      // Offline → fail open with the classic unverified URLs (old behavior)
      const r3 = await resolveVerifiedSteamUrls(7770001, {
        fetchImpl: async () => { throw new Error('offline'); },
      });
      assert.equal(r3.verified, false);
      assert.ok(r3.posterUrl.includes('library_600x900_2x.jpg'));
    });

    it('R9-6: searchSteamCovers resolves brand-new games via live search', async () => {
      const cacheDir = path.join(tempDir, 'cache_r9_6');
      const stub = makeRouteStub({
        searchResults: { 'clair obscur live probe 777': [{ appid: 924773, name: 'Clair Obscur Live Probe 777' }] },
        okAppIds: [924773],
      });
      const res = await searchSteamCovers('Clair Obscur Live Probe 777', undefined, { fetchImpl: stub, cacheDir });
      assert.equal(res.appId, 924773);
      assert.ok(res.posterUrl.includes('/924773/'), 'new game must get verified Fastly URLs');
      assert.ok(res.bannerUrl.includes('library_hero.jpg'));

      // Offline must keep working for curated dictionary entries (fail-open)
      const resOffline = await searchSteamCovers('Cyberpunk 2077', undefined, {
        fetchImpl: async () => { throw new Error('offline'); },
        cacheDir,
      });
      assert.equal(resOffline.appId, 1091500);
      assert.ok(resOffline.posterUrl.includes('1091500'), 'offline dict entries keep the classic URLs');
    });

    it('R9-7: enrich fills missing covers, repairs dead Steam URLs, never touches manual covers', async () => {
      const db = createTestDb();
      const deadUrl = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1111222/library_600x900_2x.jpg';
      const manualUrl = 'https://upload.wikimedia.org/wikipedia/en/manual_cover_probe.jpg';
      const insert = db.prepare('INSERT INTO games (title, exe_name, cover_url, steam_id) VALUES (?, ?, ?, ?)');
      const gDead = insert.run('Steamstatic Dead Probe 5521', 'dead.exe', deadUrl, -1);
      const gManual = insert.run('Manual Cover Probe 5522', 'manual.exe', manualUrl, -1);
      const gMissing = insert.run('Live Missing Probe 5523', 'live.exe', null, -1);

      const stub = makeRouteStub({
        searchResults: {
          'steamstatic dead probe 5521': [{ appid: 3333444, name: 'Steamstatic Dead Probe 5521' }],
          'live missing probe 5523': [{ appid: 5555666, name: 'Live Missing Probe 5523' }],
        },
        okAppIds: [3333444, 5555666],
        deadAppIds: [1111222],
      });

      const updated = await autoEnrichAllGameCovers(db, {
        fetchImpl: stub,
        cacheDir: path.join(tempDir, 'cache_r9_7'),
        throttleMs: 0,
      });
      assert.equal(updated, 1, 'only the cover-less game counts as enriched');

      const row = (id) =>
        db.prepare('SELECT title, cover_url, banner_url, steam_id FROM games WHERE id = ?').get(id);

      // Dead steamstatic URL repaired through the full chain + steam_id write-back
      const dead = row(Number(gDead.lastInsertRowid));
      assert.ok(dead.cover_url.includes('/3333444/'), 'dead URL must be replaced with a verified live-resolved URL');
      assert.ok(!dead.cover_url.includes('1111222'), 'the dead AppID must not survive');
      assert.equal(dead.steam_id, 3333444);

      // Manually-set non-steamstatic cover must remain untouched
      const manual = row(Number(gManual.lastInsertRowid));
      assert.equal(manual.cover_url, manualUrl, 'user-added covers are never overwritten');

      // Missing cover filled by live resolution + steam_id write-back
      const missing = row(Number(gMissing.lastInsertRowid));
      assert.ok(missing.cover_url.includes('/5555666/'));
      assert.ok(missing.banner_url.includes('library_hero.jpg'));
      assert.equal(missing.steam_id, 5555666);
    });

    it('R9-8: isSteamStaticUrl distinguishes auto-repairable URLs from manual ones', () => {
      assert.ok(isSteamStaticUrl('https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/x.jpg'));
      assert.ok(!isSteamStaticUrl('https://upload.wikimedia.org/wikipedia/en/x.jpg'));
      assert.ok(!isSteamStaticUrl('E:\\Data\\covers\\cover_1_poster.jpg'));
      assert.ok(!isSteamStaticUrl(null));
      assert.ok(!isSteamStaticUrl(undefined));
    });

    it('R9-9: provider chain falls back to official store query when steamcommunity is unreachable', async () => {
      const cacheDir = path.join(tempDir, 'cache_r9_9');
      // steamcommunity blocked (VN-like), storesearch 404, store query has the new game
      const failingFetch = async (url) => {
        if (url.includes('steamcommunity.com')) throw new Error('blocked by ISP');
        if (url.includes('IStoreQueryService')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              response: {
                store_items: [{ appid: 4115450, name: 'Phantom Blade Zero', basic_info: {} }],
              },
            }),
          };
        }
        return { ok: false, status: 404 };
      };
      const res = await resolveAppIdLive('Phantom Blade Zero', { fetchImpl: failingFetch, cacheDir });
      assert.equal(res.appId, 4115450, 'recent-releases fallback must resolve new games');

      flushAppIdCache(cacheDir);
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'steam-appid-cache.json'), 'utf-8'));
      assert.ok(raw['#providerHealth'] && raw['#providerHealth'].steamcommunity, 'failed provider must be recorded');
      assert.equal(raw.phantombladezero.appId, 4115450, 'resolved AppID must be positively cached');
    });

    it('R9-10: full-catalog mirror resolves games the recent/top-seller scans miss', async () => {
      const cacheDir = path.join(tempDir, 'cache_r9_10');
      // steamcommunity blocked, storesearch/storequery 404 → only the catalog mirror works
      const failingFetch = async (url) => {
        if (url.includes('steamcommunity.com')) throw new Error('blocked by ISP');
        if (url.includes('games_appid.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { appid: 10, name: 'Counter-Strike' },
              { appid: 2627260, name: 'NINJA GAIDEN 4' },
            ],
          };
        }
        return { ok: false, status: 404 };
      };
      const res = await resolveAppIdLive('Ninja Gaiden 4', { fetchImpl: failingFetch, cacheDir });
      assert.equal(res.appId, 2627260, 'catalog mirror must resolve a game outside recent/top-seller windows');
      assert.ok(fs.existsSync(path.join(cacheDir, 'steam-catalog-cache.json')), 'catalog must be persisted to disk');

      // Catalog is cached: brand-new lookups resolve fully offline
      const offline = await resolveAppIdLive('Counter Strike', {
        fetchImpl: async () => { throw new Error('offline'); },
        cacheDir,
      });
      assert.equal(offline.appId, 10, 'cached catalog must serve lookups without network');

      // No definitive text-search provider ran → misses must NOT be negative-cached
      const junk = await resolveAppIdLive('Zqx No Definitive Probe 77', { fetchImpl: failingFetch, cacheDir });
      assert.equal(junk, null);
      flushAppIdCache(cacheDir);
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'steam-appid-cache.json'), 'utf-8'));
      assert.equal(raw.zqxnodefinitiveprobe77, undefined, 'partial-scan misses must stay retryable');
    });

    it('R9-11: garbage steam_id (INT32_MAX sentinel) falls through to the dictionary', async () => {
      const cacheDir = path.join(tempDir, 'cache_r9_11');
      const stub = makeRouteStub({ okAppIds: [2909400], deadAppIds: [2147483647] });
      const res = await searchSteamCovers('FINAL FANTASY VII REBIRTH', 2147483647, { fetchImpl: stub, cacheDir });
      assert.equal(res.appId, 2909400, 'sentinel sid must not mask the curated dictionary');
      assert.ok(res.posterUrl.includes('/2909400/'), 'dict art must be used');
    });

    it('R9-12: asset-less apps keep their appId but return no URLs', async () => {
      const cacheDir = path.join(tempDir, 'cache_r9_12');
      const stub = makeRouteStub({ deadAppIds: [4115450] }); // unreleased game: no art anywhere
      const res = await searchSteamCovers('Phantom Blade Zero', undefined, { fetchImpl: stub, cacheDir });
      assert.equal(res.appId, 4115450, 'valid but asset-less id must still be reported');
      assert.equal(res.posterUrl, undefined, 'no art must yield no dead URLs');
      assert.equal(res.bannerUrl, undefined);
    });

    it('R9-13: " - Shortcut" window-title junk is stripped before lookups', async () => {
      const cacheDir = path.join(tempDir, 'cache_r9_13');
      const stub = makeRouteStub({ okAppIds: [814380] });
      const res = await searchSteamCovers('sekiro - Shortcut', undefined, { fetchImpl: stub, cacheDir });
      assert.equal(res.appId, 814380, 'shortcut suffix must not block the dictionary');
      assert.ok(res.posterUrl.includes('/814380/'));
    });

    it('R9-14: unreleased games get hashed banner art from the coming-soon store assets', async () => {
      const cacheDir = path.join(tempDir, 'cache_r9_14');
      // steamcommunity/storesearch miss, storequery (top sellers) 404, but the
      // coming-soon scan returns PBZ with hashed store assets
      const stub = async (url) => {
        if (url.includes('steamcommunity.com')) throw new Error('blocked');
        if (url.includes('IStoreQueryService')) {
          if (url.includes('coming_soon_only')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                response: {
                  store_items: [{
                    appid: 4115450,
                    name: 'Phantom Blade Zero',
                    assets: {
                      asset_url_format: 'steam/apps/4115450/${FILENAME}?t=1794233002',
                      library_hero: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/library_hero.jpg',
                      header: '0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef01/header.jpg',
                    },
                  }],
                },
              }),
            };
          }
          return { ok: false, status: 404 };
        }
        return { ok: false, status: 404 };
      };
      const res = await searchSteamCovers('Phantom Blade Zero', undefined, { fetchImpl: stub, cacheDir });
      assert.equal(res.appId, 4115450);
      assert.equal(res.posterUrl, undefined, 'unreleased games have no vertical art yet');
      assert.ok(res.bannerUrl, 'hashed coming-soon banner must be returned');
      assert.ok(res.bannerUrl.startsWith('https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4115450/'));
      assert.ok(res.bannerUrl.includes('library_hero.jpg'), 'banner must use the hashed library_hero asset');
      assert.ok(res.bannerUrl.includes('?t=1794233002'), 'asset_url_format query suffix must be preserved');
    });

    it('R9-15: searchWebImages queries Google CSE with per-slot keywords', async () => {
      setGoogleConfig('test-api-key', 'test-cse-id');
      assert.equal(getGoogleConfig().apiKey, 'test-api-key');

      const captured = [];
      const stub = async (url) => {
        captured.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { link: 'https://img.example/elden-poster.jpg', snippet: 'cover', image: { width: 600, height: 900 } },
              { link: 'not-a-url', image: {} },
            ],
          }),
        };
      };
      const res = await searchWebImages('Elden Ring', 'poster', { fetchImpl: stub });
      assert.equal(res.length, 1, 'non-http links must be filtered out');
      assert.equal(res[0].url, 'https://img.example/elden-poster.jpg');
      assert.equal(res[0].width, 600);
      const reqUrl = captured[0];
      assert.ok(reqUrl.includes('key=test-api-key') && reqUrl.includes('cx=test-cse-id'), 'config must be sent');
      assert.ok(decodeURIComponent(reqUrl).toLowerCase().includes('elden ring game poster'), 'poster keyword must be used');
      assert.ok(reqUrl.includes('searchType=image'), 'must be an image search');

      const resBanner = await searchWebImages('Elden Ring', 'banner', { fetchImpl: stub });
      assert.ok(decodeURIComponent(captured[1]).toLowerCase().includes('elden ring game wallpaper 16:9'), 'banner keyword must be used');
      assert.ok(resBanner);
    });

    it('R9-16: IGDB supplies the canonical 2:3 poster when Steam has no vertical art', async () => {
      setIgdbConfig('igdb-cid', 'igdb-secret');
      const stub = async (url) => {
        if (url.includes('id.twitch.tv/oauth2/token')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tok123', expires_in: 5000000 }) };
        }
        if (url.includes('api.igdb.com/v4/games')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: 1, name: 'Death Stranding 2: On the Beach', cover: { image_id: 'co99xyz' } },
            ],
          };
        }
        return { ok: false, status: 404 };
      };
      const res = await searchSteamCovers('Death Stranding 2: On the Beach', 3280350, {
        fetchImpl: stub,
        cacheDir: path.join(tempDir, 'cache_r9_16'),
      });
      assert.equal(res.appId, 3280350);
      assert.equal(
        res.posterUrl,
        'https://images.igdb.com/igdb/image/upload/t_720p/co99xyz.jpg',
        'IGDB t_720p poster must fill the missing vertical art'
      );
      // cleanup: drop the test credentials so other suites stay unconfigured
      setIgdbConfig('', '');
    });
  });

  // TIER 4: REAL-WORLD E:\GAME DIRECTORY VERIFICATION
  describe('Tier 4: Real-World E:\\Game Inspection', () => {
    it('T4-1: inspects real game media folders at E:\\Game', (t) => {
      if (!hasRealMediaDir()) {
        t.skip('E:\\Game directory not found on this machine');
        return;
      }

      const dirs = fs.readdirSync(REAL_MEDIA_PATH, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      assert.ok(dirs.length >= 10, `Expected >= 10 game directories in E:\\Game, found ${dirs.length}`);
      assert.ok(dirs.includes('PBZ'), 'E:\\Game\\PBZ must exist');
      assert.ok(
        dirs.includes('CrimsonDersert') || dirs.includes('Crimson Desert'),
        'E:\\Game\\CrimsonDersert (or Crimson Desert) must exist'
      );
      assert.ok(dirs.includes('Final Fantasy VII Rebirth'), 'E:\\Game\\Final Fantasy VII Rebirth must exist');

      // Test scanning real folder
      const pbzScan = scanMediaFiles(path.join(REAL_MEDIA_PATH, 'PBZ'));
      assert.ok(pbzScan.images.length > 0, `E:\\Game\\PBZ must contain images (found ${pbzScan.images.length})`);
    });
  });
});
