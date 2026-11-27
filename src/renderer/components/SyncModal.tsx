import React, { useState, useEffect } from 'react';
import { ConfirmModal } from './ConfirmModal.js';
import {
  X,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderSync,
  FileImage,
  ArrowRight,
  HardDrive,
  Cloud,
  UploadCloud,
  DownloadCloud,
  RefreshCw,
  Trophy,
  Gamepad2,
  ShieldCheck,
} from 'lucide-react';
import type {
  ScreenshotSyncSummary,
  Game,
  LibrarySyncResult,
  DriveMediaSyncResult,
  DriveMediaRestoreResult,
  DriveMediaStats,
  DriveStorageQuota,
  DriveMediaProgress,
  AuthStatus,
} from '../../shared/types.js';

export interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialTab?: SyncTab;
}

export type SyncTab = 'library' | 'drive_media' | 'local_f6';

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialTab,
}) => {
  const [activeTab, setActiveTab] = useState<SyncTab>(initialTab || 'library');

  useEffect(() => {
    if (initialTab && isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  // Auth status
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  // Tab 1: Library Cloud Sync State
  const [libraryLoading, setLibraryLoading] = useState<boolean>(false);
  const [libraryResult, setLibraryResult] = useState<LibrarySyncResult | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // Tab 2: Drive Media Sync State
  const [driveUploading, setDriveUploading] = useState<boolean>(false);
  const [driveDownloading, setDriveDownloading] = useState<boolean>(false);
  const [driveResult, setDriveResult] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [storageQuota, setStorageQuota] = useState<DriveStorageQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState<boolean>(false);
  const [driveProgress, setDriveProgress] = useState<DriveMediaProgress | null>(null);

  // Tab 3: Local F6 Screenshot Sync State
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [f6Loading, setF6Loading] = useState<boolean>(false);
  const [assigning, setAssigning] = useState<boolean>(false);
  const [f6Error, setF6Error] = useState<string | null>(null);
  const [f6Summary, setF6Summary] = useState<ScreenshotSyncSummary | null>(null);
  const [gamesList, setGamesList] = useState<Game[]>([]);
  const [selectedTargetGameId, setSelectedTargetGameId] = useState<number | null>(null);

  // Fetch Drive Storage Quota
  const fetchQuota = async () => {
    if (window.electronAPI?.getDriveStorageQuota) {
      setQuotaLoading(true);
      try {
        const q = await window.electronAPI.getDriveStorageQuota();
        setStorageQuota(q);
      } catch (err) {
        console.warn('Failed to fetch Drive storage quota:', err);
      } finally {
        setQuotaLoading(false);
      }
    }
  };

  // Check auth, quota, games and subscribe to progress
  useEffect(() => {
    if (isOpen) {
      if (window.electronAPI?.getAuthStatus) {
        window.electronAPI.getAuthStatus().then((s) => {
          setAuthStatus(s);
          if (s.loggedIn) fetchQuota();
        }).catch(console.error);
      }
      if (window.electronAPI?.getGames) {
        window.electronAPI.getGames().then((games) => {
          setGamesList(games || []);
        }).catch(console.error);
      }

      const unsub = window.electronAPI?.onDriveMediaProgress?.((p) => {
        setDriveProgress(p);
        if (p.type === 'upload') setDriveUploading(true);
        if (p.type === 'download') setDriveDownloading(true);
      });

      if (window.electronAPI?.getActiveMediaSyncStatus) {
        window.electronAPI.getActiveMediaSyncStatus().then((status) => {
          if (status.isRunning) {
            if (status.type === 'upload') setDriveUploading(true);
            if (status.type === 'download') setDriveDownloading(true);
            if (status.progress) setDriveProgress(status.progress);
          } else if (status.result) {
            if (status.type === 'upload') {
              const res = status.result;
              const formattedSize = res.bytesUploaded >= 1024 * 1024 * 1024
                ? `${(res.bytesUploaded / (1024 * 1024 * 1024)).toFixed(2)} GB`
                : `${(res.bytesUploaded / (1024 * 1024)).toFixed(1)} MB`;
              let msg = '';
              if (res.filesUploaded > 0) {
                msg = `Đã sao lưu thành công ${res.filesUploaded} file media (${formattedSize}) từ ${res.gamesProcessed} game lên Google Drive!`;
              } else {
                msg = `Toàn bộ ảnh & video từ ${res.gamesProcessed} game đã đồng bộ trên Google Drive từ trước (Các ảnh F6 vừa chụp đã tự động có trên ổ G:).`;
              }
              if (res.errors && res.errors.length > 0) {
                msg += ` (Có ${res.errors.length} file gặp lỗi tải)`;
              }
              setDriveResult(msg);
            }
          }
        }).catch(console.error);
      }

      return () => {
        unsub?.();
      };
    }
  }, [isOpen]);

  // Refresh Drive storage quota whenever the Drive tab is selected
  useEffect(() => {
    if (isOpen && activeTab === 'drive_media' && authStatus?.loggedIn) {
      fetchQuota();
    }
  }, [isOpen, activeTab, authStatus?.loggedIn]);

  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);

  if (!isOpen) return null;

  // Handler: Sync Library with Cloudflare D1
  const handleSyncLibrary = async (mode: 'merge' | 'overwrite' = 'merge', confirmedOverwrite = false) => {
    if (mode === 'overwrite' && !confirmedOverwrite) {
      setOverwriteConfirmOpen(true);
      return;
    }

    setLibraryLoading(true);
    setLibraryError(null);
    setLibraryResult(null);

    try {
      if (window.electronAPI?.syncLibrary) {
        const res = await window.electronAPI.syncLibrary({ mode });
        setLibraryResult(res);
        onSuccess();
      } else {
        throw new Error('API đồng bộ thư viện chưa khả dụng.');
      }
    } catch (err: any) {
      console.error('Library sync error:', err);
      setLibraryError(err?.message || 'Không thể đồng bộ thư viện lên Cloudflare.');
    } finally {
      setLibraryLoading(false);
    }
  };

  // Handler: Upload Media to Google Drive
  const handleUploadMediaToDrive = async () => {
    setDriveUploading(true);
    setDriveProgress(null);
    setDriveError(null);
    setDriveResult(null);

    try {
      if (window.electronAPI?.uploadMediaToDrive) {
        const res: DriveMediaSyncResult = await window.electronAPI.uploadMediaToDrive();
        const formattedSize = res.bytesUploaded >= 1024 * 1024 * 1024
          ? `${(res.bytesUploaded / (1024 * 1024 * 1024)).toFixed(2)} GB`
          : `${(res.bytesUploaded / (1024 * 1024)).toFixed(1)} MB`;
        let msg = '';
        if (res.filesUploaded > 0) {
          msg = `Đã sao lưu thành công ${res.filesUploaded} file media (${formattedSize}) từ ${res.gamesProcessed} game lên Google Drive!`;
        } else {
          msg = `Toàn bộ ảnh & video từ ${res.gamesProcessed} game đã đồng bộ trên Google Drive từ trước (Các ảnh F6 vừa chụp đã tự động có trên ổ G:).`;
        }
        if (res.errors && res.errors.length > 0) {
          msg += ` (Có ${res.errors.length} file gặp lỗi tải)`;
        }
        setDriveResult(msg);
        fetchQuota();
        onSuccess();
      } else {
        throw new Error('API Google Drive media chưa khả dụng.');
      }
    } catch (err: any) {
      console.error('Drive upload media error:', err);
      setDriveError(err?.message || 'Không thể tải media lên Google Drive.');
    } finally {
      setDriveUploading(false);
      setDriveProgress(null);
      fetchQuota();
    }
  };

  // Handler: Download Media from Google Drive
  const handleDownloadMediaFromDrive = async () => {
    setDriveDownloading(true);
    setDriveProgress(null);
    setDriveError(null);
    setDriveResult(null);

    try {
      if (window.electronAPI?.downloadMediaFromDrive) {
        const res: DriveMediaRestoreResult = await window.electronAPI.downloadMediaFromDrive();
        setDriveResult(
          `Đã kéo thành công ${res.filesDownloaded} file media về thư mục "${res.localBaseDir}" (từ ${res.gamesRestored} game)!`
        );
        fetchQuota();
        onSuccess();
      } else {
        throw new Error('API Google Drive media chưa khả dụng.');
      }
    } catch (err: any) {
      console.error('Drive download media error:', err);
      setDriveError(err?.message || 'Không thể kéo file từ Google Drive về máy.');
    } finally {
      setDriveDownloading(false);
      setDriveProgress(null);
      fetchQuota();
    }
  };

  // Handler: Local F6 sync
  const handleF6Sync = async (isDryRun: boolean) => {
    setF6Loading(true);
    setF6Error(null);
    setF6Summary(null);

    try {
      if (window.electronAPI?.syncScreenshots) {
        const res = await window.electronAPI.syncScreenshots({ dryRun: isDryRun });
        setF6Summary(res);
        if (!isDryRun && res.moved > 0) {
          if (window.electronAPI?.uploadMediaToDrive) {
            window.electronAPI.uploadMediaToDrive().catch(console.error);
          }
          onSuccess();
        }
      } else {
        throw new Error('API Electron không khả dụng.');
      }
    } catch (err: any) {
      console.error('Screenshot sync error:', err);
      setF6Error(err?.message || 'Không thể quét hoặc đồng bộ ảnh chụp màn hình');
    } finally {
      setF6Loading(false);
    }
  };

  const handleAssignUnmatched = async () => {
    if (!selectedTargetGameId || !f6Summary?.unmatched || f6Summary.unmatched.length === 0) return;
    setAssigning(true);
    setF6Error(null);

    try {
      if (window.electronAPI?.syncScreenshots) {
        const res = await window.electronAPI.syncScreenshots({
          dryRun: false,
          targetGameId: selectedTargetGameId,
          unmatchedFiles: f6Summary.unmatched.map((u) => u.file),
        });
        setF6Summary(res);
        onSuccess();
      }
    } catch (err: any) {
      console.error('Failed to assign unmatched screenshots:', err);
      setF6Error(err?.message || 'Không thể gán ảnh vào game đã chọn');
    } finally {
      setAssigning(false);
    }
  };

  const isLoggedIn = authStatus?.loggedIn;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-[#2a2e3d] bg-[#161821] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] px-6 py-4 bg-[#0e1015]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff2a44]/20 border border-[#ff2a44]/40">
              <RefreshCw className="h-5 w-5 text-[#ff2a44]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Trung tâm Đồng bộ (Cloud &amp; Drive)</h2>
              <p className="text-xs text-[#8e95a5]">
                Đồng bộ toàn bộ game (Đang chơi, Wishlist, Phá đảo, Bỏ dở...) &amp; sao lưu ảnh/video lên Drive
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8e95a5] hover:bg-[#ff2a44]/20 hover:text-[#ff2a44] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#2a2e3d] bg-[#12141c] px-6">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-2 border-b-2 py-3 px-3 text-xs font-bold transition-all ${
              activeTab === 'library'
                ? 'border-[#ff2a44] text-white'
                : 'border-transparent text-[#8e95a5] hover:text-[#f1f3f7]'
            }`}
          >
            <Cloud className="h-4 w-4 text-sky-400" />
            <span>Thư viện Game (Cloud)</span>
          </button>

          <button
            onClick={() => setActiveTab('drive_media')}
            className={`flex items-center gap-2 border-b-2 py-3 px-3 text-xs font-bold transition-all ${
              activeTab === 'drive_media'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-[#8e95a5] hover:text-[#f1f3f7]'
            }`}
          >
            <HardDrive className="h-4 w-4 text-emerald-400" />
            <span>Ảnh &amp; Video (Google Drive)</span>
          </button>

          <button
            onClick={() => setActiveTab('local_f6')}
            className={`flex items-center gap-2 border-b-2 py-3 px-3 text-xs font-bold transition-all ${
              activeTab === 'local_f6'
                ? 'border-amber-500 text-white'
                : 'border-transparent text-[#8e95a5] hover:text-[#f1f3f7]'
            }`}
          >
            <Zap className="h-4 w-4 text-amber-400" />
            <span>Gom ảnh (C: ➔ E: &amp; G:)</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* ======================================================== */}
          {/* TAB 1: THƯ VIỆN GAME CLOUD                               */}
          {/* ======================================================== */}
          {activeTab === 'library' && (
            <div className="space-y-4 animate-in fade-in">
              {/* Login Banner */}
              {!isLoggedIn ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-300">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
                  <div>
                    <div className="font-bold text-white mb-0.5">Bạn chưa đăng nhập Google</div>
                    <p className="text-[#8e95a5]">
                      Vui lòng bấm nút <strong>Đăng nhập</strong> ở góc trên bên phải thanh Navbar trước để kết nối tài khoản Cloudflare &amp; Google Drive của bạn.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-xs">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                    <div>
                      <div className="font-bold text-white">
                        Đang kết nối: {authStatus?.profile?.displayName || authStatus?.profile?.email}
                      </div>
                      <div className="text-[11px] text-[#8e95a5]">
                        Sẵn sàng đồng bộ 2 chiều với Cloudflare D1
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* All status badges indicator */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#2a2e3d]/70 bg-[#0e1015]/80 px-3.5 py-2.5 text-[11px]">
                <span className="font-bold text-white shrink-0">Hỗ trợ đồng bộ 100% các trạng thái:</span>
                <span className="rounded bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-sky-400 font-semibold">🎮 Đang chơi</span>
                <span className="rounded bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-purple-400 font-semibold">🎯 Wishlist (Chờ chơi)</span>
                <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-emerald-400 font-semibold">🏆 Phá đảo</span>
                <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-amber-400 font-semibold">⏸️ Tạm dừng</span>
                <span className="rounded bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-rose-400 font-semibold">🚫 Bỏ dở</span>
              </div>

              {libraryError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{libraryError}</span>
                </div>
              )}

              {/* Sync Result */}
              {libraryResult && (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
                  <div className="flex items-center justify-between text-emerald-400 font-bold text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5" />
                      <span>
                        {libraryResult.authoritativePull
                          ? 'Đã kéo lại toàn bộ dữ liệu chuẩn từ Cloud!'
                          : 'Đồng bộ thư viện thành công!'}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-[#8e95a5]">
                      Tổng: {libraryResult.totalCount} game trên Cloud
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-[#0e1015] p-2.5 border border-[#2a2e3d]">
                      <div className="text-[#8e95a5] text-[10px] uppercase font-bold">Đã đẩy lên Cloud</div>
                      <div className="text-base font-bold text-sky-400">{libraryResult.pushed}</div>
                    </div>
                    <div className="rounded-lg bg-[#0e1015] p-2.5 border border-[#2a2e3d]">
                      <div className="text-[#8e95a5] text-[10px] uppercase font-bold">Kéo mới về máy</div>
                      <div className="text-base font-bold text-emerald-400">{libraryResult.pulled}</div>
                    </div>
                    <div className="rounded-lg bg-[#0e1015] p-2.5 border border-[#2a2e3d]">
                      <div className="text-[#8e95a5] text-[10px] uppercase font-bold">Cập nhật giờ / status</div>
                      <div className="text-base font-bold text-amber-400">{libraryResult.updated}</div>
                    </div>
                    <div className="rounded-lg bg-[#0e1015] p-2.5 border border-[#2a2e3d]">
                      <div className="text-[#8e95a5] text-[10px] uppercase font-bold">Đã phá đảo</div>
                      <div className="text-base font-bold text-purple-400 flex items-center justify-center gap-1">
                        <Trophy className="h-3.5 w-3.5" />
                        <span>{libraryResult.completedCount}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Breakdown Pills */}
                  {libraryResult.stats && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#0e1015] px-3 py-2 border border-[#2a2e3d] text-[11px]">
                      <span className="text-[#8e95a5] font-semibold">Phân loại trên Cloud:</span>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-sky-400 font-medium">🎮 Đang chơi: <strong>{libraryResult.stats.playing}</strong></span>
                        <span className="text-purple-400 font-medium">🎯 Wishlist: <strong>{libraryResult.stats.backlog}</strong></span>
                        <span className="text-emerald-400 font-medium">🏆 Phá đảo: <strong>{libraryResult.stats.completed}</strong></span>
                        <span className="text-amber-400 font-medium">⏸️ Tạm dừng: <strong>{libraryResult.stats.paused}</strong></span>
                        <span className="text-rose-400 font-medium">🚫 Bỏ dở: <strong>{libraryResult.stats.dropped}</strong></span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Explanatory Info Card */}
              <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 text-xs text-[#8e95a5] space-y-2.5">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Gamepad2 className="h-4 w-4 text-[#ff2a44]" />
                  <span>Quy tắc đồng bộ thư viện giữa các máy tính:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1.5 text-[11px]">
                  <li>
                    <strong>Đồng bộ tất cả 5 trạng thái game:</strong> Toàn bộ game thuộc các danh mục <em>Wishlist (Chờ chơi), Đang chơi, Bỏ dở, Tạm dừng, Phá đảo</em> đều được đồng bộ 2 chiều đầy đủ giữa tất cả các máy tính của bạn.
                  </li>
                  <li>
                    <strong>Bảo toàn trạng thái Phá đảo (Completed):</strong> Nếu game đã được đánh dấu là <em>Phá đảo</em> ở bất kỳ máy nào, trạng thái đó được giữ nguyên vĩnh viễn trên cloud, không bao giờ bị máy khác vô tình ghi đè hạ bậc.
                  </li>
                  <li>
                    <strong>Thời gian chơi (Playtime):</strong> Luôn giữ mức giờ chơi cao nhất (MAX), đảm bảo không bao giờ bị thụt lùi khi chuyển đổi máy tính.
                  </li>
                  <li>
                    <strong>Kéo về máy mới 100%:</strong> Khi mở app ở máy mới và bấm đồng bộ, toàn bộ danh sách game, bìa, banner, điểm số cá nhân và ghi chú sẽ được kéo về đầy đủ.
                  </li>
                </ul>
              </div>

              {/* Sync Buttons */}
              <div className="pt-2 space-y-2">
                <button
                  onClick={() => handleSyncLibrary('merge')}
                  disabled={libraryLoading || !isLoggedIn}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-3 text-xs font-bold text-white shadow-lg shadow-sky-500/25 hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all"
                >
                  {libraryLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Đang đồng bộ thư viện với Cloudflare D1...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      <span>Bắt đầu Đồng bộ Thư viện ngay</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleSyncLibrary('overwrite')}
                  disabled={libraryLoading || !isLoggedIn}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 active:scale-95 disabled:opacity-50 transition-all"
                  title="Dùng dữ liệu máy này làm bản chuẩn duy nhất, xóa dữ liệu lệch trên Cloud để máy khác tự kéo về"
                >
                  <UploadCloud className="h-4 w-4" />
                  <span>Đặt máy này làm chuẩn (Ghi đè Cloud)</span>
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: ẢNH CHỤP SCREENSHOTS GOOGLE DRIVE                 */}
          {/* ======================================================== */}
          {activeTab === 'drive_media' && (
            <div className="space-y-4 animate-in fade-in">
              {!isLoggedIn && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-300">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
                  <div>
                    <div className="font-bold text-white mb-0.5">Cần đăng nhập Google</div>
                    <p className="text-[#8e95a5]">
                      Google Drive dùng tài khoản Google cá nhân của bạn để lưu ảnh &amp; video an toàn trong không gian riêng tư.
                    </p>
                  </div>
                </div>
              )}

              {/* Drive Storage Quota Card (Dung lượng X GB / Y GB, %) */}
              {isLoggedIn && (
                <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-emerald-400" />
                      <span className="font-bold text-white">Dung lượng Google Drive cá nhân</span>
                    </div>
                    {quotaLoading ? (
                      <span className="text-xs text-[#8e95a5] flex items-center gap-1.5 font-mono">
                        <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
                        <span>Đang đọc dung lượng...</span>
                      </span>
                    ) : storageQuota ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-emerald-400">
                          {storageQuota.formattedUsage} / {storageQuota.formattedLimit}
                        </span>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                          {storageQuota.percentUsed}%
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={fetchQuota}
                        className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Kiểm tra dung lượng</span>
                      </button>
                    )}
                  </div>

                  {/* Quota Progress Bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#1e2230]">
                    <div
                      className={`h-full transition-all duration-300 ${
                        (storageQuota?.percentUsed || 0) > 90
                          ? 'bg-rose-500'
                          : (storageQuota?.percentUsed || 0) > 75
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(storageQuota ? 1 : 0, storageQuota?.percentUsed || 0))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#8e95a5]">
                    <span>Thư mục hiển thị: <strong className="text-emerald-400">Drive của tôi / GameVault</strong> (hoặc ổ ảo <strong className="text-emerald-400">G:\My Drive\GameVault</strong>)</span>
                    <button
                      onClick={fetchQuota}
                      disabled={quotaLoading}
                      className="text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 text-[11px] disabled:opacity-50"
                      title="Làm mới dung lượng Drive"
                    >
                      <RefreshCw className={`h-3 w-3 ${quotaLoading ? 'animate-spin' : ''}`} />
                      <span>Làm mới</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Real-time Transfer Progress Box (Upload or Download) */}
              {(driveUploading || driveDownloading) && (
                <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                      <span>
                        {driveUploading ? 'Đang đẩy ảnh & video lên Google Drive (đa luồng)...' : 'Đang kéo ảnh & video từ Google Drive về máy (đa luồng)...'}
                      </span>
                    </div>
                    <span className="font-mono text-sm font-bold text-emerald-400">
                      {driveProgress ? `${driveProgress.percent}%` : 'Đang chuẩn bị...'}
                    </span>
                  </div>

                  {/* Transfer Progress Bar */}
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#0e1015] border border-[#2a2e3d]">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-200"
                      style={{ width: `${Math.min(100, Math.max(0, driveProgress?.percent || 0))}%` }}
                    />
                  </div>

                  {/* File & Game Info */}
                  <div className="flex flex-col gap-1 text-[11px]">
                    {driveProgress ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-white font-semibold truncate max-w-[58%]">
                            🎮 {driveProgress.currentGame}
                          </span>
                          <div className="flex items-center gap-2 font-mono shrink-0">
                            {driveProgress.formattedSpeed && (
                              <span className="text-teal-300 font-bold bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/30 text-[10px]">
                                ⚡ {driveProgress.formattedSpeed}
                              </span>
                            )}
                            <span className="font-bold text-emerald-300 text-xs">
                              {driveProgress.current} / {driveProgress.total} file
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[#8e95a5] pt-0.5">
                          <span className="font-mono truncate max-w-[52%]" title={driveProgress.currentFile}>
                            📄 {driveProgress.currentFile}
                          </span>
                          <span className="font-mono font-bold text-emerald-400 shrink-0">
                            {driveProgress.formattedTransferred && driveProgress.formattedTotal
                              ? `${driveProgress.formattedTransferred} / ${driveProgress.formattedTotal}`
                              : driveProgress.bytesTransferred > 0
                              ? `${(driveProgress.bytesTransferred / (1024 * 1024)).toFixed(1)} MB`
                              : ''}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-[#8e95a5] italic flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
                        <span>Đang quét danh sách file và so khớp với Drive (bỏ qua file đã tải)...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {driveError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{driveError}</span>
                </div>
              )}

              {driveResult && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span>{driveResult}</span>
                </div>
              )}

              <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 text-xs text-[#8e95a5] space-y-2">
                <div className="flex items-center gap-2 font-bold text-white">
                  <HardDrive className="h-4 w-4 text-emerald-400" />
                  <span>Tại sao Google Drive tốt hơn Google Photos?</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Lưu vào <strong>Google Drive (Thư mục &quot;Drive của tôi / GameVault&quot; hiển thị trực quan hoặc ổ ảo G:)</strong> giữ nguyên vẹn 100% cấu trúc thư mục game (<code className="text-white">E:\Game\&lt;Tên Game&gt;</code>) và toàn bộ ảnh chụp (F6) lẫn video gameplay (.mp4, .mov...) gốc không bị Google nén giảm chất lượng. Bạn có thể mở web <strong className="text-emerald-400">drive.google.com</strong> hoặc ứng dụng trên điện thoại để lướt xem ảnh bất cứ lúc nào! Khi sang máy mới, chỉ cần bấm nút <strong>&quot;Kéo toàn bộ về máy&quot;</strong> là xong!
                </p>
              </div>

              {/* 2 Action Buttons: Upload & Download */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <button
                  onClick={handleUploadMediaToDrive}
                  disabled={driveUploading || driveDownloading || !isLoggedIn}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-4 text-xs font-bold text-white hover:bg-emerald-500/25 active:scale-95 disabled:opacity-50 transition-all"
                >
                  {driveUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                  ) : (
                    <UploadCloud className="h-6 w-6 text-emerald-400" />
                  )}
                  <span>Sao lưu ảnh &amp; video lên Google Drive</span>
                  <span className="text-[10px] font-normal text-[#8e95a5]">
                    {driveUploading
                      ? driveProgress
                        ? `Đang đẩy: ${driveProgress.percent}% (${driveProgress.formattedTransferred || `${driveProgress.current}/${driveProgress.total} file`}) • ${driveProgress.formattedSpeed || ''}`
                        : 'Đang đẩy lên Drive...'
                      : 'Quét E:\\Game và đẩy ảnh & video mới lên (đa luồng siêu tốc)'}
                  </span>
                </button>

                <button
                  onClick={handleDownloadMediaFromDrive}
                  disabled={driveUploading || driveDownloading || !isLoggedIn}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/15 p-4 text-xs font-bold text-white hover:bg-sky-500/25 active:scale-95 disabled:opacity-50 transition-all"
                >
                  {driveDownloading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
                  ) : (
                    <DownloadCloud className="h-6 w-6 text-sky-400" />
                  )}
                  <span>Kéo toàn bộ ảnh &amp; video từ Drive về máy</span>
                  <span className="text-[10px] font-normal text-[#8e95a5]">
                    {driveDownloading
                      ? driveProgress
                        ? `Đang kéo: ${driveProgress.percent}% (${driveProgress.formattedTransferred || `${driveProgress.current}/${driveProgress.total} file`}) • ${driveProgress.formattedSpeed || ''}`
                        : 'Đang tải từ Drive về...'
                      : 'Tải về thư mục E:\\Game máy này'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: GOM ẢNH F6 CỤC BỘ MÁY NÀY                          */}
          {/* ======================================================== */}
          {activeTab === 'local_f6' && (
            <div className="space-y-4 animate-in fade-in">
              {f6Error && (
                <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{f6Error}</span>
                </div>
              )}

              {/* Mode Switcher */}
              <div className="flex items-center justify-between rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-3 text-xs">
                <div className="flex items-center gap-2">
                  <FolderSync className="h-4 w-4 text-[#ff2a44]" />
                  <span className="font-semibold text-[#f1f3f7]">Chế độ chạy thử nghiệm (Dry Run):</span>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-9 rounded-full bg-[#2a2e3d] peer-checked:bg-[#ff2a44] peer-focus:outline-none after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
                </label>
              </div>

              {/* F6 Summary */}
              {f6Summary ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>
                      {dryRun
                        ? `Kết quả quét thử nghiệm: Khớp ${f6Summary.matched} ảnh.`
                        : `Gom ảnh thành công! Đã cut ${f6Summary.moved} ảnh từ C: sang E:\\Game và đồng bộ lên Google Drive (G:).`}
                    </span>
                  </div>

                  {f6Summary.details && f6Summary.details.length > 0 ? (
                    <div className="max-h-52 overflow-y-auto rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-3 space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#8e95a5] px-1">
                        Danh sách tệp tin được khớp:
                      </div>
                      {f6Summary.details.map((d, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between gap-3 rounded-lg bg-[#161821] px-3 py-2 text-xs border border-[#2a2e3d]/60"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <FileImage className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="font-mono text-[#f1f3f7] truncate">{d.file}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-[#8e95a5]">
                            <ArrowRight className="h-3 w-3 text-[#ff2a44]" />
                            <span className="font-semibold text-white">{d.gameTitle}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-5 text-center text-xs text-[#8e95a5]">
                      Không có ảnh chụp F6 mới nào trùng khớp với thời gian phiên chơi.
                    </div>
                  )}

                  {/* Unmatched Screenshots Recovery */}
                  {f6Summary.unmatched && f6Summary.unmatched.length > 0 && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>Phát hiện {f6Summary.unmatched.length} ảnh chưa khớp phiên chơi tự động</span>
                      </div>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <select
                          value={selectedTargetGameId ?? ''}
                          onChange={(e) => setSelectedTargetGameId(Number(e.target.value) || null)}
                          className="flex-1 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white outline-none focus:border-amber-400"
                        >
                          <option value="">-- Chọn game để gán ảnh --</option>
                          {gamesList.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={!selectedTargetGameId || assigning}
                          onClick={handleAssignUnmatched}
                          className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:opacity-50 transition-colors shadow-md shadow-amber-500/20"
                        >
                          {assigning ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Đang gán...</span>
                            </>
                          ) : (
                            <>
                              <Zap className="h-3.5 w-3.5" />
                              <span>Gán vào game này</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 text-xs text-[#8e95a5] space-y-2">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <span>Quy trình Gom ảnh màn hình (C: ➔ E:\Game &amp; Ổ G:):</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-[11px]">
                    <li>Khi chụp ảnh: Lưu tạm trên ổ SSD C: (<code className="text-white">Pictures\Screenshots</code>) và tự động đẩy ngay 1 bản sang Google Drive G: (<code className="text-white">G:\My Drive\GameVault</code>).</li>
                    <li>Khi bấm nút gom ảnh: App đối chiếu thời gian chơi game, tự động <strong className="text-white">Cut (di chuyển)</strong> toàn bộ ảnh từ C: sang ổ HDD <code className="text-white">E:\Game\&lt;Tên Game&gt;</code> để lưu trữ vĩnh viễn và dọn sạch ổ C:.</li>
                    <li>Ổ HDD E: hoàn toàn ngủ (spin-down) khi đang chơi game, chỉ khởi động khi bạn chủ động bấm nút dưới đây.</li>
                  </ul>
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={() => handleF6Sync(dryRun)}
                  disabled={f6Loading}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-[#ff2a44] px-5 py-3 text-xs font-bold text-white shadow-lg shadow-amber-500/25 hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {f6Loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Đang quét và gom ảnh...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      <span>
                        {dryRun ? 'Chạy thử nghiệm (Xem trước kết quả)' : 'Bắt đầu Gom ảnh từ C: sang E: & G:'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-[#2a2e3d] px-6 py-3.5 bg-[#0e1015]">
          <div className="text-[11px] text-[#8e95a5]">
            {driveUploading || driveDownloading
              ? '⚡ Bạn có thể đóng cửa sổ này, tiến trình đồng bộ vẫn sẽ tiếp tục chạy ngầm trong background.'
              : '💡 Gợi ý: Bật đồng bộ để game trên laptop và PC luôn cập nhật cùng nhau.'}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[#2a2e3d] bg-[#161821] px-5 py-2 text-xs font-semibold text-[#f1f3f7] hover:bg-[#1f2230] transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={overwriteConfirmOpen}
        title="Ghi đè dữ liệu Cloud"
        message="Thao tác này sẽ dùng toàn bộ thư viện & lịch sử chơi của MÁY NÀY làm chuẩn, ghi đè sạch dữ liệu cũ trên Cloud. Các máy khác khi bấm Đồng bộ lần tới sẽ tự động kéo bản chuẩn này về. Tiếp tục?"
        confirmText="Ghi đè Cloud"
        onConfirm={() => {
          setOverwriteConfirmOpen(false);
          void handleSyncLibrary('overwrite', true);
        }}
        onCancel={() => setOverwriteConfirmOpen(false)}
      />
    </div>
  );
};
