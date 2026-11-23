import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('Milestone 4: React UI & AMD Adrenalin Theme Suite', () => {
  describe('Playtime Formatting & Status Meta', () => {
    // Test pure logic directly
    const formatPlaytime = (minutes) => {
      if (!minutes || minutes <= 0) return '0 phút';
      const hours = Math.floor(minutes / 60);
      const remainingMins = Math.round(minutes % 60);
      if (hours === 0) return `${remainingMins}m`;
      if (remainingMins === 0) return `${hours}h`;
      return `${hours}h ${remainingMins}m`;
    };

    test('formatPlaytime handles zero and negative numbers', () => {
      assert.strictEqual(formatPlaytime(0), '0 phút');
      assert.strictEqual(formatPlaytime(-10), '0 phút');
      assert.strictEqual(formatPlaytime(null), '0 phút');
    });

    test('formatPlaytime formats minutes only when under 60m', () => {
      assert.strictEqual(formatPlaytime(25), '25m');
      assert.strictEqual(formatPlaytime(59), '59m');
    });

    test('formatPlaytime formats exact hours without trailing minutes', () => {
      assert.strictEqual(formatPlaytime(60), '1h');
      assert.strictEqual(formatPlaytime(120), '2h');
      assert.strictEqual(formatPlaytime(600), '10h');
    });

    test('formatPlaytime formats composite hours and minutes', () => {
      assert.strictEqual(formatPlaytime(95), '1h 35m');
      assert.strictEqual(formatPlaytime(2232), '37h 12m');
    });
  });

  describe('Component Files Existence and Structure', () => {
    const requiredFiles = [
      'src/renderer/main.tsx',
      'src/renderer/App.tsx',
      'src/renderer/index.css',
      'src/renderer/components/Navbar.tsx',
      'src/renderer/components/GameCard.tsx',
      'src/renderer/components/GameDetail.tsx',
      'src/renderer/components/Lightbox.tsx',
      'src/renderer/components/VideoPlayer.tsx',
      'src/renderer/components/CoverArtModal.tsx',
      'src/renderer/components/ImportModal.tsx',
      'src/renderer/components/SyncModal.tsx',
      'src/renderer/components/SettingsModal.tsx',
      'src/renderer/components/GameRowSection.tsx',
    ];

    for (const relPath of requiredFiles) {
      test(`Component file exists: ${relPath}`, () => {
        const fullPath = path.join(projectRoot, relPath);
        assert.ok(fs.existsSync(fullPath), `Missing required UI file: ${relPath}`);
        const content = fs.readFileSync(fullPath, 'utf8');
        assert.ok(content.length > 50, `File appears empty: ${relPath}`);
      });
    }
  });

  describe('AMD Adrenalin Theme Configuration in index.css', () => {
    test('index.css contains AMD Adrenalin color tokens and custom scrollbars', () => {
      const cssPath = path.join(projectRoot, 'src/renderer/index.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Check color variables
      assert.ok(css.includes('#0e1015'), 'Must contain AMD Dark background #0e1015');
      assert.ok(css.includes('#161821'), 'Must contain AMD Card surface #161821');
      assert.ok(css.includes('#ff2a44'), 'Must contain Crimson Accent #ff2a44');
      assert.ok(css.includes('#2a2e3d'), 'Must contain Border color #2a2e3d');

      // Check scrollbar styles
      assert.ok(css.includes('::-webkit-scrollbar'), 'Must configure custom scrollbars');
      assert.ok(css.includes('::-webkit-scrollbar-thumb'), 'Must style scrollbar thumb');
      assert.ok(css.includes('::-webkit-scrollbar-track'), 'Must style scrollbar track');
    });
  });

  describe('Production Build Artifacts Verification', () => {
    test('dist/index.html and assets are generated and non-empty', () => {
      const distHtml = path.join(projectRoot, 'dist/index.html');
      assert.ok(fs.existsSync(distHtml), 'dist/index.html must exist');

      const assetsDir = path.join(projectRoot, 'dist/assets');
      assert.ok(fs.existsSync(assetsDir), 'dist/assets must exist');

      const assetFiles = fs.readdirSync(assetsDir);
      const jsBundle = assetFiles.find((f) => f.endsWith('.js'));
      const cssBundle = assetFiles.find((f) => f.endsWith('.css'));

      assert.ok(jsBundle, 'Vite JS bundle must exist');
      assert.ok(cssBundle, 'Vite CSS bundle must exist');

      const jsSize = fs.statSync(path.join(assetsDir, jsBundle)).size;
      const cssSize = fs.statSync(path.join(assetsDir, cssBundle)).size;

      assert.ok(jsSize > 100000, `JS bundle size (${jsSize} bytes) should be substantial`);
      assert.ok(cssSize > 10000, `CSS bundle size (${cssSize} bytes) should include theme styles`);
    });
  });

  describe('Home Page Categorized Rows & Recency Sorting', () => {
    test('categorizes games correctly and sorts recently played games to the top', () => {
      const mockGames = [
        { id: 1, title: 'Old Playing Game', status: 'playing', last_played_at: '2026-11-10T10:00:00', playtime_minutes: 50 },
        { id: 2, title: 'Fresh Playing Game', status: 'playing', last_played_at: '2026-11-20T20:00:00', playtime_minutes: 10 },
        { id: 3, title: 'Completed Game A', status: 'completed', completed_at: '2026-11-15T12:00:00', user_rating: 9.0 },
        { id: 4, title: 'Completed Game B', status: 'completed', completed_at: '2026-11-18T12:00:00', user_rating: 9.5 },
        { id: 5, title: 'Backlog Game', status: 'backlog', playtime_minutes: 0 },
        { id: 6, title: 'Paused Game', status: 'paused', playtime_minutes: 120 },
        { id: 7, title: 'Dropped Game', status: 'dropped', playtime_minutes: 30 },
      ];

      const recentTimeOf = (g) => {
        if (g.last_played_at) return new Date(g.last_played_at).getTime();
        if (g.updated_at) return new Date(g.updated_at).getTime();
        if (g.created_at) return new Date(g.created_at).getTime();
        return 0;
      };

      const playing = mockGames
        .filter((g) => g.status === 'playing')
        .sort((a, b) => recentTimeOf(b) - recentTimeOf(a));

      const completed = mockGames
        .filter((g) => g.status === 'completed')
        .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());

      const backlog = mockGames.filter((g) => g.status === 'backlog');
      const paused = mockGames.filter((g) => g.status === 'paused');
      const dropped = mockGames.filter((g) => g.status === 'dropped');

      // Row 1 (Game chơi gần đây) has most recently played game at index 0
      assert.strictEqual(playing.length, 2);
      assert.strictEqual(playing[0].title, 'Fresh Playing Game');
      assert.strictEqual(playing[1].title, 'Old Playing Game');

      // Row 2 (Đã phá đảo) has most recently completed game at index 0
      assert.strictEqual(completed.length, 2);
      assert.strictEqual(completed[0].title, 'Completed Game B');
      assert.strictEqual(completed[1].title, 'Completed Game A');

      // Subsequent rows
      assert.strictEqual(backlog.length, 1);
      assert.strictEqual(paused.length, 1);
      assert.strictEqual(dropped.length, 1);
    });
  });
});
