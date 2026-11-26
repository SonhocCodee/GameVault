import fs from 'node:fs';
import path from 'node:path';

/**
 * Copies optional local cloud-config.json overrides into dist-electron when present.
 * Built-in public desktop OAuth config lives in src/main/auth.ts; never write
 * server secrets or duplicate secret-looking files during install/build.
 */
export function ensureCloudConfig() {
  const configPath = path.resolve('cloud-config.json');
  const distElectron = path.resolve('dist-electron');
  if (fs.existsSync(distElectron) && fs.existsSync(configPath)) {
    const distConfig = path.join(distElectron, 'cloud-config.json');
    if (!fs.existsSync(distConfig)) {
      fs.copyFileSync(configPath, distConfig);
    }
  }
}

// Allow direct CLI execution: node scripts/ensure-config.js
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/ensure-config.js')) {
  ensureCloudConfig();
}
