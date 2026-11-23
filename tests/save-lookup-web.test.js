import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDb, closeDb, createGame, deleteSetting } from '../src/main/db.ts';
import { searchSaveLocationsWeb } from '../src/main/save-lookup-web.ts';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gamevault-weblookup-${prefix}-`));
}

function writeSaveFile(dir, relativeName, content) {
  const fullPath = path.join(dir, relativeName);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

// --- fixtures shaped like the real Bing / DuckDuckGo HTML (probed live) ---

function ddgPage({ snippet, resultUrl }) {
  const uddg = encodeURIComponent(resultUrl);
  return `
    <html><body>
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${uddg}&amp;rut=xyz">Test Game save location</a>
      <a class="result__snippet" href="#">${snippet}</a>
    </body></html>`;
}

function bingPage({ snippet, resultUrl }) {
  return `
    <html><body>
      <li class="b_algo"><h2><a href="${resultUrl}">Where are saves stored</a></h2>
      <p>${snippet}</p></li>
    </body></html>`;
}

describe('Save Vault — web location lookup (Tìm trên web)', () => {
  let tmpRoots = [];
  let fetchCalls = [];

  const newTmp = (prefix) => {
    const dir = makeTempDir(prefix);
    tmpRoots.push(dir);
    return dir;
  };

  beforeEach(() => {
    initDb(':memory:');
    tmpRoots = [];
    fetchCalls = [];
  });

  afterEach(() => {
    closeDb();
    for (const dir of tmpRoots) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  const makeEnv = (opts = {}) => {
    const home = newTmp('home');
    return {
      userProfile: home,
      documentsDir: path.join(home, 'Documents'),
      savedGamesDir: path.join(home, 'Saved Games'),
      appData: opts.appData || path.join(home, 'AppData', 'Roaming'),
      localAppData: path.join(home, 'AppData', 'Local'),
      exePath: opts.exePath ?? null,
      fetchCalls,
    };
  };

  test('extracts and expands snippet paths, ranks existing folder first', async () => {
    const game = createGame({ title: 'Test Game', exe_name: 'testgame.exe' });
    const env = makeEnv();

    // The folder actually exists on this machine → must rank first / high
    const roaming = env.appData;
    writeSaveFile(path.join(roaming, 'TestGame'), 'slot0.sav', 'data');

    const ddgSnippet =
      'Test Game keeps its saved games in %APPDATA%&#92;TestGame&#92;&lt;your account id&gt; on Windows.';
    const bingSnippet =
      'Quick answer: Test Game saves are stored in C:\\Users\\Somebody\\Documents\\My Games\\Test Game. Copy that folder.';

    const pageUrl = 'https://savelocation.example/test-game';
    fetchCalls.length = 0;
    const fetchImpl = async (url) => {
      fetchCalls.push(url);
      if (url.includes('duckduckgo.com')) {
        return { ok: true, status: 200, text: async () => ddgPage({ snippet: ddgSnippet, resultUrl: pageUrl }) };
      }
      if (url.includes('bing.com')) {
        return { ok: true, status: 200, text: async () => bingPage({ snippet: bingSnippet, resultUrl: pageUrl }) };
      }
      if (url.startsWith(pageUrl)) {
        return { ok: true, status: 200, text: async () => `<html><body>Full guide. Saves live in %USERPROFILE%\\Saved Games\\Test Game.</body></html>` };
      }
      return { ok: false, status: 404, text: async () => '' };
    };

    const summary = await searchSaveLocationsWeb(game.id, { ...env, fetchImpl, forceRefresh: true });

    assert.equal(summary.cached, false);
    assert.ok(summary.query.includes('Test Game'));
    assert.ok(summary.candidates.length >= 2, `expected >=2 candidates, got ${JSON.stringify(summary.candidates)}`);

    const top = summary.candidates[0];
    assert.equal(top.resolvedPath, path.join(roaming, 'TestGame'), '<SteamID> collapses to its parent folder');
    assert.equal(top.exists, true);
    assert.equal(top.confidence, 'high');
    assert.equal(top.selectable, true);

    const byPath = new Map(summary.candidates.map((c) => [c.resolvedPath, c]));
    const docsCandidate = byPath.get(path.join(env.documentsDir, 'My Games', 'Test Game'));
    assert.ok(docsCandidate, 'C:\\Users\\<name>\\Documents path must restart-expand from Documents');
    const savedGamesCandidate = byPath.get(path.join(env.savedGamesDir, 'Test Game'));
    assert.ok(savedGamesCandidate, 'result page path must be picked up');
    assert.equal(savedGamesCandidate.source, 'savelocation.example');
  });

  test('mid-path placeholder is unexpandable → display-only hint (selectable=false)', async () => {
    const game = createGame({ title: 'Placeholder Game' });
    const env = makeEnv();

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        ddgPage({
          snippet: 'Saves live in %APPDATA%&#92;PlaceholderGame&#92;&lt;steam id&gt;&#92;saves — copy that whole folder.',
          resultUrl: 'https://example.org/x',
        }),
    });

    const summary = await searchSaveLocationsWeb(game.id, { ...env, fetchImpl, forceRefresh: true });
    const hint = summary.candidates.find((c) => !c.selectable);
    assert.ok(hint, 'unexpandable candidate must be present as a hint');
    assert.ok(/PlaceholderGame/.test(hint.rawPath));
  });

  test('results are cached for 7 days; forceRefresh bypasses', async () => {
    const game = createGame({ title: 'Cache Game' });
    const env = makeEnv();
    const fetchImpl = async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => ddgPage({ snippet: 'Path: %APPDATA%&#92;CacheGame', resultUrl: 'https://a.example/x' }),
      };
    };

    const first = await searchSaveLocationsWeb(game.id, { ...env, fetchImpl, forceRefresh: true });
    assert.equal(first.cached, false);
    const callsAfterFirst = fetchCalls.length;
    assert.ok(callsAfterFirst > 0);

    const second = await searchSaveLocationsWeb(game.id, { ...env, fetchImpl });
    assert.equal(second.cached, true, 'second call must hit the cache');
    assert.equal(fetchCalls.length, callsAfterFirst, 'no new network calls when cached');

    const third = await searchSaveLocationsWeb(game.id, { ...env, fetchImpl, forceRefresh: true });
    assert.equal(third.cached, false, 'forceRefresh bypasses cache');
    assert.ok(fetchCalls.length > callsAfterFirst);
  });

  test('engine outage produces errors and no crash', async () => {
    const game = createGame({ title: 'Offline Game' });
    const env = makeEnv();
    const fetchImpl = async () => {
      throw new Error('network down');
    };

    const summary = await searchSaveLocationsWeb(game.id, { ...env, fetchImpl, forceRefresh: true });
    assert.equal(summary.candidates.length, 0);
    assert.ok(summary.errors.length > 0, 'network failure must be reported');
  });

  test('stale cache entries are ignored (TTL)', async () => {
    const game = createGame({ title: 'Stale Game' });
    const env = makeEnv();
    const slug = 'stalegame';
    // Pre-seed an expired cache entry
    deleteSetting(`save_web_lookup_v1:${slug}`);
    const { setSetting } = await import('../src/main/db.ts');
    setSetting(
      `save_web_lookup_v1:${slug}`,
      JSON.stringify({
        ts: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
        query: 'old',
        candidates: [{ rawPath: 'stale', resolvedPath: 'stale', exists: false, source: 'x', url: '', confidence: 'low', selectable: false }],
      })
    );

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => ddgPage({ snippet: 'Path: %APPDATA%&#92;StaleGame', resultUrl: 'https://a.example/x' }),
    });

    const summary = await searchSaveLocationsWeb(game.id, { ...env, fetchImpl });
    assert.equal(summary.cached, false, 'expired cache must be refreshed');
    assert.ok(summary.candidates.length > 0);
  });
});
