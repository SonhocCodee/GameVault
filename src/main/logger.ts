import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { getDbDir } from './db.ts';
import { getValidSessionToken, getWorkerBaseUrl, getAuthStatus } from './auth.ts';
import { getHardwareInfo } from './hardware.ts';

const MAX_LOG_BYTES = 512 * 1024; // 512 KB per file, keeps 1 rotated backup
const MAX_UPLOAD_CHARS = 120_000;

let loggerInitialized = false;

export function getLogFilePath(): string {
  try {
    return path.join(getDbDir(), 'gamevault.log');
  } catch {
    return path.join(app.getPath('userData'), 'gamevault.log');
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
      }
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

export function appendLogLine(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  try {
    const logPath = getLogFilePath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    try {
      const stat = fs.statSync(logPath);
      if (stat.size >= MAX_LOG_BYTES) {
        const backup = `${logPath}.1`;
        try { fs.rmSync(backup, { force: true }); } catch {}
        fs.renameSync(logPath, backup);
      }
    } catch {}
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // Never throw from logger
  }
}

/**
 * Mirrors main-process console output + uncaught errors into gamevault.log
 * so packaged .exe builds retain full diagnostic history.
 */
export function initLogger(): void {
  if (loggerInitialized) return;
  loggerInitialized = true;

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    origLog(...args);
    appendLogLine('INFO', formatArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    appendLogLine('WARN', formatArgs(args));
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    appendLogLine('ERROR', formatArgs(args));
  };

  process.on('uncaughtException', (err) => {
    appendLogLine('ERROR', `[uncaughtException] ${formatArgs([err])}`);
  });
  process.on('unhandledRejection', (reason) => {
    appendLogLine('ERROR', `[unhandledRejection] ${formatArgs([reason])}`);
  });

  appendLogLine(
    'INFO',
    `GameVault started v${app.getVersion()} (${process.platform} ${process.arch}, Electron ${process.versions.electron}, packaged=${app.isPackaged})`
  );
}

export function readRecentLogs(maxChars: number = MAX_UPLOAD_CHARS): string {
  const logPath = getLogFilePath();
  const backupPath = `${logPath}.1`;
  let combined = '';
  try {
    if (fs.existsSync(backupPath)) {
      combined += fs.readFileSync(backupPath, 'utf8');
    }
  } catch {}
  try {
    if (fs.existsSync(logPath)) {
      combined += fs.readFileSync(logPath, 'utf8');
    }
  } catch {}
  if (combined.length <= maxChars) return combined;
  return `...(truncated)\n${combined.slice(-maxChars)}`;
}

export async function sendDiagnosticLogToServer(note?: string): Promise<{ ok: boolean; id?: number; error?: string }> {
  const auth = getAuthStatus();
  if (!auth.loggedIn) {
    return { ok: false, error: 'Vui lòng đăng nhập tài khoản trước khi gửi log lên server.' };
  }
  const token = await getValidSessionToken();
  if (!token) {
    return { ok: false, error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' };
  }

  let gpuSummary = 'unknown';
  try {
    const hw = await getHardwareInfo(false);
    gpuSummary = hw.gpus.map((g) => `${g.name} (${g.driver}, ${g.vram_mb}MB)`).join(' | ') || 'none';
  } catch {}

  const logText = readRecentLogs();
  const baseUrl = getWorkerBaseUrl();
  const res = await fetch(`${baseUrl}/api/logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      app_version: app.getVersion(),
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      gpu_summary: gpuSummary,
      note: (note || '').trim().slice(0, 500),
      log_text: logText || '(empty log)',
    }),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    return { ok: false, error: data?.error || `HTTP ${res.status}` };
  }
  return { ok: true, id: Number(data?.id) || undefined };
}
