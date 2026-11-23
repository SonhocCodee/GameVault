import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { getDbDir } from './db.ts';

// PresentMon is GPU-agnostic (ETW-based frame capture works on NVIDIA, AMD and
// Intel alike). AMD Adrenalin bundles a copy; NVIDIA machines don't ship one,
// so GameVault can download the official Intel release into its own bin folder.

const RELEASE_API = 'https://api.github.com/repos/GameTechDev/PresentMon/releases/latest';
const MIN_EXE_BYTES = 500 * 1024; // standalone exe is ~0.9MB — smaller means corrupt

/**
 * Location GameVault manages: the downloaded official PresentMon binary.
 */
export function getManagedPresentMonPath(): string {
  return path.join(getDbDir(), 'bin', 'PresentMon.exe');
}

/**
 * Builds the search candidates on every call (env override stays testable).
 * Priority: explicit override > GameVault-managed download > vendor bundles.
 */
function buildCandidates(): string[] {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  return [
    process.env.GAMEVAULT_PRESENTMON_PATH,
    getManagedPresentMonPath(),
    path.join(pf, 'AMD', 'CNext', 'CNext', 'PresentMon-x64.exe'),
    path.join(pf, 'AMD', 'CNext', 'CNext', 'PresentMon.exe'),
    path.join(pf, 'Intel', 'PresentMon', 'PresentMon.exe'),
    path.join(pf, 'Intel', 'PresentMon', 'PresentMon-x64.exe'),
  ].filter((p): p is string => Boolean(p));
}

export function findPresentMon(): string | null {
  for (const candidate of buildCandidates()) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/**
 * Picks the standalone Windows executable from a release's asset list.
 * Prefers an explicit x64 exe; ignores .msi/.zip/symbol archives.
 */
export function pickPresentMonAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const exes = (assets || []).filter((a) => /\.exe$/i.test(a.name || ''));
  if (exes.length === 0) return null;
  const x64 = exes.find((a) => /x64|amd64|win64/i.test(a.name));
  return x64 || exes[0];
}

/** Downloads a URL following GitHub's redirects into destPath. */
function downloadFile(url: string, destPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve();
    };

    const request = (target: string, redirectsLeft: number) => {
      const req = https.get(
        target,
        { headers: { 'User-Agent': 'GameVault', Accept: 'application/octet-stream' } },
        (res) => {
          if (settled) return;
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              done(new Error('Too many redirects downloading PresentMon'));
              return;
            }
            request(new URL(res.headers.location, target).toString(), redirectsLeft - 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            done(new Error(`HTTP ${status} downloading PresentMon`));
            return;
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => file.close(() => done()));
          file.on('error', (err) => done(err));
        }
      );
      req.on('error', (err) => done(err));
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout downloading PresentMon (${timeoutMs}ms)`));
      });
    };

    request(url, 5);
  });
}

/** Fetches a JSON document (GitHub API) with a hard timeout. */
function fetchJson(url: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, data?: string) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else {
        try {
          resolve(JSON.parse(data || ''));
        } catch (parseErr) {
          reject(parseErr as Error);
        }
      }
    };

    const req = https.get(
      url,
      { headers: { 'User-Agent': 'GameVault', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (settled) return;
        if ((res.statusCode || 0) !== 200) {
          res.resume();
          finish(new Error(`GitHub API HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => finish(undefined, body));
        res.on('error', (err) => finish(err));
      }
    );
    req.on('error', (err) => finish(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('GitHub API timeout'));
    });
  });
}

/**
 * Returns a usable PresentMon path: an existing install if present, otherwise
 * downloads the official release (Intel's PresentMon — works on NVIDIA, AMD
 * and Intel GPUs) into GameVault's managed bin folder. Returns null on failure.
 */
export async function downloadPresentMon(force: boolean = false): Promise<string | null> {
  const existing = findPresentMon();
  if (existing && !force) {
    return existing;
  }

  const managed = getManagedPresentMonPath();
  try {
    if (fs.existsSync(managed) && !force) {
      return managed;
    }

    const release = await fetchJson(RELEASE_API, 20000);
    const asset = pickPresentMonAsset(release.assets || []);
    if (!asset) {
      throw new Error('No standalone .exe asset in the latest PresentMon release');
    }

    fs.mkdirSync(path.dirname(managed), { recursive: true });
    const tmpPath = `${managed}.tmp`;
    await downloadFile(asset.browser_download_url, tmpPath, 120000);

    const stat = fs.statSync(tmpPath);
    if (stat.size < MIN_EXE_BYTES) {
      throw new Error(`Downloaded PresentMon looks corrupt (${stat.size} bytes)`);
    }
    fs.rmSync(managed, { force: true });
    fs.renameSync(tmpPath, managed);
    console.log(`[presentmon] Downloaded ${asset.name} -> ${managed}`);
    return managed;
  } catch (err) {
    try { fs.rmSync(`${managed}.tmp`, { force: true }); } catch {}
    console.warn('[presentmon] Failed to obtain PresentMon:', err);
    return null;
  }
}

/**
 * NVIDIA enrichment: registry VRAM is sometimes 0 on NVIDIA adapters —
 * patch it (and refresh driver info) from nvidia-smi when available.
 */
export async function enrichGpusWithNvidiaSmi(
  gpus: Array<{ name: string; driver: string; vram_mb: number }>
): Promise<Array<{ name: string; driver: string; vram_mb: number }>> {
  const needsFix = gpus.some((g) => /nvidia/i.test(g.name) && !g.vram_mb);
  if (!needsFix) return gpus;

  const output = await new Promise<string>((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(err ? '' : String(stdout || ''))
    );
  });

  if (!output.trim()) return gpus;

  for (const line of output.split(/\r?\n/)) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3) continue;
    const [name, driver, vramMb] = parts;
    const target = gpus.find((g) => /nvidia/i.test(g.name) && !g.vram_mb);
    if (target && name) {
      target.name = name;
      if (driver) target.driver = driver;
      const mb = parseInt(vramMb, 10);
      if (Number.isFinite(mb) && mb > 0) target.vram_mb = mb;
    }
  }
  return gpus;
}
