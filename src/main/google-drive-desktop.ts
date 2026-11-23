import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { GoogleDriveDesktopStatus, AppSettings } from '../shared/types.js';
import { loadAppSettings, saveAppSettings } from './settings.js';
import { setMediaBaseDir, resolveMediaRoot } from './media.js';

const execAsync = promisify(exec);

/**
 * Detects if Google Drive for Desktop is installed, running, and where it is mounted.
 */
export async function detectGoogleDriveDesktop(currentMediaDir?: string): Promise<GoogleDriveDesktopStatus> {
  const settings = loadAppSettings();
  const effectiveMediaDir = currentMediaDir || settings.mediaBaseDir || resolveMediaRoot();

  let installed = false;
  let running = false;
  let mountedDrive: string | null = null;
  let myDrivePath: string | null = null;

  // 1. Check if Google Drive process is running
  try {
    const { stdout } = await execAsync(
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "@(Get-Process -Name GoogleDriveFS -ErrorAction SilentlyContinue).Count"'
    );
    const count = parseInt(stdout.trim(), 10);
    if (!isNaN(count) && count > 0) {
      running = true;
      installed = true;
    }
  } catch {}

  // 2. Check installation paths if not verified running yet
  if (!installed) {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    const installCandidates = [
      path.join(progFiles, 'Google', 'Drive File Stream'),
      path.join(progFilesX86, 'Google', 'Drive File Stream'),
      localAppData ? path.join(localAppData, 'Google', 'DriveFS') : '',
    ];

    for (const p of installCandidates) {
      if (p && fs.existsSync(p)) {
        installed = true;
        break;
      }
    }
  }

  // 3. Scan drives for mounted Google Drive
  // Typical letters for Google Drive: G, H, I, J, K, D, E, F, etc.
  const driveLetters = 'GHIJKLMNOPQRSTUVWXYZFED'.split('');
  for (const letter of driveLetters) {
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) {
        // Look for common Google Drive folder names
        const subfolders = ['My Drive', 'Drive của tôi'];
        for (const sub of subfolders) {
          const testPath = path.join(root, sub);
          if (fs.existsSync(testPath)) {
            mountedDrive = `${letter}:`;
            myDrivePath = testPath;
            break;
          }
        }
        if (mountedDrive) break;
      }
    } catch {}
  }

  // 4. Query Win32_LogicalDisk for volume name if not yet located
  if (!mountedDrive) {
    try {
      const psScript = `Get-CimInstance Win32_LogicalDisk | Where-Object { $_.VolumeName -like '*Google Drive*' } | Select-Object -ExpandProperty DeviceID`;
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      const { stdout } = await execAsync(`powershell.exe -NoProfile -EncodedCommand ${encoded}`);
      const devId = stdout.trim();
      if (devId && devId.length >= 2) {
        mountedDrive = devId.substring(0, 2);
        const myDriveCandidate = path.join(`${mountedDrive}\\`, 'My Drive');
        if (fs.existsSync(myDriveCandidate)) {
          myDrivePath = myDriveCandidate;
        } else {
          myDrivePath = `${mountedDrive}\\`;
        }
      }
    } catch {}
  }

  // 5. Check local mirror paths (when user configures Mirror mode instead of Stream mode)
  if (!myDrivePath && process.env.USERPROFILE) {
    const userProfile = process.env.USERPROFILE;
    const localCandidates = [
      path.join(userProfile, 'Google Drive', 'My Drive'),
      path.join(userProfile, 'Google Drive'),
      path.join(userProfile, 'My Drive'),
    ];
    for (const lc of localCandidates) {
      if (fs.existsSync(lc)) {
        myDrivePath = lc;
        if (!mountedDrive) {
          mountedDrive = lc.substring(0, 2);
        }
        break;
      }
    }
  }

  const suggestedMediaDir = myDrivePath
    ? path.join(myDrivePath, 'GameVault')
    : (mountedDrive ? path.join(mountedDrive, 'GameVault') : null);

  // 6. Check if current mediaBaseDir is using Google Drive
  let isCurrentlyUsed = false;
  if (effectiveMediaDir) {
    const normMedia = path.normalize(effectiveMediaDir).toLowerCase();
    if (suggestedMediaDir && normMedia.startsWith(path.normalize(suggestedMediaDir).toLowerCase())) {
      isCurrentlyUsed = true;
    } else if (myDrivePath && normMedia.startsWith(path.normalize(myDrivePath).toLowerCase())) {
      isCurrentlyUsed = true;
    } else if (mountedDrive && normMedia.startsWith(path.normalize(mountedDrive).toLowerCase())) {
      isCurrentlyUsed = true;
    }
  }

  return {
    installed,
    running,
    mountedDrive,
    myDrivePath,
    suggestedMediaDir,
    isCurrentlyUsed,
  };
}

/**
 * Applies Google Drive as the primary media storage directory:
 * - Updates mediaBaseDir
 * - Turns OFF HDD mode (switches to SSD/Direct mode) so screenshots write directly into Drive without temp buffer
 * - Recursively creates the directory if needed
 * - Updates media base directory resolver
 */
export async function applyGoogleDriveDesktopStorage(
  customPath?: string
): Promise<{ ok: boolean; settings: AppSettings; error?: string }> {
  try {
    let targetPath = customPath ? customPath.trim() : '';
    if (!targetPath) {
      const status = await detectGoogleDriveDesktop();
      targetPath = status.suggestedMediaDir || (status.mountedDrive ? path.join(status.mountedDrive, 'GameVault') : '');
    }

    if (!targetPath) {
      return {
        ok: false,
        settings: loadAppSettings(),
        error: 'Chưa phát hiện ổ đĩa Google Drive trên máy. Vui lòng cài đặt và đăng nhập Google Drive for Desktop trước.'
      };
    }

    // Ensure directory exists
    try {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
    } catch (err: any) {
      return {
        ok: false,
        settings: loadAppSettings(),
        error: `Không thể tạo thư mục trên ổ Google Drive: ${err?.message || err}`
      };
    }

    // Save settings: set mediaBaseDir to targetPath, and set hddMode to false (direct SSD/Cloud save mode)
    const updated = saveAppSettings({
      mediaBaseDir: targetPath,
      hddMode: false,
    });

    setMediaBaseDir(updated.mediaBaseDir);

    return {
      ok: true,
      settings: updated,
    };
  } catch (err: any) {
    return {
      ok: false,
      settings: loadAppSettings(),
      error: err?.message || 'Lỗi khi kích hoạt lưu trữ Google Drive'
    };
  }
}
