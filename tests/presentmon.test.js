import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findPresentMon,
  getManagedPresentMonPath,
  pickPresentMonAsset,
  downloadPresentMon,
  enrichGpusWithNvidiaSmi,
} from '../src/main/presentmon.ts';

describe('PresentMon discovery & download', () => {
  let tempDir;
  let previousEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv_pm_test_'));
    previousEnv = process.env.GAMEVAULT_PRESENTMON_PATH;
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.GAMEVAULT_PRESENTMON_PATH;
    } else {
      process.env.GAMEVAULT_PRESENTMON_PATH = previousEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('pickPresentMonAsset prefers the standalone x64 exe over msi/zip/pdb', () => {
    const asset = pickPresentMonAsset([
      { name: 'PresentMon-2.6.0.msi', browser_download_url: 'https://x/msi' },
      { name: 'ReleaseSymbols.zip', browser_download_url: 'https://x/zip' },
      { name: 'PresentMon-2.6.0-x64.exe', browser_download_url: 'https://x/exe' },
      { name: 'PresentMon-2.6.0-x86.exe', browser_download_url: 'https://x/exe86' },
    ]);
    assert.ok(asset);
    assert.equal(asset.name, 'PresentMon-2.6.0-x64.exe');
    assert.equal(asset.browser_download_url, 'https://x/exe');
  });

  it('pickPresentMonAsset falls back to any exe when no x64 variant exists', () => {
    const asset = pickPresentMonAsset([
      { name: 'PresentMon.msi', browser_download_url: 'https://x/msi' },
      { name: 'PresentMon.exe', browser_download_url: 'https://x/exe' },
    ]);
    assert.ok(asset);
    assert.equal(asset.name, 'PresentMon.exe');
  });

  it('pickPresentMonAsset returns null when no exe asset exists', () => {
    assert.equal(
      pickPresentMonAsset([{ name: 'PresentMon.msi', browser_download_url: 'https://x/msi' }]),
      null
    );
    assert.equal(pickPresentMonAsset([]), null);
    assert.equal(pickPresentMonAsset(undefined), null);
  });

  it('getManagedPresentMonPath points at the managed bin folder', () => {
    const managed = getManagedPresentMonPath();
    assert.ok(managed.toLowerCase().endsWith('bin' + path.sep + 'presentmon.exe'), managed);
  });

  it('findPresentMon honours the GAMEVAULT_PRESENTMON_PATH override first', () => {
    const fake = path.join(tempDir, 'my-presentmon.exe');
    fs.writeFileSync(fake, 'stub');
    process.env.GAMEVAULT_PRESENTMON_PATH = fake;
    assert.equal(findPresentMon(), fake);
  });

  it('findPresentMon skips non-existent overrides', () => {
    process.env.GAMEVAULT_PRESENTMON_PATH = path.join(tempDir, 'missing.exe');
    const found = findPresentMon();
    if (found) {
      // On AMD machines the Adrenalin-bundled copy exists — just verify the
      // broken override was not returned
      assert.notEqual(found, path.join(tempDir, 'missing.exe'));
    }
  });

  it('downloadPresentMon returns the existing install without touching the network', () => {
    const fake = path.join(tempDir, 'pm.exe');
    fs.writeFileSync(fake, 'stub');
    process.env.GAMEVAULT_PRESENTMON_PATH = fake;
    // Must resolve to the override (no download attempted) even though the
    // stub is not a real exe
    return downloadPresentMon().then((result) => {
      assert.equal(result, fake);
    });
  });
});

describe('NVIDIA GPU enrichment (nvidia-smi)', () => {
  it('leaves GPUs untouched when no NVIDIA card lacks VRAM data', async () => {
    const gpus = [{ name: 'AMD Radeon RX 7800 XT', driver: '32.0.1', vram_mb: 16368 }];
    const result = await enrichGpusWithNvidiaSmi(gpus);
    assert.equal(result, gpus, 'same object returned without changes');
  });

  it('keeps GPUs unchanged when nvidia-smi is unavailable', async () => {
    const gpus = [{ name: 'NVIDIA GeForce RTX 4070', driver: '551.23', vram_mb: 0 }];
    const result = await enrichGpusWithNvidiaSmi(gpus);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'NVIDIA GeForce RTX 4070');
    assert.equal(result[0].vram_mb, 0);
  });
});
