import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Camera,
  Gamepad2,
  FolderOpen,
  Clock,
  Sparkles,
  Check,
  X,
  AlertTriangle,
  Info,
  RefreshCw,
  Sliders,
  Search,
  Key,
  Keyboard,
  Power,
  Layers,
  Activity,
  CheckCircle2,
  Loader2,
  Cloud,
  HardDrive,
  ShieldCheck,
  Zap,
  UploadCloud,
  DownloadCloud,
  ExternalLink,
  Image as ImageIcon,
} from 'lucide-react';
import type {
  AppSettings,
  F6ProcessStatus,
  FpsStatus,
  HardwareInfo,
  GoogleDriveDesktopStatus,
  DriveStorageQuota,
} from '../../shared/types.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onOpenSyncCenter?: () => void;
}

const POPULAR_KEYS = [
  { key: 'F6', vk: 0x75, label: 'F6 (Mặc định)' },
  { key: 'F12', vk: 0x7b, label: 'F12 (Chuẩn Steam)' },
  { key: 'F10', vk: 0x79, label: 'F10' },
  { key: 'F9', vk: 0x78, label: 'F9' },
  { key: 'F8', vk: 0x77, label: 'F8' },
  { key: 'F7', vk: 0x76, label: 'F7' },
  { key: 'PrintScreen', vk: 0x2c, label: 'PrintScreen (PrtScn)' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  onOpenSyncCenter,
}) => {
  const [activeTab, setActiveTab] = useState<'hotkey' | 'paths' | 'tracker' | 'covers' | 'performance' | 'storage'>('hotkey');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [f6Process, setF6Process] = useState<F6ProcessStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // FPS monitor & hardware info (tab Hiệu năng)
  const [fpsStatus, setFpsStatus] = useState<FpsStatus | null>(null);
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(null);
  const [settingUpFps, setSettingUpFps] = useState<boolean>(false);

  // Google Drive Storage & Quota State
  const [testingStorage, setTestingStorage] = useState<boolean>(false);
  const [storageTestResult, setStorageTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [driveLoggedIn, setDriveLoggedIn] = useState<boolean | null>(null);
  const [driveAccountEmail, setDriveAccountEmail] = useState<string | null>(null);
  const [driveQuota, setDriveQuota] = useState<DriveStorageQuota | null>(null);
  const [loadingDriveQuota, setLoadingDriveQuota] = useState<boolean>(false);

  // Google Drive for Desktop State
  const [gdriveStatus, setGdriveStatus] = useState<GoogleDriveDesktopStatus | null>(null);
  const [checkingGdrive, setCheckingGdrive] = useState<boolean>(false);
  const [applyingGdrive, setApplyingGdrive] = useState<boolean>(false);

  // Quick Action States inside Settings
  const [syncingLibrary, setSyncingLibrary] = useState<boolean>(false);
  const [syncingDrive, setSyncingDrive] = useState<boolean>(false);
  const [restoringDrive, setRestoringDrive] = useState<boolean>(false);
  const [actionResultMsg, setActionResultMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sendingLog, setSendingLog] = useState<boolean>(false);
  const [logSendMsg, setLogSendMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Hotkey recording mode
  const [isListeningKey, setIsListeningKey] = useState<boolean>(false);

  // Form states
  const [screenshotEnabled, setScreenshotEnabled] = useState<boolean>(true);
  const [screenshotHotkey, setScreenshotHotkey] = useState<string>('F6');
  const [screenshotHotkeyVk, setScreenshotHotkeyVk] = useState<number>(0x75);
  const [screenshotsDir, setScreenshotsDir] = useState<string>('');
  const [mediaBaseDir, setMediaBaseDir] = useState<string>('');
  const [vaultRoot, setVaultRoot] = useState<string>('');
  const [hddMode, setHddMode] = useState<boolean>(true);
  const [autoDetectGames, setAutoDetectGames] = useState<boolean>(true);
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState<number>(5);
  const [amdWatcherEnabled, setAmdWatcherEnabled] = useState<boolean>(true);
  const [closeToTray, setCloseToTray] = useState<boolean>(true);
  const [appStartupEnabled, setAppStartupEnabled] = useState<boolean>(false);
  const [playtimeWatchEnabled, setPlaytimeWatchEnabled] = useState<boolean>(true);
  const [autoEnrichCovers, setAutoEnrichCovers] = useState<boolean>(true);
  const [googleApiKey, setGoogleApiKey] = useState<string>('');
  const [googleCseId, setGoogleCseId] = useState<string>('');

  // Process toggling loading
  const [togglingProcess, setTogglingProcess] = useState<boolean>(false);
  const [enrichingCovers, setEnrichingCovers] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<import('../../shared/types').AppUpdateStatus | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI?.getUpdateStatus?.().then((st) => setUpdateStatus(st)).catch(() => {});
    const unsub = window.electronAPI?.onUpdateStatus?.((st) => setUpdateStatus(st));
    return () => {
      unsub?.();
    };
  }, [isOpen]);

  // Load settings on open
  const loadData = useCallback(async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      if (window.electronAPI?.getSettings) {
        const data = await window.electronAPI.getSettings();
        setSettings(data);
        setScreenshotEnabled(data.screenshotEnabled);
        setScreenshotHotkey(data.screenshotHotkey);
        setScreenshotHotkeyVk(data.screenshotHotkeyVk);
        setScreenshotsDir(data.screenshotsDir);
        setMediaBaseDir(data.mediaBaseDir);
        setVaultRoot(data.vaultRoot);
        setHddMode(data.hddMode !== undefined ? data.hddMode : true);
        setAutoDetectGames(data.autoDetectGames);
        setPollIntervalSeconds(data.pollIntervalSeconds);
        setAmdWatcherEnabled(data.amdWatcherEnabled);
        setCloseToTray(data.closeToTray);
        setAppStartupEnabled(data.appStartupEnabled);
        setPlaytimeWatchEnabled(data.playtimeWatchEnabled);
        setAutoEnrichCovers(data.autoEnrichCovers);
        setGoogleApiKey(data.googleApiKey || '');
        setGoogleCseId(data.googleCseId || '');
      }

      if (window.electronAPI?.getF6ProcessStatus) {
        const proc = await window.electronAPI.getF6ProcessStatus();
        setF6Process(proc);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }

    // Tab Hiệu năng: trạng thái FPS + snapshot phần cứng (không chặn loading chính)
    if (window.electronAPI?.getFpsStatus) {
      window.electronAPI.getFpsStatus().then(setFpsStatus).catch(() => {});
    }
    if (window.electronAPI?.getHardwareInfo) {
      window.electronAPI.getHardwareInfo().then(setHardwareInfo).catch(() => {});
    }
  }, []);

  // One-time setup: tải PresentMon nếu thiếu (máy NVIDIA) + tạo Scheduled Task (1 UAC)
  const handleSetupFps = async () => {
    if (!window.electronAPI?.setupFpsElevation) return;
    setSettingUpFps(true);
    try {
      // Máy chưa có PresentMon (NVIDIA...) → tải bản chính thức trước
      if (!fpsStatus?.presentMonFound && window.electronAPI?.downloadPresentMon) {
        setStatusMsg({ type: 'success', text: 'Đang tải PresentMon chính thức từ GitHub...' });
        const pmPath = await window.electronAPI.downloadPresentMon();
        if (!pmPath) {
          setStatusMsg({
            type: 'error',
            text: 'Không thể tải PresentMon (kiểm tra kết nối mạng). Bạn vẫn có thể chép PresentMon.exe thủ công.',
          });
          return;
        }
      }

      const result = await window.electronAPI.setupFpsElevation();
      if (result.ok) {
        setStatusMsg({
          type: 'success',
          text: 'Đã bật đo FPS! Từ giờ mỗi phiên chơi game sẽ được PresentMon tự động đo FPS (không cần xác nhận thêm).',
        });
      } else {
        setStatusMsg({
          type: 'error',
          text: result.error || 'Không thể tạo Scheduled Task đo FPS.',
        });
      }
      if (window.electronAPI?.getFpsStatus) {
        setFpsStatus(await window.electronAPI.getFpsStatus());
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Lỗi khi thiết lập đo FPS' });
    } finally {
      setSettingUpFps(false);
    }
  };

  const handleRefreshHardware = async () => {
    if (!window.electronAPI?.getHardwareInfo) return;
    try {
      setHardwareInfo(await window.electronAPI.getHardwareInfo(true));
    } catch {}
  };

  // Google Drive Quota Detection
  const loadDriveQuota = useCallback(async () => {
    setLoadingDriveQuota(true);
    try {
      if (window.electronAPI?.getAuthStatus) {
        const auth = await window.electronAPI.getAuthStatus();
        setDriveLoggedIn(Boolean(auth?.loggedIn));
        setDriveAccountEmail(auth?.profile?.email || null);
        if (auth?.loggedIn && window.electronAPI?.getDriveStorageQuota) {
          const q = await window.electronAPI.getDriveStorageQuota();
          setDriveQuota(q);
        } else {
          setDriveQuota(null);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch Google Drive quota in settings:', e);
      setDriveQuota(null);
    } finally {
      setLoadingDriveQuota(false);
    }
  }, []);

  // Google Drive for Desktop Detection & Apply
  const loadGdriveStatus = useCallback(async () => {
    if (window.electronAPI?.detectGoogleDriveDesktop) {
      setCheckingGdrive(true);
      try {
        const res = await window.electronAPI.detectGoogleDriveDesktop();
        setGdriveStatus(res);
      } catch (e) {
        console.error('Failed to detect Google Drive desktop:', e);
      } finally {
        setCheckingGdrive(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
      loadGdriveStatus();
      loadDriveQuota();
    } else {
      setIsListeningKey(false);
      setStatusMsg(null);
    }
  }, [isOpen, loadData, loadGdriveStatus, loadDriveQuota]);

  // Global keydown listener when recording hotkey
  useEffect(() => {
    if (!isListeningKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore bare modifiers
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      let keyName = e.key;
      // Normalize function keys
      if (/^F\d{1,2}$/i.test(keyName)) {
        keyName = keyName.toUpperCase();
      } else if (e.code === 'PrintScreen' || keyName === 'PrintScreen') {
        keyName = 'PrintScreen';
      } else if (e.code === 'ScrollLock') {
        keyName = 'ScrollLock';
      } else if (e.code === 'Pause') {
        keyName = 'Pause';
      }

      const vk = e.keyCode || 0x75;
      setScreenshotHotkey(keyName);
      setScreenshotHotkeyVk(vk);
      setIsListeningKey(false);

      setStatusMsg({
        type: 'success',
        text: `Đã chọn phím chụp màn hình: [ ${keyName} ]! Nhớ bấm "Lưu cài đặt" bên dưới.`,
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isListeningKey]);

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      if (window.electronAPI?.saveSettings) {
        const updated = await window.electronAPI.saveSettings({
          screenshotEnabled,
          screenshotHotkey,
          screenshotHotkeyVk,
          screenshotsDir,
          mediaBaseDir,
          vaultRoot,
          hddMode,
          autoDetectGames,
          pollIntervalSeconds,
          amdWatcherEnabled,
          closeToTray,
          appStartupEnabled,
          playtimeWatchEnabled,
          autoEnrichCovers,
          googleApiKey: googleApiKey.trim(),
          googleCseId: googleCseId.trim(),
          imageStorageProvider: 'google_drive',
        });
        setSettings(updated);
        setStatusMsg({ type: 'success', text: '✅ Đã lưu cài đặt thành công!' });
        if (onSaved) onSaved();
      }
    } catch (err: any) {
      console.error('Failed to save settings:', err);
      setStatusMsg({ type: 'error', text: `Lỗi lưu cài đặt: ${err.message || 'Không xác định'}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTestStorage = async () => {
    if (!window.electronAPI?.testStorageConnection) return;
    setTestingStorage(true);
    setStorageTestResult(null);
    try {
      const res = await window.electronAPI.testStorageConnection({
        imageStorageProvider: 'google_drive',
      });
      if (res.ok) {
        setStorageTestResult({ ok: true, text: 'Kết nối Google Drive thành công!' });
        loadDriveQuota();
      } else {
        setStorageTestResult({ ok: false, text: `Lỗi kết nối: ${res.error || 'Thất bại'}` });
      }
    } catch (err: any) {
      setStorageTestResult({ ok: false, text: `Lỗi: ${err.message || 'Không thể kiểm tra'}` });
    } finally {
      setTestingStorage(false);
    }
  };

  const handleQuickSyncLibrary = async () => {
    setSyncingLibrary(true);
    setActionResultMsg(null);
    try {
      if (window.electronAPI?.syncLibrary) {
        const res = await window.electronAPI.syncLibrary();
        setActionResultMsg({
          ok: true,
          text: `Đồng bộ thư viện thành công! Đã đẩy ${res.pushed} game, kéo ${res.pulled} game mới (${res.completedCount} game đã phá đảo).`,
        });
        if (onSaved) onSaved();
      }
    } catch (err: any) {
      setActionResultMsg({ ok: false, text: err.message || 'Lỗi khi đồng bộ thư viện.' });
    } finally {
      setSyncingLibrary(false);
    }
  };

  const handleQuickUploadDrive = async () => {
    setSyncingDrive(true);
    setActionResultMsg(null);
    try {
      if (window.electronAPI?.uploadMediaToDrive) {
        const res = await window.electronAPI.uploadMediaToDrive();
        const mb = (res.bytesUploaded / (1024 * 1024)).toFixed(1);
        setActionResultMsg({
          ok: true,
          text: `Đã sao lưu ${res.filesUploaded} ảnh (${mb} MB) từ ${res.gamesProcessed} game lên Google Drive!`,
        });
      }
    } catch (err: any) {
      setActionResultMsg({ ok: false, text: err.message || 'Lỗi khi tải ảnh lên Google Drive.' });
    } finally {
      setSyncingDrive(false);
    }
  };

  const handleQuickRestoreDrive = async () => {
    setRestoringDrive(true);
    setActionResultMsg(null);
    try {
      if (window.electronAPI?.downloadMediaFromDrive) {
        const res = await window.electronAPI.downloadMediaFromDrive();
        setActionResultMsg({
          ok: true,
          text: `Đã kéo thành công ${res.filesDownloaded} ảnh từ Drive về thư mục "${res.localBaseDir}"!`,
        });
      }
    } catch (err: any) {
      setActionResultMsg({ ok: false, text: err.message || 'Lỗi khi kéo ảnh từ Google Drive.' });
    } finally {
      setRestoringDrive(false);
    }
  };

  const handleApplyGdrive = async (customPath?: string) => {
    if (!window.electronAPI?.applyGoogleDriveDesktop) return;
    setApplyingGdrive(true);
    try {
      const res = await window.electronAPI.applyGoogleDriveDesktop(customPath);
      if (res.ok) {
        setMediaBaseDir(res.settings.mediaBaseDir);
        setHddMode(false);
        setStatusMsg({
          type: 'success',
          text: `Đã kích hoạt lưu trữ Google Drive: "${res.settings.mediaBaseDir}". Ảnh chụp sẽ lưu thẳng vào đây và tự động đồng bộ lên cloud!`,
        });
        await loadGdriveStatus();
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Không thể áp dụng ổ Google Drive' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Lỗi áp dụng ổ Google Drive' });
    } finally {
      setApplyingGdrive(false);
    }
  };

  const handleOpenGdriveDownload = () => {
    if (window.electronAPI?.openExternalUrl) {
      window.electronAPI.openExternalUrl('https://www.google.com/drive/download/');
    } else {
      window.open('https://www.google.com/drive/download/', '_blank');
    }
  };

  // Browse folders
  const handleBrowseFolder = async (field: 'screenshots' | 'media' | 'vault') => {
    if (!window.electronAPI?.browseFolder) return;
    let initialPath = '';
    if (field === 'screenshots') initialPath = screenshotsDir;
    else if (field === 'media') initialPath = mediaBaseDir;
    else if (field === 'vault') initialPath = vaultRoot;

    const chosen = await window.electronAPI.browseFolder(initialPath);
    if (chosen) {
      if (field === 'screenshots') setScreenshotsDir(chosen);
      else if (field === 'media') setMediaBaseDir(chosen);
      else if (field === 'vault') setVaultRoot(chosen);
    }
  };

  // Toggle external process
  const handleToggleF6Process = async (start: boolean) => {
    if (!window.electronAPI?.toggleF6Process) return;
    setTogglingProcess(true);
    try {
      await window.electronAPI.toggleF6Process(start);
      // Wait a moment and refresh status
      setTimeout(async () => {
        if (window.electronAPI?.getF6ProcessStatus) {
          const proc = await window.electronAPI.getF6ProcessStatus();
          setF6Process(proc);
        }
        setTogglingProcess(false);
      }, 1000);
    } catch (err) {
      console.error(err);
      setTogglingProcess(false);
    }
  };

  // Toggle Windows startup
  const handleToggleStartup = async () => {
    if (!window.electronAPI?.toggleF6Startup || !f6Process) return;
    const target = !f6Process.startupEnabled;
    try {
      await window.electronAPI.toggleF6Startup(target);
      setF6Process((prev) => (prev ? { ...prev, startupEnabled: target } : null));
    } catch (err) {
      console.error(err);
    }
  };

  // Manual Cover enrichment
  const handleManualEnrich = async () => {
    if (!window.electronAPI?.enrichCovers) return;
    setEnrichingCovers(true);
    try {
      const count = await window.electronAPI.enrichCovers();
      setStatusMsg({
        type: 'success',
        text: `Đã làm mới ảnh bìa thành công! Đã cập nhật ${count} trò chơi.`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: `Lỗi khi làm mới bìa: ${err.message || 'Không thể quét'}`,
      });
    } finally {
      setEnrichingCovers(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="relative flex h-[620px] w-full max-w-4xl flex-col rounded-2xl border border-[#2a2e3d] bg-[#12141c] shadow-2xl overflow-hidden text-[#f1f3f7]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] bg-[#161822] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#990018] shadow-md shadow-[#ff2a44]/25">
              <Settings className="h-5 w-5 text-white animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">CÀI ĐẶT &amp; TÙY CHỈNH HỆ THỐNG</h2>
                <span className="rounded bg-[#ff2a44]/20 px-2 py-0.5 text-[10px] font-bold text-[#ff2a44] border border-[#ff2a44]/30">
                  GameVault Pro
                </span>
              </div>
              <p className="text-xs text-[#8e95a5]">
                Tùy biến phím tắt chụp màn hình, thư mục lưu trữ, bộ theo dõi và ảnh bìa
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8e95a5] hover:bg-[#202433] hover:text-white transition-colors"
            title="Đóng cửa sổ cài đặt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body: Left Sidebar Tabs + Right Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs Sidebar */}
          <div className="w-56 border-r border-[#2a2e3d] bg-[#0e1015]/70 p-3 space-y-1.5 shrink-0">
            <button
              onClick={() => setActiveTab('hotkey')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${
                activeTab === 'hotkey'
                  ? 'bg-[#ff2a44] text-white shadow-md shadow-[#ff2a44]/20'
                  : 'text-[#8e95a5] hover:bg-[#1a1d28] hover:text-white'
              }`}
            >
              <Camera className="h-4 w-4" />
              <span>Chụp màn hình</span>
            </button>

            <button
              onClick={() => setActiveTab('paths')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${
                activeTab === 'paths'
                  ? 'bg-[#ff2a44] text-white shadow-md shadow-[#ff2a44]/20'
                  : 'text-[#8e95a5] hover:bg-[#1a1d28] hover:text-white'
              }`}
            >
              <FolderOpen className="h-4 w-4" />
              <span>Thư viện &amp; Lưu trữ</span>
            </button>

            <button
              onClick={() => setActiveTab('tracker')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${
                activeTab === 'tracker'
                  ? 'bg-[#ff2a44] text-white shadow-md shadow-[#ff2a44]/20'
                  : 'text-[#8e95a5] hover:bg-[#1a1d28] hover:text-white'
              }`}
            >
              <Clock className="h-4 w-4" />
              <span>Theo dõi &amp; Hệ thống</span>
            </button>

            <button
              onClick={() => setActiveTab('covers')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${
                activeTab === 'covers'
                  ? 'bg-[#ff2a44] text-white shadow-md shadow-[#ff2a44]/20'
                  : 'text-[#8e95a5] hover:bg-[#1a1d28] hover:text-white'
              }`}
            >
              <Sparkles className="h-4 w-4" />
              <span>Ảnh bìa &amp; Tìm kiếm</span>
            </button>

            <button
              onClick={() => setActiveTab('performance')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${
                activeTab === 'performance'
                  ? 'bg-[#ff2a44] text-white shadow-md shadow-[#ff2a44]/20'
                  : 'text-[#8e95a5] hover:bg-[#1a1d28] hover:text-white'
              }`}
            >
              <Activity className="h-4 w-4" />
              <span>Hiệu năng &amp; FPS</span>
            </button>

            <button
              onClick={() => setActiveTab('storage')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all ${
                activeTab === 'storage'
                  ? 'bg-[#ff2a44] text-white shadow-md shadow-[#ff2a44]/20'
                  : 'text-[#8e95a5] hover:bg-[#1a1d28] hover:text-white'
              }`}
            >
              <Cloud className="h-4 w-4" />
              <span>Lưu trữ ảnh &amp; Cloud</span>
            </button>
          </div>

          {/* Right Scrollable Tab Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#ff2a44]" />
              </div>
            ) : (
              <>
                {/* Status Message Notification */}
                {statusMsg && (
                  <div
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-xs animate-in fade-in duration-200 ${
                      statusMsg.type === 'success'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    }`}
                  >
                    {statusMsg.type === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                    )}
                    <span className="font-medium leading-relaxed">{statusMsg.text}</span>
                  </div>
                )}

                {/* TAB 1: HOTKEY & SCREENSHOT */}
                {activeTab === 'hotkey' && (
                  <div className="space-y-6">
                    {/* Toggle Switch: Enable / Disable Hotkey Capture */}
                    <div className="flex items-center justify-between rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">Chức năng chụp màn hình bằng phím nóng</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              screenshotEnabled
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-zinc-700/40 text-zinc-400 border border-zinc-600/30'
                            }`}
                          >
                            {screenshotEnabled ? 'ĐANG BẬT' : 'ĐÃ TẮT'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[#8e95a5]">
                          Tự động nhận diện game đang chơi khi bấm phím nóng và di chuyển ảnh vào thư mục game tương ứng.
                        </p>
                      </div>

                      <button
                        onClick={() => setScreenshotEnabled(!screenshotEnabled)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                          screenshotEnabled ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                        }`}
                        title={screenshotEnabled ? 'Click để TẮT' : 'Click để BẬT'}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                            screenshotEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Hotkey Selector & Key Recorder */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Keyboard className="h-4 w-4 text-[#ff2a44]" />
                            <span>Phím chụp màn hình hiện tại:</span>
                          </label>
                          <p className="text-[11px] text-[#8e95a5]">
                            Mặc định là <code className="text-amber-400 font-mono">F6</code>. Bạn có thể tự đổi sang phím bất kỳ (F1-F12, PrtScn...)
                          </p>
                        </div>

                        {/* Current Hotkey Visual Pill */}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center min-w-[70px] h-10 px-3 rounded-lg border-2 border-[#ff2a44] bg-[#0e1015] shadow-inner font-mono text-base font-black text-white tracking-wider">
                            {screenshotHotkey}
                          </div>

                          <button
                            onClick={() => setIsListeningKey(true)}
                            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                              isListeningKey
                                ? 'bg-amber-500 text-black animate-pulse shadow-lg shadow-amber-500/30'
                                : 'border border-[#2a2e3d] bg-[#202433] text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/15 hover:text-[#ff2a44]'
                            }`}
                          >
                            <Sliders className="h-3.5 w-3.5" />
                            <span>{isListeningKey ? 'Bấm 1 phím trên phím...' : 'Đổi phím nóng'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Quick Presets */}
                      <div className="pt-2 border-t border-[#2a2e3d]/60">
                        <span className="text-[11px] font-semibold text-[#8e95a5] block mb-2">
                          Hoặc chọn nhanh phím thông dụng:
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {POPULAR_KEYS.map((item) => {
                            const isSelected = screenshotHotkey === item.key;
                            return (
                              <button
                                key={item.key}
                                onClick={() => {
                                  setScreenshotHotkey(item.key);
                                  setScreenshotHotkeyVk(item.vk);
                                  setIsListeningKey(false);
                                }}
                                className={`rounded-md px-2.5 py-1 text-xs font-mono font-bold transition-all ${
                                  isSelected
                                    ? 'bg-[#ff2a44] text-white shadow-sm shadow-[#ff2a44]/30'
                                    : 'border border-[#2a2e3d] bg-[#0e1015] text-[#8e95a5] hover:border-[#ff2a44] hover:text-white'
                                }`}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Nơi lưu ảnh chụp (F6 Storage Destination & Direct Google Drive) */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                              gdriveStatus?.isCurrentlyUsed
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                            }`}
                          >
                            <HardDrive className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-white">Nơi lưu ảnh chụp ({screenshotHotkey})</span>
                              {gdriveStatus?.isCurrentlyUsed ? (
                                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Lưu thẳng vào Google Drive
                                </span>
                              ) : (
                                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-zinc-700/50 text-zinc-400 border border-zinc-600">
                                  Lưu ổ máy cục bộ
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#8e95a5] mt-1 leading-relaxed">
                              {gdriveStatus?.isCurrentlyUsed ? (
                                <>
                                  Mỗi khi bấm <code className="text-emerald-400 font-mono font-bold">{screenshotHotkey}</code>, ảnh sẽ bay thẳng vào thư mục game trên ổ <strong>Google Drive ({gdriveStatus.mountedDrive || 'G:'})</strong> và tự động đồng bộ lên cloud ngay lập tức mà không chiếm dung lượng ổ cứng máy tính!
                                </>
                              ) : (
                                <>
                                  Ảnh đang lưu tại: <code className="text-zinc-300 font-mono">{mediaBaseDir || 'E:\\Game'}</code>. Bạn có thể kích hoạt để ảnh bay thẳng vào ổ Google Drive (ổ G:).
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={loadGdriveStatus}
                          disabled={checkingGdrive}
                          title="Quét lại ổ đĩa Google Drive"
                          className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-2.5 py-1.5 text-xs text-[#8e95a5] hover:text-white hover:border-[#3d445a] transition-colors shrink-0"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${checkingGdrive ? 'animate-spin text-[#ff2a44]' : ''}`} />
                          <span className="text-[11px]">Quét Drive</span>
                        </button>
                      </div>

                      {/* Drive Action Card */}
                      <div className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] p-3">
                        {gdriveStatus?.mountedDrive || gdriveStatus?.myDrivePath ? (
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                              <span className="text-[#8e95a5]">Ổ Google Drive phát hiện:</span>
                              <span className="font-mono font-semibold text-emerald-400">
                                {gdriveStatus.myDrivePath || `${gdriveStatus.mountedDrive}\\`}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                              <span className="text-[#8e95a5]">Thư mục ảnh trên Drive:</span>
                              <span className="font-mono text-zinc-300">
                                {gdriveStatus.suggestedMediaDir || `${gdriveStatus.mountedDrive}\\GameVault`}
                              </span>
                            </div>

                            {gdriveStatus.isCurrentlyUsed ? (
                              <div className="mt-2 pt-2 border-t border-[#1e2230] flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
                                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                                  <span>Ảnh chụp F6 đang lưu thẳng vào Google Drive</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleApplyGdrive('E:\\Game')}
                                  disabled={applyingGdrive}
                                  className="text-[11px] text-[#8e95a5] hover:text-white border border-[#2a2e3d] bg-[#1a1d28] hover:bg-[#202433] px-2.5 py-1 rounded transition-colors"
                                >
                                  Chuyển về lưu ổ E:\Game
                                </button>
                              </div>
                            ) : (
                              <div className="mt-2 pt-2 border-t border-[#1e2230] flex flex-wrap items-center justify-between gap-3">
                                <p className="text-[11px] text-[#8e95a5]">
                                  Bấm để lưu ảnh chụp thẳng vào Google Drive ({gdriveStatus.mountedDrive || 'G:'}):
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleApplyGdrive()}
                                  disabled={applyingGdrive}
                                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition-all shrink-0"
                                >
                                  {applyingGdrive ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Zap className="h-3.5 w-3.5" />
                                  )}
                                  <span>⚡ Bật lưu thẳng vào Google Drive</span>
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                            <div className="space-y-0.5">
                              <div className="font-semibold text-zinc-300">Chưa tìm thấy ổ Google Drive trong máy</div>
                              <p className="text-[11px] text-[#8e95a5]">
                                Cài đặt <strong>Google Drive for Desktop</strong> để biến Drive thành ổ G: trong PC và lưu ảnh trực tiếp.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleOpenGdriveDownload}
                              className="flex items-center gap-1 rounded-lg border border-[#2a2e3d] bg-[#1a1d28] px-2.5 py-1.5 text-xs text-[#8e95a5] hover:text-white hover:border-[#ff2a44] transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>Tải Google Drive PC</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Controller / Gamepad Macro Guide Box */}
                    <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-orange-500/5 p-4 space-y-2.5">
                      <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wide">
                        <Gamepad2 className="h-4 w-4" />
                        <span>Mẹo game thủ: Gán nút chụp màn hình trên Tay Cầm (Controller Macro)</span>
                      </div>

                      <div className="text-xs text-[#d1d5db] leading-relaxed space-y-2">
                        <p>
                          🎮 Nếu bạn chơi game bằng tay cầm (Flydigi, 8BitDo, DualSense, Xbox Elite, Gulikit, v.v.), bạn có thể gán 1 nút macro/nút lưng (như <span className="text-white font-semibold">M1, M2, Back paddle</span>) thành phím chụp màn hình (<span className="text-amber-300 font-mono font-bold">{screenshotHotkey}</span>) thông qua phần mềm điều khiển tay cầm.
                        </p>

                        <div className="rounded-lg bg-black/40 border border-amber-500/30 p-2.5 text-[11px] space-y-1 text-amber-200">
                          <div className="font-bold text-amber-300 flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            <span>LƯU Ý QUAN TRỌNG KHI CÀI ĐẶT MACRO TAY CẦM:</span>
                          </div>
                          <p>
                            Khi mở app tay cầm để gán nút macro, phần mềm sẽ yêu cầu bạn bấm phím trên bàn phím để nhận diện. Nếu tính năng chụp ảnh trong GameVault đang <strong className="text-white">BẬT</strong>, khi bạn bấm phím đó thì máy sẽ chụp màn hình ngay tức thì (vừa sinh ra ảnh rác, vừa có thể gây xung đột làm phần mềm tay cầm không nhận đúng)!
                          </p>
                          <div className="pt-1 font-semibold text-emerald-400">
                            👉 <strong>Quy trình chuẩn:</strong> Gạt <span className="underline">TẮT</span> công tắc chụp màn hình ở trên ➔ Mở app tay cầm gán macro thành phím <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-white">{screenshotHotkey}</code> ➔ Gán xong quay lại đây gạt <span className="underline">BẬT</span> lại!
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* External Desktop F6 Tool Status */}
                    {f6Process && f6Process.installed && (
                      <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">Công cụ F6 ngoài Desktop (F6 Screenshot)</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  f6Process.isRunning
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-zinc-700/40 text-zinc-400 border border-zinc-600/30'
                                }`}
                              >
                                {f6Process.isRunning ? `Đang chạy (PID: ${f6Process.pid})` : 'Đang tắt'}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-[#8e95a5]">
                              Đồng bộ với các file script tại <code>C:\Users\MacPro\Desktop\F6 Screenshot</code>
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleToggleF6Process(!f6Process.isRunning)}
                              disabled={togglingProcess}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                                f6Process.isRunning
                                  ? 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500 hover:text-white'
                                  : 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500 hover:text-white'
                              } disabled:opacity-50`}
                            >
                              <Power className="h-3.5 w-3.5" />
                              <span>{f6Process.isRunning ? 'Dừng script nền' : 'Bật script nền'}</span>
                            </button>

                            <button
                              onClick={handleToggleStartup}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                                f6Process.startupEnabled
                                  ? 'border-purple-500/40 bg-purple-500/20 text-purple-300'
                                  : 'border-[#2a2e3d] bg-[#0e1015] text-[#8e95a5] hover:text-white'
                              }`}
                              title="Tự khởi động cùng Windows khi bật máy"
                            >
                              {f6Process.startupEnabled ? '✓ Tự khởi động cùng Windows' : 'Khởi động cùng Windows: Tắt'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: STORAGE & PATHS */}
                {activeTab === 'paths' && (
                  <div className="space-y-4">
                    {/* HDD Mode Toggle Card & Notice */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                              hddMode
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {hddMode ? <HardDrive className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">Chế độ HDD (HDD Mode - Lưu tạm &amp; Đồng bộ sau)</span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  hddMode
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                }`}
                              >
                                {hddMode ? 'Đang BẬT (Dành cho HDD)' : 'Đang TẮT (Tối ưu cho SSD)'}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#8e95a5]">
                              {hddMode
                                ? 'Ảnh chụp lưu tạm vào ổ nhanh (SSD) rồi mới chuyển sang ổ HDD để HDD không bị quay liên tục khi chơi game.'
                                : 'Ảnh chụp lưu thẳng vào thư mục game trong ổ đích, không qua bước lưu tạm để bảo vệ tuổi thọ SSD.'}
                            </p>
                          </div>
                        </div>
                        {/* Toggle Button */}
                        <button
                          type="button"
                          onClick={() => setHddMode(!hddMode)}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            hddMode ? 'bg-[#ff2a44]' : 'bg-zinc-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              hddMode ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Notice Callout */}
                      <div
                        className={`rounded-lg border p-3 text-xs leading-relaxed ${
                          hddMode
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200/90'
                            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200/90'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <Info className="h-4 w-4 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">Khuyến nghị lưu trữ: </span>
                            {hddMode ? (
                              <>
                                Nếu thư mục lưu trữ bạn chọn là <strong>ổ cứng cơ (HDD)</strong>, hãy <strong>BẬT</strong> chế độ này để ổ HDD được ngủ yên (spin down) khi chơi game.
                                Nếu ổ đích là <strong>SSD</strong>, bạn <strong>nên TẮT</strong> để ảnh lưu thẳng vào thư mục game, tránh việc ghi tạm rồi copy làm hao mòn tuổi thọ (TBW) của SSD vô ích.
                              </>
                            ) : (
                              <>
                                Bạn đang tắt HDD Mode (chế độ trực tiếp). Rất phù hợp nếu thư mục đích nằm trên <strong>ổ SSD</strong>.
                                Ảnh chụp sẽ được lưu thẳng vào thư mục game, chỉ cần chọn đúng 1 ổ đích bên dưới!
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Google Drive for Desktop Direct Mount Card */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <HardDrive className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-white">Ổ đĩa Google Drive (Google Drive for Desktop)</span>
                              {gdriveStatus?.isCurrentlyUsed ? (
                                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Đang kích hoạt
                                </span>
                              ) : gdriveStatus?.mountedDrive ? (
                                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40">
                                  Đã phát hiện ổ {gdriveStatus.mountedDrive}
                                </span>
                              ) : (
                                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-zinc-700/50 text-zinc-400 border border-zinc-600">
                                  Chưa phát hiện
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#8e95a5] mt-1 leading-relaxed">
                              Biến Google Drive thành 1 ổ đĩa trong PC (thường là ổ G:). Ảnh chụp màn hình sẽ lưu thẳng vào ổ này và Google Drive tự động đồng bộ ngầm lên mây ngay lập tức mà không phải đọc ghi qua lại trung gian, không cần token API.
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={loadGdriveStatus}
                          disabled={checkingGdrive}
                          title="Quét lại ổ đĩa Google Drive"
                          className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-2.5 py-1.5 text-xs text-[#8e95a5] hover:text-white hover:border-[#3d445a] transition-colors shrink-0"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${checkingGdrive ? 'animate-spin text-[#ff2a44]' : ''}`} />
                          <span className="text-[11px]">Quét lại</span>
                        </button>
                      </div>

                      {/* Status Details & Quick Action */}
                      {gdriveStatus?.mountedDrive || gdriveStatus?.myDrivePath ? (
                        <div className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                            <span className="text-[#8e95a5]">Ổ đĩa Google Drive:</span>
                            <span className="font-mono font-semibold text-emerald-400">
                              {gdriveStatus.myDrivePath || `${gdriveStatus.mountedDrive}\\`}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                            <span className="text-[#8e95a5]">Thư mục lưu đề xuất:</span>
                            <span className="font-mono text-zinc-300">
                              {gdriveStatus.suggestedMediaDir || `${gdriveStatus.mountedDrive}\\GameVault`}
                            </span>
                          </div>

                          {gdriveStatus.isCurrentlyUsed ? (
                            <div className="mt-2 flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-300">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                <span>Ảnh chụp game đang lưu thẳng vào Google Drive và tự động đồng bộ lên cloud.</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleBrowseFolder('media')}
                                className="text-[11px] underline hover:text-white shrink-0 ml-2"
                              >
                                Đổi thư mục con
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#1e2230]">
                              <p className="text-[11px] text-[#8e95a5]">
                                Bấm nút bên cạnh để trỏ Thư mục Media vào Google Drive và tự động bật chế độ lưu trực tiếp:
                              </p>
                              <button
                                type="button"
                                onClick={() => handleApplyGdrive()}
                                disabled={applyingGdrive}
                                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition-all shrink-0"
                              >
                                {applyingGdrive ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Zap className="h-3.5 w-3.5" />
                                )}
                                <span>⚡ Kích hoạt: Lưu thẳng vào Google Drive</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-[#2a2e3d] bg-[#0e1015]/60 p-3 space-y-3">
                          <div className="flex items-start gap-2.5 text-xs text-[#8e95a5]">
                            <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-400" />
                            <div className="space-y-1">
                              <p className="font-semibold text-zinc-200">
                                Chưa tìm thấy ổ Google Drive trong máy tính của bạn.
                              </p>
                              <p className="text-[11px] leading-relaxed">
                                Để có 1 ổ Google Drive (thường là ổ G:) xuất hiện trong This PC giống như bạn của bạn:
                              </p>
                              <ol className="list-decimal list-inside text-[11px] space-y-1 text-zinc-400 mt-1">
                                <li>Tải và cài đặt ứng dụng chính thức <strong>Google Drive for Desktop</strong> từ Google.</li>
                                <li>Đăng nhập tài khoản Google. Google Drive sẽ tự động tạo một ổ đĩa riêng (thường là G:) trong máy.</li>
                                <li>Sau khi cài xong, quay lại đây bấm <strong>Quét lại</strong> để kích hoạt.</li>
                              </ol>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#1e2230]">
                            <button
                              type="button"
                              onClick={handleOpenGdriveDownload}
                              className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/10 hover:text-[#ff2a44] transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>Tải Google Drive cho máy tính (Chính chủ Google)</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Media Directory */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-bold text-white flex items-center gap-1.5">
                            <FolderOpen className="h-4 w-4 text-[#ff2a44]" />
                            <span>Thư mục Media Game (Chứa Screenshot &amp; Video):</span>
                          </label>
                          <p className="text-[11px] text-[#8e95a5]">
                            Mặc định là <code className="text-white">E:\Game</code>. Nơi tự động phân loại ảnh/video theo từng folder game.
                          </p>
                        </div>
                        <button
                          onClick={() => handleBrowseFolder('media')}
                          className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/10 hover:text-[#ff2a44]"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          <span>Duyệt thư mục...</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={mediaBaseDir}
                        onChange={(e) => setMediaBaseDir(e.target.value)}
                        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#ff2a44]"
                      />
                    </div>

                    {/* Screenshots Directory (Source - Only visible when HDD Mode is ON) */}
                    {hddMode && (
                      <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <label className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Camera className="h-4 w-4 text-amber-400" />
                              <span>Thư mục Chụp màn hình nguồn (lưu tạm):</span>
                            </label>
                            <p className="text-[11px] text-[#8e95a5]">
                              Mặc định là <code className="text-white">Pictures\Screenshots</code>. Nơi sinh ra file chụp tạm trước khi chuyển vào HDD.
                            </p>
                          </div>
                          <button
                            onClick={() => handleBrowseFolder('screenshots')}
                            className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/10 hover:text-[#ff2a44]"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                            <span>Duyệt thư mục...</span>
                          </button>
                        </div>
                        <input
                          type="text"
                          value={screenshotsDir}
                          onChange={(e) => setScreenshotsDir(e.target.value)}
                          className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#ff2a44]"
                        />
                      </div>
                    )}

                    {/* Save Vault Root */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Layers className="h-4 w-4 text-emerald-400" />
                            <span>Thư mục Save Vault Root (Sao lưu Save Game):</span>
                          </label>
                          <p className="text-[11px] text-[#8e95a5]">
                            Mặc định là <code className="text-white">E:\GameVault-Saves</code>. Nơi lưu trữ vĩnh viễn các bản backup save game.
                          </p>
                        </div>
                        <button
                          onClick={() => handleBrowseFolder('vault')}
                          className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/10 hover:text-[#ff2a44]"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          <span>Duyệt thư mục...</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={vaultRoot}
                        onChange={(e) => setVaultRoot(e.target.value)}
                        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#ff2a44]"
                      />
                    </div>
                  </div>
                )}

                {/* TAB 3: TRACKER & SYSTEM */}
                {activeTab === 'tracker' && (
                  <div className="space-y-4">
                    {/* Close to tray */}
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Đóng cửa sổ = Ẩn xuống khay hệ thống</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Nhấn X chỉ ẩn app xuống khay (nút ^ gần đồng hồ), GameVault vẫn chạy ngầm đếm giờ chơi. Thoát hẳn qua chuột phải icon khay → "Thoát hoàn toàn".
                        </p>
                      </div>
                      <button
                        onClick={() => setCloseToTray(!closeToTray)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                          closeToTray ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            closeToTray ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Auto-start with Windows */}
                    <div className="flex items-center justify-between rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Khởi động cùng Windows (chạy ngầm trong khay)</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Bật máy là GameVault tự chạy ngầm trong khay (không hiện cửa sổ) để không bỏ sót phút chơi nào.
                        </p>
                      </div>
                      <button
                        onClick={() => setAppStartupEnabled(!appStartupEnabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                          appStartupEnabled ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            appStartupEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Playtime watchdog (independent background counter) */}
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Watchdog giờ chơi (chạy ngầm kể cả khi app tắt)</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Script độc lập đếm giờ từ lúc đăng nhập Windows — GameVault tắt vẫn ghi đủ phút chơi, mở app lên tự cộng vào tổng.
                        </p>
                      </div>
                      <button
                        onClick={() => setPlaytimeWatchEnabled(!playtimeWatchEnabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                          playtimeWatchEnabled ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            playtimeWatchEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* App Version & Auto-Update */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-white">Cập nhật ứng dụng (In-app)</span>
                          <span className="rounded bg-[#222638] px-1.5 py-0.5 font-mono text-[10px] text-[#9aa3b8]">
                            v{updateStatus?.currentVersion || '1.0.0'}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          {updateStatus?.message || 'Tự động kiểm tra và tải bản cập nhật mới từ GitHub Releases.'}
                        </p>
                        {updateStatus?.state === 'downloading' && typeof updateStatus.percent === 'number' && (
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#242838]">
                            <div
                              className="h-full bg-emerald-500 transition-all duration-300"
                              style={{ width: `${updateStatus.percent}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {updateStatus?.state === 'downloaded' ? (
                        <button
                          onClick={() => window.electronAPI?.installUpdate?.()}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition-colors"
                        >
                          Cài đặt & Khởi động lại
                        </button>
                      ) : (
                        <button
                          onClick={() => window.electronAPI?.checkForUpdates?.()}
                          disabled={updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'}
                          className="rounded-lg border border-[#2e3446] bg-[#1f2433] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2a3044] disabled:opacity-50 transition-colors"
                        >
                          {updateStatus?.state === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật'}
                        </button>
                      )}
                    </div>

                    {/* Auto-detect running games */}
                    <div className="flex items-center justify-between rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Tự động phát hiện game mới khi khởi chạy</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Khi bạn mở bất kỳ game mới nào chưa có trong thư viện, GameVault sẽ tự động nhận diện và tính giờ chơi.
                        </p>
                      </div>
                      <button
                        onClick={() => setAutoDetectGames(!autoDetectGames)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                          autoDetectGames ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            autoDetectGames ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* AMD Watcher toggle */}
                    <div className="flex items-center justify-between rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Tự động đồng bộ AMD Adrenalin (Live Watcher)</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Theo dõi file dữ liệu RGStats.db của card AMD để cập nhật danh sách game mới ngay lập tức.
                        </p>
                      </div>
                      <button
                        onClick={() => setAmdWatcherEnabled(!amdWatcherEnabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                          amdWatcherEnabled ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            amdWatcherEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Polling Interval */}
                    <div className="flex items-center justify-between rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Chu kỳ quét tiến trình (Zero-Impact Polling)</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Thời gian giữa mỗi lần kiểm tra tiến trình game. 5 giây là mức tối ưu với 0% CPU.
                        </p>
                      </div>

                      <select
                        value={pollIntervalSeconds}
                        onChange={(e) => setPollIntervalSeconds(parseInt(e.target.value, 10))}
                        className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs text-white outline-none focus:border-[#ff2a44]"
                      >
                        <option value={2}>2 giây (Phản hồi tức thì)</option>
                        <option value={3}>3 giây</option>
                        <option value={5}>5 giây (Khuyên dùng - Chuẩn)</option>
                        <option value={10}>10 giây (Tiết kiệm tối đa)</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* TAB 4: COVERS & GOOGLE SEARCH */}
                {activeTab === 'covers' && (
                  <div className="space-y-4">
                    {/* Steam Auto Enrichment */}
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Tự động làm giàu ảnh bìa từ Steam CDN</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Tự động tải poster và banner chất lượng cao từ Steam Fastly CDN cho toàn bộ game trong thư viện.
                        </p>
                      </div>

                      <button
                        onClick={() => setAutoEnrichCovers(!autoEnrichCovers)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                          autoEnrichCovers ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            autoEnrichCovers ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Rescan covers button */}
                    <div className="flex items-center justify-between rounded-xl border border-[#2a2e3d] bg-[#161822] p-4">
                      <div>
                        <span className="font-bold text-xs text-white">Quét và cập nhật lại toàn bộ ảnh bìa</span>
                        <p className="mt-1 text-[11px] text-[#8e95a5]">
                          Khắc phục các game bị thiếu ảnh bìa hoặc cập nhật poster mới nhất từ Steam.
                        </p>
                      </div>

                      <button
                        onClick={handleManualEnrich}
                        disabled={enrichingCovers}
                        className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3.5 py-2 text-xs font-bold text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/15 hover:text-[#ff2a44] disabled:opacity-50"
                      >
                        {enrichingCovers ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        <span>{enrichingCovers ? 'Đang quét...' : 'Quét làm giàu ngay'}</span>
                      </button>
                    </div>

                    {/* Google Custom Search Engine Config */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                      <div>
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Search className="h-4 w-4 text-sky-400" />
                          <span>Google Custom Search API (Tùy chọn tìm ảnh bìa Google)</span>
                        </span>
                        <p className="text-[11px] text-[#8e95a5] mt-1">
                          Cung cấp API Key và Search Engine ID nếu bạn muốn tìm kiếm ảnh poster/banner trực tiếp từ Google Images.
                        </p>
                      </div>

                      <div className="space-y-2 pt-2">
                        <div>
                          <label className="text-[11px] font-semibold text-[#8e95a5] block mb-1">
                            Google API Key:
                          </label>
                          <input
                            type="password"
                            value={googleApiKey}
                            onChange={(e) => setGoogleApiKey(e.target.value)}
                            placeholder="AIzaSy..."
                            className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-[#ff2a44]"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-[#8e95a5] block mb-1">
                            Search Engine ID (CX):
                          </label>
                          <input
                            type="text"
                            value={googleCseId}
                            onChange={(e) => setGoogleCseId(e.target.value)}
                            placeholder="ví dụ: 0123456789abcdef:..."
                            className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-[#ff2a44]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 5: HIỆU NĂNG & PHẦN CỨNG (PresentMon FPS + hardware snapshot) */}
                {activeTab === 'performance' && (
                  <div className="space-y-4">
                    {/* FPS Monitor status + one-time elevation setup */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Activity className="h-4 w-4 text-emerald-400" />
                            <span>Đo FPS tự động bằng PresentMon</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                                fpsStatus?.ready
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                  : 'bg-zinc-700/40 text-zinc-400 border-zinc-600/30'
                              }`}
                            >
                              {fpsStatus?.ready ? 'SẴN SÀNG' : 'CHƯA BẬT'}
                            </span>
                          </span>
                          <p className="mt-1.5 text-[11px] text-[#8e95a5] leading-relaxed">
                            Mỗi phiên chơi game sẽ được đo FPS trung bình + 1% low để làm dữ liệu cho bảng xếp hạng
                            hiệu năng. PresentMon tìm thấy: <span className="font-mono text-[#f1f3f7]">{fpsStatus?.presentMonFound ? '✓' : '✗'}</span>
                            {' · '}Scheduled Task: <span className="font-mono text-[#f1f3f7]">{fpsStatus?.taskInstalled ? '✓' : '✗'}</span>
                          </p>
                          {!fpsStatus?.ready && (
                            <p className="mt-1 text-[11px] text-amber-400/90">
                              💡 Bấm nút bên phải — PresentMon hỗ trợ <b>mọi GPU</b> (NVIDIA / AMD / Intel).
                              {!fpsStatus?.presentMonFound && ' Máy chưa có PresentMon → app sẽ tự tải bản chính thức từ GitHub (~1MB).'}
                              {' '}Chờ hộp thoại Windows (UAC) hiện lên và xác nhận <b>1 lần duy nhất</b>, sau đó toàn bộ đo FPS
                              sẽ chạy tự động ở nền với quyền admin.
                            </p>
                          )}
                        </div>

                        {!fpsStatus?.ready && (
                          <button
                            onClick={handleSetupFps}
                            disabled={settingUpFps}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:opacity-50 transition-all"
                          >
                            {settingUpFps ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                            <span>{settingUpFps ? 'Đang chờ UAC...' : '⚡ Bật đo FPS'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Hardware snapshot */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Layers className="h-4 w-4 text-[#ff2a44]" />
                          <span>Thông tin phần cứng máy</span>
                        </span>
                        <button
                          onClick={handleRefreshHardware}
                          className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3 py-1.5 text-[11px] font-bold text-[#8e95a5] hover:text-white hover:border-[#ff2a44] transition-all"
                          title="Thu thập lại thông tin phần cứng"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Cập nhật</span>
                        </button>
                      </div>

                      {hardwareInfo ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                          <div className="rounded-lg border border-[#2a2e3d]/70 bg-[#0e1015] px-3 py-2">
                            <div className="text-[10px] uppercase font-bold text-[#8e95a5]">CPU</div>
                            <div className="text-xs font-semibold text-[#f1f3f7] truncate" title={hardwareInfo.cpu_name}>
                              {hardwareInfo.cpu_name || '—'}
                            </div>
                            <div className="text-[10px] text-[#8e95a5]">{hardwareInfo.cpu_cores} nhân / {hardwareInfo.cpu_threads} luồng</div>
                          </div>
                          <div className="rounded-lg border border-[#2a2e3d]/70 bg-[#0e1015] px-3 py-2">
                            <div className="text-[10px] uppercase font-bold text-[#8e95a5]">GPU</div>
                            {hardwareInfo.gpus.length > 0 ? (
                              hardwareInfo.gpus.map((g, i) => (
                                <div key={i} className="text-xs font-semibold text-[#f1f3f7] truncate" title={g.name}>
                                  {g.name} {g.vram_mb > 0 ? `· ${(g.vram_mb / 1024).toFixed(1)} GB` : ''}
                                </div>
                              ))
                            ) : (
                              <div className="text-xs text-[#8e95a5]">—</div>
                            )}
                          </div>
                          <div className="rounded-lg border border-[#2a2e3d]/70 bg-[#0e1015] px-3 py-2">
                            <div className="text-[10px] uppercase font-bold text-[#8e95a5]">RAM &amp; Màn hình</div>
                            <div className="text-xs font-semibold text-[#f1f3f7]">
                              {hardwareInfo.ram_gb ? `${hardwareInfo.ram_gb} GB RAM` : '—'}
                              {hardwareInfo.display?.width
                                ? ` · ${hardwareInfo.display.width}×${hardwareInfo.display.height} @ ${hardwareInfo.display.refresh_hz}Hz`
                                : ''}
                            </div>
                          </div>
                          <div className="rounded-lg border border-[#2a2e3d]/70 bg-[#0e1015] px-3 py-2">
                            <div className="text-[10px] uppercase font-bold text-[#8e95a5]">Hệ điều hành</div>
                            <div className="text-xs font-semibold text-[#f1f3f7] truncate">{hardwareInfo.os_name || '—'}</div>
                            <div className="text-[10px] text-[#8e95a5]">Build {hardwareInfo.os_build || '—'} · Gom lúc {new Date(hardwareInfo.collected_at).toLocaleString('vi-VN')}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[11px] text-[#8e95a5] pt-1">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Đang thu thập thông tin phần cứng...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 6: GOOGLE DRIVE STORAGE & CLOUD */}
                {activeTab === 'storage' && (
                  <div className="space-y-6">
                    {/* Google Drive Storage Overview Card */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-4">
                      <div>
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Cloud className="h-4 w-4 text-[#ff2a44]" />
                          <span>Lưu trữ Screenshots &amp; Save Game (Google Drive)</span>
                        </span>
                        <p className="text-[11px] text-[#8e95a5] mt-1">
                          Screenshots và bản sao lưu save game cá nhân được lưu trực tiếp lên Google Drive theo tài khoản của bạn.
                          (Còn <strong>Cloudflare D1 Database</strong> chỉ dùng để đồng bộ danh sách game, giờ chơi, ảnh bìa chung và Cộng đồng).
                        </p>
                      </div>

                      {/* Google Drive for Desktop Pro Tip Banner */}
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                            <HardDrive className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white flex flex-wrap items-center gap-2">
                              <span>Mẹo: Lưu thẳng vào Ổ đĩa Google Drive (Google Drive for Desktop)</span>
                              {gdriveStatus?.isCurrentlyUsed && (
                                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                                  Đang kích hoạt
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#8e95a5] mt-0.5 leading-relaxed">
                              Bạn muốn ảnh chụp game lưu thẳng vào Google Drive và tự động đồng bộ ngầm mà không cần gọi API hay xác thực phức tạp? Chỉ cần dùng <strong>Google Drive for Desktop</strong> (biến Drive thành ổ đĩa trong PC) và trỏ thư mục lưu ảnh vào đó.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab('paths')}
                          className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                        >
                          Cấu hình trong Thư viện &amp; Lưu trữ →
                        </button>
                      </div>

                      {/* Active Google Drive Account & Dynamic Quota Card */}
                      <div className="rounded-xl border border-[#ff2a44]/60 bg-[#ff2a44]/5 p-4 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                              <HardDrive className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white flex items-center gap-2">
                                <span>Google Drive cá nhân</span>
                                {driveAccountEmail && (
                                  <span className="text-[10px] font-normal text-[#8e95a5]">({driveAccountEmail})</span>
                                )}
                              </div>
                              <div className="text-[11px] text-emerald-400 font-semibold">
                                {loadingDriveQuota ? (
                                  <span className="inline-flex items-center gap-1 text-[#8e95a5]">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Đang kiểm tra dung lượng theo tài khoản...
                                  </span>
                                ) : driveQuota ? (
                                  `${driveQuota.formattedLimit} · Chuẩn gốc`
                                ) : driveLoggedIn === false ? (
                                  'Chưa đăng nhập Google · Chuẩn gốc'
                                ) : (
                                  'Theo dung lượng tài khoản Google · Chuẩn gốc'
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={loadDriveQuota}
                            disabled={loadingDriveQuota}
                            className="flex items-center gap-1 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-1 text-[11px] font-semibold text-[#8e95a5] hover:text-white hover:border-emerald-400/50 transition-colors disabled:opacity-50"
                            title="Làm mới dung lượng Google Drive"
                          >
                            <RefreshCw className={`h-3 w-3 ${loadingDriveQuota ? 'animate-spin' : ''}`} />
                            <span>Làm mới</span>
                          </button>
                        </div>

                        {driveQuota && (
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-[#8e95a5]">Dung lượng đã dùng trên Drive</span>
                              <span className="font-mono font-bold text-emerald-400">
                                {driveQuota.formattedUsage} / {driveQuota.formattedLimit} ({driveQuota.percentUsed}%)
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-[#1e2230]">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  driveQuota.percentUsed > 90
                                    ? 'bg-rose-500'
                                    : driveQuota.percentUsed > 75
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(1, driveQuota.percentUsed))}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <p className="text-[11px] text-[#8e95a5] leading-relaxed">
                          Lưu trữ ảnh bìa, screenshots và save game vào thư mục <code className="text-white">Drive của tôi / GameVault</code>. Giữ 100% chất lượng gốc và cấu trúc thư mục game, dễ dàng kéo về máy mới.
                        </p>
                      </div>
                    </div>

                    {/* Google Drive Actions */}
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <HardDrive className="h-4 w-4 text-emerald-400" />
                            <span>Cấu hình &amp; Thao tác Google Drive</span>
                          </span>
                          <p className="text-[11px] text-[#8e95a5] mt-0.5">
                            Ảnh và save game được lưu trữ vào thư mục <code className="text-white">Drive của tôi / GameVault</code> trên Google Drive của bạn.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleTestStorage}
                          disabled={testingStorage}
                          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs font-semibold text-[#f1f3f7] hover:border-emerald-400 hover:text-white transition-all disabled:opacity-50"
                        >
                          {testingStorage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
                          <span>Kiểm tra quyền Drive</span>
                        </button>
                      </div>

                      {storageTestResult && (
                        <div className={`text-xs font-medium p-2.5 rounded-lg border ${storageTestResult.ok ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-rose-400 bg-rose-500/10 border-rose-500/30'}`}>
                          {storageTestResult.text}
                        </div>
                      )}

                      {actionResultMsg && (
                        <div className={`text-xs font-semibold p-2.5 rounded-lg border animate-in fade-in ${actionResultMsg.ok ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40' : 'text-rose-300 bg-rose-500/15 border-rose-500/40'}`}>
                          {actionResultMsg.text}
                        </div>
                      )}

                      {/* Quick 1-click sync actions right inside Settings */}
                      <div className="pt-2 border-t border-[#2a2e3d]/80 space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#8e95a5]">
                          Thao tác đồng bộ tức thì:
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={handleQuickSyncLibrary}
                            disabled={syncingLibrary}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 p-2.5 text-xs font-bold text-sky-400 hover:bg-sky-500/20 active:scale-95 disabled:opacity-50 transition-all"
                          >
                            {syncingLibrary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            <span>Đồng bộ Thư viện</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleQuickUploadDrive}
                            disabled={syncingDrive}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 active:scale-95 disabled:opacity-50 transition-all"
                          >
                            {syncingDrive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                            <span>Sao lưu ảnh lên Drive</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleQuickRestoreDrive}
                            disabled={restoringDrive}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-teal-500/40 bg-teal-500/10 p-2.5 text-xs font-bold text-teal-400 hover:bg-teal-500/20 active:scale-95 disabled:opacity-50 transition-all"
                          >
                            {restoringDrive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
                            <span>Kéo ảnh về máy này</span>
                          </button>
                        </div>

                        {onOpenSyncCenter && (
                          <div className="pt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenSyncCenter();
                              }}
                              className="flex items-center gap-1.5 text-xs font-bold text-sky-400 hover:text-sky-300 transition-colors"
                            >
                              <span>Mở Trung tâm Đồng bộ toàn diện &amp; gom ảnh F6</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Modal Footer: Save & Close */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2a2e3d] bg-[#161822] px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8e95a5]">
            <button
              type="button"
              disabled={sendingLog}
              onClick={async () => {
                if (!window.electronAPI?.sendDiagnosticLog) return;
                setSendingLog(true);
                setLogSendMsg(null);
                try {
                  const res = await window.electronAPI.sendDiagnosticLog();
                  if (res.ok) {
                    setLogSendMsg({ ok: true, text: `Đã gửi log (#${res.id || 'ok'})` });
                  } else {
                    setLogSendMsg({ ok: false, text: res.error || 'Gửi log thất bại' });
                  }
                } catch (err: any) {
                  setLogSendMsg({ ok: false, text: err?.message || 'Lỗi gửi log' });
                } finally {
                  setSendingLog(false);
                }
              }}
              className="flex items-center gap-1 rounded-md border border-[#2a2e3d] bg-[#1a1d28] px-2.5 py-1 text-[11px] font-semibold text-[#c4c9d4] hover:border-sky-500/50 hover:text-white disabled:opacity-50"
              title="Gửi file log chẩn đoán lên server để kiểm tra lỗi"
            >
              {sendingLog ? <Loader2 className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3 text-sky-400" />}
              <span>Gửi log lỗi</span>
            </button>
            <button
              type="button"
              onClick={() => window.electronAPI?.openLogFolder?.()}
              className="rounded-md border border-[#2a2e3d] bg-[#1a1d28] px-2 py-1 text-[11px] text-[#8e95a5] hover:text-white"
              title="Mở thư mục chứa file gamevault.log"
            >
              Mở log
            </button>
            {logSendMsg && (
              <span className={logSendMsg.ok ? 'text-emerald-400' : 'text-rose-400'}>
                {logSendMsg.text}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#2a2e3d] bg-[#1a1d28] px-4 py-2 text-xs font-semibold text-[#8e95a5] hover:text-white transition-colors"
            >
              Đóng
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-5 py-2 text-xs font-bold text-white shadow-lg shadow-[#ff2a44]/30 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              <span>{saving ? 'Đang lưu...' : 'Lưu cài đặt'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
