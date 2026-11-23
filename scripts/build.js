import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { ensureCloudConfig } from './ensure-config.js';

ensureCloudConfig();

const isWatch = process.argv.includes('--watch');

const distElectron = path.resolve('dist-electron');
if (!fs.existsSync(distElectron)) {
  fs.mkdirSync(distElectron, { recursive: true });
}

// Common externals for Node/Electron main process
const mainExternal = [
  'electron',
  'koffi',
  'node:sqlite',
  'sqlite',
  'node:*',
];

const bannerJs = `
import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __pathDirname } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
`.trim();

/** @type {import('esbuild').BuildOptions} */
const mainConfig = {
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist-electron/main.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: mainExternal,
  sourcemap: true,
  banner: {
    js: bannerJs,
  },
};

/** @type {import('esbuild').BuildOptions} */
const preloadConfig = {
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
};

async function buildAll() {
  const startTime = Date.now();
  console.log('[build] Bundling Electron main and preload processes...');

  try {
    if (isWatch) {
      const ctxMain = await esbuild.context(mainConfig);
      const ctxPreload = await esbuild.context(preloadConfig);
      await Promise.all([ctxMain.watch(), ctxPreload.watch()]);
      console.log('[build] Watching Electron files for changes...');
    } else {
      await Promise.all([
        esbuild.build(mainConfig),
        esbuild.build(preloadConfig),
      ]);
      // Also copy/duplicate preload.cjs to preload.js for backward compatibility
      if (fs.existsSync('dist-electron/preload.cjs')) {
        fs.copyFileSync('dist-electron/preload.cjs', 'dist-electron/preload.js');
      }
      if (fs.existsSync('cloud-config.json')) {
        fs.copyFileSync('cloud-config.json', 'dist-electron/cloud-config.json');
      }
      const elapsed = Date.now() - startTime;
      console.log(`[build] Electron build completed in ${elapsed}ms.`);
    }
  } catch (err) {
    console.error('[build] Electron build failed:', err);
    process.exit(1);
  }
}

buildAll();
