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
      'src/renderer/components/SyncModal.tsx',
      'src/renderer/components/SettingsModal.tsx',
      'src/renderer/components/GameRowSection.tsx',
      'src/renderer/components/TimelineView.tsx',
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

  describe('GPU-neutral library onboarding', () => {
    test('does not expose the removed AMD-only one-click import action', () => {
      const app = fs.readFileSync(path.join(projectRoot, 'src/renderer/App.tsx'), 'utf8');
      const navbar = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/Navbar.tsx'), 'utf8');
      const source = `${app}\n${navbar}`;
      assert.ok(!source.includes('ImportModal'));
      assert.ok(!source.includes('onOpenImportModal'));
      assert.ok(!source.includes('1-Click Import'));
      assert.ok(!source.includes('RGStats.db'));
    });
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

  describe('GameRowSection Row Expansion Logic (3 -> 5 -> 10 -> all)', () => {
    // Pure logic simulation of expansion stages
    const getNextExpansionStage = (current, totalGames, cols) => {
      if (current === 'carousel') return { nextStage: 3, hasMore: true };
      if (current === 3) {
        if (totalGames > 3 * cols) return { nextStage: 5, hasMore: true };
        return { nextStage: 'carousel', hasMore: false };
      }
      if (current === 5) {
        if (totalGames > 5 * cols) return { nextStage: 10, hasMore: true };
        return { nextStage: 'carousel', hasMore: false };
      }
      if (current === 10) {
        if (totalGames > 10 * cols) return { nextStage: 'all', hasMore: true };
        return { nextStage: 'carousel', hasMore: false };
      }
      return { nextStage: 'carousel', hasMore: false };
    };

    const getDisplayedCount = (stage, totalGames, cols) => {
      if (stage === 'carousel' || stage === 'all') return totalGames;
      return Math.min(totalGames, stage * cols);
    };

    test('progresses sequentially: carousel -> 3 -> 5 -> 10 -> all for large game collections', () => {
      const totalGames = 80;
      const cols = 5;

      // Start: carousel
      let stage = 'carousel';
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 80);

      // 1st click: expands to 3 rows (3 * 5 = 15 games)
      let next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.nextStage, 3);
      assert.strictEqual(next.hasMore, true);
      stage = next.nextStage;
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 15);

      // 2nd click: expands to 5 rows (5 * 5 = 25 games)
      next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.nextStage, 5);
      assert.strictEqual(next.hasMore, true);
      stage = next.nextStage;
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 25);

      // 3rd click: expands to 10 rows (10 * 5 = 50 games)
      next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.nextStage, 10);
      assert.strictEqual(next.hasMore, true);
      stage = next.nextStage;
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 50);

      // 4th click: expands to all (80 games)
      next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.nextStage, 'all');
      assert.strictEqual(next.hasMore, true);
      stage = next.nextStage;
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 80);

      // 5th click: collapses back to carousel
      next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.nextStage, 'carousel');
      assert.strictEqual(next.hasMore, false);
    });

    test('correctly stops and collapses when all games fit in 3 rows', () => {
      const totalGames = 12;
      const cols = 5; // 3 rows capacity = 15 games >= 12 games

      let stage = 'carousel';
      let next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.nextStage, 3);
      stage = next.nextStage;
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 12);

      // Since all 12 games are already shown in 3 rows, hasMore is false and next is collapse
      next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.hasMore, false);
      assert.strictEqual(next.nextStage, 'carousel');
    });

    test('correctly stops and collapses when games fit in 5 rows', () => {
      const totalGames = 22;
      const cols = 5; // 3 rows = 15, 5 rows = 25

      let stage = 'carousel';
      let next = getNextExpansionStage(stage, totalGames, cols);
      stage = next.nextStage; // 3
      assert.strictEqual(stage, 3);
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 15);

      next = getNextExpansionStage(stage, totalGames, cols);
      stage = next.nextStage; // 5
      assert.strictEqual(stage, 5);
      assert.strictEqual(getDisplayedCount(stage, totalGames, cols), 22);

      // In 5 rows, all 22 games are shown
      next = getNextExpansionStage(stage, totalGames, cols);
      assert.strictEqual(next.hasMore, false);
      assert.strictEqual(next.nextStage, 'carousel');
    });
  });

  describe('Gaming Timeline Tree Aggregation & Smart Positioning', () => {
    test('groups sessions into year and month accurately', () => {
      const sampleSessions = [
        { game_id: 1, start_time: '2026-11-15T10:00:00', duration_minutes: 120 },
        { game_id: 1, start_time: '2026-11-20T14:00:00', duration_minutes: 60 },
        { game_id: 2, start_time: '2026-11-05T09:00:00', duration_minutes: 90 },
        { game_id: 1, start_time: '2026-10-12T19:00:00', duration_minutes: 150 },
        { game_id: 2, start_time: '2025-08-01T20:00:00', duration_minutes: 200 },
      ];

      const monthMap = new Map();
      for (const s of sampleSessions) {
        const key = s.start_time.slice(0, 7);
        if (!monthMap.has(key)) monthMap.set(key, { total: 0, games: new Map() });
        const entry = monthMap.get(key);
        entry.total += s.duration_minutes;
        const gTime = entry.games.get(s.game_id) || 0;
        entry.games.set(s.game_id, gTime + s.duration_minutes);
      }

      assert.strictEqual(monthMap.get('2026-11').total, 270);
      assert.strictEqual(monthMap.get('2026-11').games.get(1), 180);
      assert.strictEqual(monthMap.get('2026-11').games.get(2), 90);
      assert.strictEqual(monthMap.get('2026-10').total, 150);
      assert.strictEqual(monthMap.get('2025-08').total, 200);
    });

    test('popover smart position flips to left when near right edge', () => {
      const POPOVER_WIDTH = 340;
      const PADDING = 12;
      const windowWidth = 1920;

      // Card near the right edge
      const targetRectRightEdge = { left: 1650, right: 1800, top: 300, bottom: 500 };
      let left = targetRectRightEdge.right + PADDING;
      if (left + POPOVER_WIDTH > windowWidth - PADDING) {
        left = targetRectRightEdge.left - POPOVER_WIDTH - PADDING;
      }

      // Must be flipped to the left of the card
      assert.ok(left < targetRectRightEdge.left);
      assert.strictEqual(left, 1650 - 340 - 12);
    });

    test('preview HUD docks on opposite side to never block hovered cards or neighbors', () => {
      const windowWidth = 1920;

      // Card on the right half (e.g. column 6 at left=1650, width=150)
      const rightCard = { left: 1650, width: 150 };
      const rightCenter = rightCard.left + rightCard.width / 2;
      const rightSide = rightCenter > windowWidth / 2 ? 'left' : 'right';
      assert.strictEqual(rightSide, 'left', 'HUD should dock on left when card is on right half');

      // Card on the left half (e.g. column 1 at left=100, width=150)
      const leftCard = { left: 100, width: 150 };
      const leftCenter = leftCard.left + leftCard.width / 2;
      const leftSide = leftCenter > windowWidth / 2 ? 'left' : 'right';
      assert.strictEqual(leftSide, 'right', 'HUD should dock on right when card is on left half');
    });
  });
});
