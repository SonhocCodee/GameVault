import fs from 'node:fs';
import path from 'node:path';
import { app, Notification } from 'electron';
import type { BrowserWindow } from 'electron';
import { communityRequest } from './cloud-db.js';
import { getCurrentSession } from './auth.ts';
import { loadAppSettings } from './settings.ts';
import type { AppSettings } from '../shared/types.js';

interface CommunityNotificationItem {
  id: string;
  postId: string;
  kind: string;
  nickname: string;
  read: boolean;
  createdAt: string;
}

interface SeenState {
  uid: string;
  seenIds: string[];
}

const MAX_SEEN_IDS = 200;
const FIRST_POLL_DELAY_MS = 20_000;

let timer: NodeJS.Timeout | null = null;
let getWindow: () => BrowserWindow | null = () => null;
let polling = false;
let seen: SeenState | null = null;

function statePath(): string {
  return path.join(app.getPath('userData'), 'community-notifications.json');
}

function loadSeenState(): SeenState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (
      raw &&
      typeof raw.uid === 'string' &&
      Array.isArray(raw.seenIds) &&
      raw.seenIds.every((id: unknown) => typeof id === 'string')
    ) {
      return { uid: raw.uid, seenIds: raw.seenIds.slice(-MAX_SEEN_IDS) };
    }
  } catch {}
  return null;
}

function persistSeenState(): void {
  if (!seen) return;
  try {
    fs.writeFileSync(statePath(), JSON.stringify(seen), 'utf8');
  } catch {}
}

function describe(item: CommunityNotificationItem): string {
  const who = item.nickname || 'Một người dùng';
  if (item.kind === 'like') return `${who} đã thả tim bài viết của bạn`;
  if (item.kind === 'comment') return `${who} đã bình luận bài viết của bạn`;
  if (item.kind === 'new_post') return `${who} vừa đăng bài mới`;
  return `${who} có hoạt động mới`;
}

function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send('community:notify-open');
}

function showSummary(fresh: CommunityNotificationItem[]): void {
  if (!Notification.isSupported() || fresh.length === 0) return;
  const body =
    fresh.length === 1
      ? describe(fresh[0])
      : `${describe(fresh[0])} và ${fresh.length - 1} thông báo khác`;
  const notification = new Notification({
    title: 'GameVault',
    body,
    icon: path.join(__dirname, '../assets/icon.png'),
  });
  notification.on('click', () => {
    const window = getWindow();
    if (window) revealWindow(window);
  });
  notification.show();
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  const session = getCurrentSession();
  if (!session?.user.uid) return;
  polling = true;
  try {
    const page = await communityRequest<{
      items: CommunityNotificationItem[];
    }>('/api/community/notifications?limit=20');
    const uid = session.user.uid;
    if (!seen || seen.uid !== uid) {
      seen = { uid, seenIds: page.items.map((n) => n.id) };
      persistSeenState();
      return;
    }
    const known = new Set(seen.seenIds);
    const fresh = page.items.filter((n) => !known.has(n.id));
    if (fresh.length === 0) return;
    seen.seenIds = [...seen.seenIds, ...fresh.map((n) => n.id)].slice(
      -MAX_SEEN_IDS,
    );
    persistSeenState();
    const window = getWindow();
    if (window && !window.isDestroyed() && window.isVisible() && window.isFocused() && !window.isMinimized()) {
      return;
    }
    showSummary(fresh);
  } catch (err) {
    console.warn('[community-notifications] poll failed:', err);
  } finally {
    polling = false;
  }
}

function armTimer(minutes: number): void {
  if (timer) clearInterval(timer);
  const ms = Math.min(60, Math.max(5, minutes)) * 60_000;
  timer = setInterval(() => void pollOnce(), ms);
}

export function startCommunityNotifications(
  getWindowCallback: () => BrowserWindow | null,
): void {
  getWindow = getWindowCallback;
  seen = loadSeenState();
  const settings = loadAppSettings();
  armTimer(settings.communityNotifyIntervalMinutes);
  setTimeout(() => void pollOnce(), FIRST_POLL_DELAY_MS).unref?.();
}

export function updateCommunityNotificationsConfig(
  settings: AppSettings,
): void {
  armTimer(settings.communityNotifyIntervalMinutes);
}
