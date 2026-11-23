import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import esbuild from 'esbuild';
import fs from 'node:fs';

const distElectron = path.resolve('dist-electron');
if (!fs.existsSync(distElectron)) {
  fs.mkdirSync(distElectron, { recursive: true });
}

const bannerJs = `
import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __pathDirname } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
`.trim();

async function startDev() {
  console.log('[dev] Building Electron main & preload...');

  // 1. Initial build of Electron main & preload
  await Promise.all([
    esbuild.build({
      entryPoints: ['src/main/main.ts'],
      outfile: 'dist-electron/main.js',
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      external: ['electron', 'koffi', 'node:sqlite', 'sqlite', 'node:*'],
      sourcemap: true,
      banner: { js: bannerJs },
    }),
    esbuild.build({
      entryPoints: ['src/preload/preload.ts'],
      outfile: 'dist-electron/preload.cjs',
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      external: ['electron'],
      sourcemap: true,
    }),
  ]);

  if (fs.existsSync('dist-electron/preload.cjs')) {
    fs.copyFileSync('dist-electron/preload.cjs', 'dist-electron/preload.js');
  }

  // 2. Start Vite Dev Server
  console.log('[dev] Starting Vite dev server...');
  const viteServer = await createServer({
    configFile: path.resolve('vite.config.ts'),
    server: {
      port: 5173,
    },
  });

  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5173;
  const devUrl = `http://localhost:${port}`;
  console.log(`[dev] Vite dev server running at: ${devUrl}`);

  // 3. Launch Electron (with auto-restart on main-process rebuilds —
  // a stale main process silently drops new backend behavior)
  console.log('[dev] Launching Electron...');
  // Find electron binary from node_modules — use the raw .exe on Windows:
  // spawning the .cmd shim without shell:true throws EINVAL on Node >= 20.12
  const electronPath = process.platform === 'win32'
    ? path.resolve('node_modules', 'electron', 'dist', 'electron.exe')
    : path.resolve('node_modules', '.bin', 'electron');

  let electronProcess = null;
  let restarting = false;
  let restartTimer = null;

  const spawnElectron = () => {
    const proc = spawn(electronPath, ['.'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: devUrl,
        NODE_ENV: 'development',
      },
    });
    proc.on('close', async (code) => {
      // Killed on purpose, or the exit event of a replaced instance arriving
      // after the respawn (restarting already reset) — the current instance
      // is what matters; treating a stale close as an app exit used to make
      // dev.js shut down the whole stack and orphan the fresh Electron.
      if (restarting || proc !== electronProcess) return;
      console.log(`[dev] Electron process exited with code ${code}`);
      await viteServer.close();
      process.exit(code ?? 0);
    });
    return proc;
  };

  const restartElectron = () => {
    if (restarting) return;
    restarting = true;
    console.log('[dev] Electron main rebuilt — restarting Electron...');
    try {
      electronProcess?.kill();
    } catch {}
    // Give the old process a moment to release file handles, then respawn
    setTimeout(() => {
      electronProcess = spawnElectron();
      restarting = false;
    }, 300);
  };

  electronProcess = spawnElectron();

  // Watch for main process changes and hot-restart Electron so the running
  // app always matches the freshly built dist-electron/main.js
  const ctx = await esbuild.context({
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist-electron/main.js',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    external: ['electron', 'koffi', 'node:sqlite', 'sqlite', 'node:*'],
    sourcemap: true,
    banner: { js: bannerJs },
    plugins: [
      {
        name: 'electron-restart',
        setup(build) {
          let firstBuild = true;
          build.onEnd(() => {
            if (firstBuild) {
              firstBuild = false;
              return;
            }
            if (restartTimer) clearTimeout(restartTimer);
            restartTimer = setTimeout(() => restartElectron(), 300);
          });
        },
      },
    ],
  });
  await ctx.watch();
}

startDev().catch((err) => {
  console.error('[dev] Dev failed to start:', err);
  process.exit(1);
});
