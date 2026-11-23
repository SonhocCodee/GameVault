import { execFile } from 'node:child_process';
import { getDb } from './db.ts';
import { findPresentMon, enrichGpusWithNvidiaSmi } from './presentmon.ts';
import type { HardwareInfo, HardwareGpu } from '../shared/types.js';

const HARDWARE_INFO_KEY = 'hardware_info';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // re-collect every 6h (driver/monitor changes)

/**
 * Collects a hardware snapshot (CPU / GPU / RAM / OS / display) via a single
 * PowerShell CIM + registry query. VRAM is read from the display class
 * registry keys because Win32_VideoController.AdapterRAM saturates at 4 GB.
 */
export async function collectHardwareInfo(): Promise<HardwareInfo> {
  const info = await collectHardwareInfoRaw();
  // NVIDIA cards sometimes report 0 VRAM from the registry — patch via nvidia-smi
  try {
    info.gpus = await enrichGpusWithNvidiaSmi(info.gpus);
  } catch {}
  info.presentmon_path = findPresentMon();
  return info;
}

/** Runs the PowerShell hardware query and shapes the raw result. */
function collectHardwareInfoRaw(): Promise<HardwareInfo> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$vc = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution -gt 0 } | Select-Object -First 1
$gpus = @()
Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -match '^\\d{4}$' } |
  ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p.DriverDesc -and "$($p.DriverDesc)" -notmatch 'Virtual|RemoteFX|Basic Render|Indirect Display') {
      $vramMb = 0
      if ($p.'HardwareInformation.qwMemorySize') { $vramMb = [math]::Round($p.'HardwareInformation.qwMemorySize' / 1MB) }
      elseif ($p.AdapterRAM) { $vramMb = [math]::Round($p.AdapterRAM / 1MB) }
      $gpus += [ordered]@{ name = $p.DriverDesc; driver = "$($p.DriverVersion)"; vram_mb = $vramMb }
    }
  }
if ($gpus.Count -eq 0) {
  Get-CimInstance Win32_VideoController | ForEach-Object {
    $gpus += [ordered]@{ name = $_.Name; driver = "$($_.DriverVersion)"; vram_mb = [math]::Round($_.AdapterRAM / 1MB) }
  }
}
$display = $null
if ($vc -and $vc.CurrentHorizontalResolution -gt 0) {
  $display = [ordered]@{
    width = [int]$vc.CurrentHorizontalResolution
    height = [int]$vc.CurrentVerticalResolution
    refresh_hz = [int]$vc.CurrentRefreshRate
  }
}
[pscustomobject]@{
  os_name = "$($os.Caption)".Trim()
  os_build = "$($os.BuildNumber).$($os.Version)"
  cpu_name = "$($cpu.Name)".Trim()
  cpu_cores = [int]$cpu.NumberOfCores
  cpu_threads = [int]$cpu.NumberOfLogicalProcessors
  ram_gb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  gpus = $gpus
  display = $display
} | ConvertTo-Json -Depth 3 -Compress
`.trim();

  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 20000, windowsHide: true },
      (err, stdout) => {
        if (err && !stdout) {
          reject(new Error(`Hardware query failed: ${err.message}`));
          return;
        }
        try {
          const raw = JSON.parse(stdout.trim());
          const gpus: HardwareGpu[] = Array.isArray(raw.gpus)
            ? raw.gpus.map((g: any) => ({
                name: String(g?.name ?? 'Unknown GPU'),
                driver: String(g?.driver ?? ''),
                vram_mb: Number(g?.vram_mb) || 0,
              }))
            : [];
          const info: HardwareInfo = {
            collected_at: new Date().toISOString(),
            os_name: String(raw.os_name ?? ''),
            os_build: String(raw.os_build ?? ''),
            cpu_name: String(raw.cpu_name ?? ''),
            cpu_cores: Number(raw.cpu_cores) || 0,
            cpu_threads: Number(raw.cpu_threads) || 0,
            ram_gb: Number(raw.ram_gb) || 0,
            gpus,
            display: raw.display
              ? {
                  width: Number(raw.display.width) || 0,
                  height: Number(raw.display.height) || 0,
                  refresh_hz: Number(raw.display.refresh_hz) || 0,
                }
              : null,
            presentmon_path: findPresentMon(),
          };
          if (!info.cpu_name && info.gpus.length === 0) {
            reject(new Error('Hardware query returned empty data'));
            return;
          }
          resolve(info);
        } catch (parseErr) {
          reject(new Error(`Failed to parse hardware query output: ${(parseErr as Error).message}`));
        }
      }
    );
    // Stderr is noise from CIM warnings — drain it to avoid buffer buildup
    child.stderr?.resume();
  });
}

/**
 * Returns the cached hardware snapshot if fresh (or `force` is false and one
 * exists), otherwise collects and stores a new one.
 */
export async function getHardwareInfo(force: boolean = false): Promise<HardwareInfo> {
  const db = getDb();
  if (!force) {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(HARDWARE_INFO_KEY) as any;
      if (row?.value) {
        const cached = JSON.parse(row.value) as HardwareInfo;
        const age = Date.now() - new Date(cached.collected_at).getTime();
        if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
          return cached;
        }
      }
    } catch {
      // Corrupt cache — fall through to re-collect
    }
  }

  const info = await collectHardwareInfo();
  try {
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now', 'localtime')
    `).run(HARDWARE_INFO_KEY, JSON.stringify(info));
  } catch {
    // Cache write failure must not break the caller
  }
  return info;
}
