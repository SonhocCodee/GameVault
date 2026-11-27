import os from 'node:os';
import { app } from 'electron';
import { getAuthStatus, getValidSessionToken, getWorkerBaseUrl } from './auth.js';
import { getHardwareInfo } from './hardware.js';
import { readRecentLogs } from './logger.js';
import type {
  BugReportItem,
  CreateBugReportPayload,
  CreateBugReportResult,
} from '../shared/types.js';

export async function submitBugReport(payload: CreateBugReportPayload): Promise<CreateBugReportResult> {
  const auth = getAuthStatus();
  if (!auth.loggedIn) {
    return { ok: false, error: 'Vui lòng đăng nhập tài khoản Google trước khi gửi báo lỗi.' };
  }

  const token = await getValidSessionToken();
  if (!token) {
    return { ok: false, error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' };
  }

  const title = (payload?.title || '').trim();
  const description = (payload?.description || '').trim();
  if (title.length < 3) {
    return { ok: false, error: 'Tiêu đề lỗi phải có ít nhất 3 ký tự.' };
  }
  if (description.length < 5) {
    return { ok: false, error: 'Mô tả chi tiết lỗi phải có ít nhất 5 ký tự.' };
  }

  let gpuSummary = '';
  let logText = '';
  if (payload.includeLogs !== false) {
    try {
      const hw = await getHardwareInfo(false);
      gpuSummary = hw.gpus.map((g) => `${g.name} (${g.driver}, ${g.vram_mb}MB)`).join(' | ') || 'none';
    } catch {
      gpuSummary = 'unknown';
    }
    try {
      logText = readRecentLogs();
    } catch {
      logText = '';
    }
  }

  const baseUrl = getWorkerBaseUrl();
  const res = await fetch(`${baseUrl}/api/bugs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title,
      category: payload.category || 'other',
      severity: payload.severity || 'medium',
      description,
      app_version: app.getVersion(),
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      gpu_summary: gpuSummary,
      log_text: logText,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    return { ok: false, error: data?.error || `HTTP ${res.status}` };
  }
  return { ok: true, bug: data?.bug as BugReportItem | undefined };
}

export async function getBugReports(
  scope: 'mine' | 'all' = 'mine'
): Promise<{ ok: boolean; bugs: BugReportItem[]; error?: string }> {
  const auth = getAuthStatus();
  if (!auth.loggedIn) {
    return { ok: false, bugs: [], error: 'Vui lòng đăng nhập tài khoản Google để xem danh sách báo lỗi.' };
  }

  const token = await getValidSessionToken();
  if (!token) {
    return { ok: false, bugs: [], error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' };
  }

  const baseUrl = getWorkerBaseUrl();
  const safeScope = scope === 'all' ? 'all' : 'mine';
  const res = await fetch(`${baseUrl}/api/bugs?scope=${safeScope}&limit=40`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    return { ok: false, bugs: [], error: data?.error || `HTTP ${res.status}` };
  }

  return { ok: true, bugs: Array.isArray(data?.bugs) ? data.bugs : [] };
}
