import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  HardDriveUpload,
  FolderPlus,
  ScanSearch,
  Globe,
  Download,
  RotateCcw,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  RefreshCw,
  ExternalLink,
  ArrowLeftRight,
  CloudDownload,
  Tag,
  Laptop,
  User,
  ShieldCheck,
  Check,
} from 'lucide-react';
import type {
  ActiveSaveProfile,
  DriveGameBackup,
  SaveBackup,
  SaveBackupResult,
  SaveBackupTrigger,
  SaveLocationCandidate,
  SavePathConfig,
  SaveProfileInfo,
  SaveProfileSwapResult,
  SaveRestoreResult,
  SavesListResult,
  VaultInfo,
  WebSaveCandidate,
} from '../../shared/types.js';

const CONFIDENCE_META: Record<string, { label: string; className: string }> = {
  high: { label: 'Khớp cao', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  medium: { label: 'Có thể', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  low: { label: 'Nghi vấn', className: 'bg-[#2a2e3d] text-[#8e95a5] border-[#2a2e3d]' },
};

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Thủ công',
  pre_restore: 'An toàn tự động',
  host_snapshot: 'Save chủ máy',
  my_save: 'Save của tôi',
};

const TRIGGER_STYLE: Record<string, string> = {
  manual: 'bg-[#2a2e3d] text-[#8e95a5] border-[#2a2e3d]',
  pre_restore: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  host_snapshot: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30 font-semibold',
  my_save: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-semibold',
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

interface SaveVaultSectionProps {
  gameId: number;
}

export const SaveVaultSection: React.FC<SaveVaultSectionProps> = ({ gameId }) => {
  const [list, setList] = useState<SavesListResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastBackupResult, setLastBackupResult] = useState<SaveBackupResult | null>(null);
  const [candidates, setCandidates] = useState<SaveLocationCandidate[] | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [webCandidates, setWebCandidates] = useState<WebSaveCandidate[] | null>(null);
  const [webSelected, setWebSelected] = useState<Set<string>>(new Set());
  const [webQuery, setWebQuery] = useState<string>('');
  const [driveMsg, setDriveMsg] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<SaveBackup | null>(null);
  const [restoreResult, setRestoreResult] = useState<SaveRestoreResult | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // Profile Swapper & Cloud State
  const [cloudBackups, setCloudBackups] = useState<DriveGameBackup[] | null>(null);
  const [showCloudModal, setShowCloudModal] = useState<boolean>(false);
  const [swapResult, setSwapResult] = useState<SaveProfileSwapResult | null>(null);
  const [tagModalBackup, setTagModalBackup] = useState<SaveBackup | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI.getSavesList(gameId);
      setList(result);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setLastBackupResult(null);
    setCandidates(null);
    setWebCandidates(null);
    refresh();
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(String(err?.message || err).replace(/^Error invoking remote method '[^']*': Error: /, ''));
    } finally {
      setBusy(null);
    }
  };

  const handleDetect = () =>
    run('detect', async () => {
      const found = await window.electronAPI.detectSaveLocations(gameId);
      setCandidates(found);
      setSelectedCandidates(new Set(found.filter((c) => c.confidence === 'high').map((c) => c.path)));
    });

  const handleSearchWeb = () =>
    run('web', async () => {
      const summary = (await window.electronAPI.searchSaveLocationsWeb?.(gameId))!;
      setWebCandidates(summary.candidates);
      setWebQuery(summary.query);
      setWebSelected(
        new Set(
          summary.candidates
            .filter((c) => c.selectable && (c.exists || c.confidence === 'high'))
            .map((c) => c.resolvedPath)
        )
      );
    });

  const handleAddSelected = () =>
    run('addSelected', async () => {
      for (const path of selectedCandidates) {
        await window.electronAPI.addSavePath(gameId, path);
      }
      setCandidates(null);
      setSelectedCandidates(new Set());
      await refresh();
    });

  const handleAddWebSelected = () =>
    run('addWebSelected', async () => {
      for (const path of webSelected) {
        await window.electronAPI.addSavePath(gameId, path);
      }
      setWebCandidates(null);
      setWebSelected(new Set());
      await refresh();
    });

  const handleAddManual = () =>
    run('addManual', async () => {
      const folder = await window.electronAPI.browseSaveFolder();
      if (folder) {
        await window.electronAPI.addSavePath(gameId, folder);
        await refresh();
      }
    });

  const handleTogglePath = (pathConfig: SavePathConfig) =>
    run(`toggle-${pathConfig.id}`, async () => {
      await window.electronAPI.toggleSavePath(pathConfig.id, pathConfig.enabled !== 1);
      await refresh();
    });

  const handleRemovePath = (pathConfig: SavePathConfig) =>
    setConfirmState({
      title: 'Bỏ khai báo folder save',
      message: `Ngừng theo dõi folder này khi backup?\n\n${pathConfig.source_path}\n\nDữ liệu trên disk và các bản backup cũ vẫn giữ nguyên.`,
      confirmLabel: 'Bỏ khai báo',
      onConfirm: () =>
        run(`remove-${pathConfig.id}`, async () => {
          await window.electronAPI.removeSavePath(pathConfig.id);
          setConfirmState(null);
          await refresh();
        }),
    });

  const handleBackupNow = () =>
    run('backup', async () => {
      const result = await window.electronAPI.backupSavesNow(gameId);
      setLastBackupResult(result);
      await refresh();
    });

  const handleRestoreConfirm = () =>
    run('restore', async () => {
      if (!restoreTarget) return;
      const result = await window.electronAPI.restoreSaveBackup(restoreTarget.id);
      setRestoreTarget(null);
      setRestoreResult(result);
      await refresh();
    });

  const handleDeleteBackup = (backup: SaveBackup) =>
    setConfirmState({
      title: 'Xóa bản backup',
      message: `Xóa vĩnh viễn bản backup này khỏi vault?\n\n${backup.backup_dir}`,
      confirmLabel: 'Xóa vĩnh viễn',
      onConfirm: () =>
        run(`deleteBackup-${backup.id}`, async () => {
          await window.electronAPI.deleteSaveBackup(backup.id);
          setConfirmState(null);
          await refresh();
        }),
    });

  const handleChangeVaultRoot = () =>
    run('vaultRoot', async () => {
      const folder = await window.electronAPI.browseSaveFolder();
      if (!folder) return;
      const info = await window.electronAPI.setVaultRoot(folder);
      setList((prev) => (prev ? { ...prev, vault: info } : prev));
    });

  const handleUploadToDrive = (backup: SaveBackup) =>
    run(`drive-${backup.id}`, async () => {
      const result = await window.electronAPI.uploadBackupToDrive?.(backup.id);
      if (result) {
        setDriveMsg(
          `Đã upload ${result.filesUploaded} file lên Drive: ${result.drivePath} (${formatBytes(result.bytesUploaded)})`
        );
      }
    });

  const vault: VaultInfo | null = list?.vault ?? null;
  const paths = list?.paths ?? [];
  const backups = list?.backups ?? [];
  const profileInfo: SaveProfileInfo | null = list?.profileInfo ?? null;
  const isGameRunning = profileInfo?.isGameRunning ?? false;

  const handleSwitchToMySave = () => {
    if (isGameRunning) {
      setError('Game đang chạy! Vui lòng thoát game trước khi đổi file save để tránh lỗi dữ liệu.');
      return;
    }
    const mySaves = backups.filter((b) => b.trigger === 'my_save' || b.trigger === 'manual');
    if (mySaves.length === 0) {
      setConfirmState({
        title: 'Chưa có bản save cá nhân trong vault',
        message: 'Trong máy chưa có bản save nào của bạn. Bạn có muốn quét Google Drive để tải save về không?',
        confirmLabel: 'Quét Google Drive',
        onConfirm: () => {
          setConfirmState(null);
          handleFetchCloudBackups();
        },
      });
      return;
    }

    setConfirmState({
      title: 'Chuyển sang Save của tôi',
      message:
        'GameVault sẽ:\n1. Tự động sao lưu toàn bộ save hiện tại trên máy này (gán nhãn "Save chủ máy").\n2. Nạp bản save cá nhân của bạn vào game để sẵn sàng chơi.\n\nSau khi chơi xong, bạn có thể bấm "Hoàn trả Save" để trả lại nguyên vẹn file save cho chủ máy.',
      confirmLabel: 'Đổi sang Save của tôi',
      onConfirm: () =>
        run('switchMySave', async () => {
          setConfirmState(null);
          const result = await window.electronAPI.switchToMySave!(gameId);
          setSwapResult(result);
          await refresh();
        }),
    });
  };

  const handleRevertToHost = () => {
    if (isGameRunning) {
      setError('Game đang chạy! Vui lòng thoát game trước khi hoàn trả save.');
      return;
    }

    setConfirmState({
      title: 'Hoàn trả Save cho máy này (Chủ máy)',
      message:
        'GameVault sẽ:\n1. Tự động lưu lại tiến độ bạn vừa chơi (gán nhãn "Save của tôi").\n2. Phục hồi lại đúng file save gốc ban đầu của máy này.\n\nBạn có chắc chắn muốn hoàn trả save ngay bây giờ?',
      confirmLabel: 'Hoàn trả Save ngay',
      onConfirm: () =>
        run('revertHost', async () => {
          setConfirmState(null);
          const result = await window.electronAPI.revertToHostSave!(gameId);
          setSwapResult(result);
          await refresh();
        }),
    });
  };

  const handleFetchCloudBackups = () =>
    run('cloudBackups', async () => {
      const g = await window.electronAPI.getGameById(gameId);
      const title = g?.title || '';
      const cloudSlots = (await window.electronAPI.listDriveGameBackups?.(title)) || [];
      setCloudBackups(cloudSlots);
      setShowCloudModal(true);
    });

  const handleDownloadCloudBackup = (drivePath: string) =>
    run(`dlCloud-${drivePath}`, async () => {
      await window.electronAPI.downloadCloudBackup?.(gameId, drivePath);
      await refresh();
      setDriveMsg('Đã tải thành công bản save từ Google Drive vào Vault! Bạn có thể kích hoạt để chơi ngay.');
      setShowCloudModal(false);
    });

  const handleUpdateTag = (backupId: number, trigger: SaveBackupTrigger) =>
    run(`tag-${backupId}`, async () => {
      await window.electronAPI.updateSaveBackupMetadata?.(backupId, { trigger });
      setTagModalBackup(null);
      await refresh();
    });

  const handleApplyDirect = (backup: SaveBackup, asProfile?: ActiveSaveProfile) => {
    if (isGameRunning) {
      setError('Game đang chạy! Vui lòng thoát game trước khi đổi file save.');
      return;
    }
    const profileLabel = asProfile === 'my_save' ? 'Save của tôi' : asProfile === 'host' ? 'Save chủ máy' : 'Khác';
    setConfirmState({
      title: `Áp dụng bản save (${profileLabel})`,
      message: `Nạp dữ liệu từ bản backup này vào thư mục game và đặt trạng thái hoạt động thành "${profileLabel}"?\n\n${backup.slot_time.replace('_', ' ')}\n\nGameVault sẽ tự động tạo một bản sao lưu an toàn trước khi ghi đè.`,
      confirmLabel: 'Áp dụng ngay',
      onConfirm: () =>
        run(`apply-${backup.id}`, async () => {
          setConfirmState(null);
          const res = await window.electronAPI.applySaveBackup!(gameId, backup.id, asProfile);
          setSwapResult(res);
          await refresh();
        }),
    });
  };

  return (
    <div className="mt-12 space-y-4">
      {/* Section header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-amber-400" />
          <span>Lưu trữ Save</span>
          {backups.length > 0 && (
            <span className="rounded bg-[#2a2e3d] px-2 py-0.5 text-[10px] font-mono text-[#8e95a5]">
              {backups.length} bản backup
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDetect}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] transition hover:border-[#ff2a44] hover:text-white disabled:opacity-50"
            title="Tự động tìm các folder save có thể thuộc game này"
          >
            {busy === 'detect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            <span>Quét tự động</span>
          </button>
          <button
            onClick={handleSearchWeb}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] transition hover:border-sky-400 hover:text-white disabled:opacity-50"
            title="Google-style search: '<game>' save game data location — đọc path từ kết quả tìm kiếm"
          >
            {busy === 'web' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            <span>Tìm trên web</span>
          </button>
          <button
            onClick={handleAddManual}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] transition hover:border-[#ff2a44] hover:text-white disabled:opacity-50"
          >
            {busy === 'addManual' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
            <span>Thêm thủ công</span>
          </button>
          <button
            onClick={handleBackupNow}
            disabled={busy !== null || paths.filter((p) => p.enabled === 1).length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-3 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            title={paths.filter((p) => p.enabled === 1).length === 0 ? 'Cần khai báo ít nhất 1 folder save' : 'Copy toàn bộ folder save vào vault'}
          >
            {busy === 'backup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span>Backup ngay</span>
          </button>
        </div>
      </div>

      {/* Save Profile Swapper Card */}
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-[#161821] to-[#161821] p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`p-2.5 rounded-xl border ${
                profileInfo?.activeProfile === 'my_save'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : profileInfo?.activeProfile === 'host'
                  ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                  : 'bg-[#2a2e3d] border-[#373c4e] text-[#8e95a5]'
              }`}
            >
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#8e95a5] font-medium">Hồ sơ Save trên máy:</span>
                {profileInfo?.activeProfile === 'my_save' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Save của tôi (Đang kích hoạt)
                  </span>
                ) : profileInfo?.activeProfile === 'host' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    Save gốc của máy này (Chủ máy)
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#2a2e3d] text-[#8e95a5]">
                    Mặc định
                  </span>
                )}
                {isGameRunning && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <AlertCircle className="h-3 w-3" /> Game đang chạy (thoát game để đổi save)
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[#8e95a5]">
                {profileInfo?.activeProfile === 'my_save'
                  ? 'Bạn đang chơi trên dữ liệu save của bạn. Khi trả máy, hãy bấm "Hoàn trả Save" để phục hồi nguyên trạng cho chủ máy.'
                  : 'Thư mục game hiện đang chứa save nguyên bản của máy. Bấm "Chuyển sang Save của tôi" để nạp tiến độ của bạn.'}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {profileInfo?.activeProfile === 'my_save' ? (
              <button
                onClick={handleRevertToHost}
                disabled={busy !== null || isGameRunning}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 px-3.5 py-2 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
                title="Tự động sao lưu tiến độ vừa chơi và phục hồi lại save gốc của chủ máy"
              >
                {busy === 'revertHost' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                <span>Hoàn trả Save cho máy này</span>
              </button>
            ) : (
              <button
                onClick={handleSwitchToMySave}
                disabled={busy !== null || isGameRunning}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-3.5 py-2 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
                title="Tự động đóng băng lưu lại save của máy này và kích hoạt save của bạn"
              >
                {busy === 'switchMySave' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                )}
                <span>Chuyển sang Save của tôi</span>
              </button>
            )}

            <button
              onClick={handleFetchCloudBackups}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-xl border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs font-semibold text-[#8e95a5] transition hover:border-sky-400 hover:text-white disabled:opacity-50"
              title="Quét các bản save của bạn đã lưu trên Google Drive"
            >
              {busy === 'cloudBackups' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5 text-sky-400" />
              )}
              <span>Tải từ Cloud Drive</span>
            </button>
          </div>
        </div>
      </div>

      {/* Vault root row */}
      {vault && (
        <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <HardDrive className="h-3.5 w-3.5 text-[#8e95a5]" />
                <span>Nơi lưu vault</span>
                {vault.markerFound ? (
                  <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Đã nhận diện
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                    <AlertCircle className="h-3 w-3" /> {vault.isDirectory ? 'Chưa có backup nào' : 'Folder chưa tồn tại'}
                  </span>
                )}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-[#8e95a5]" title={vault.root}>
                {vault.root}
              </div>
            </div>
            <button
              onClick={handleChangeVaultRoot}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] transition hover:border-[#ff2a44] hover:text-white disabled:opacity-50"
            >
              {busy === 'vaultRoot' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span>Đổi nơi lưu</span>
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#8e95a5]/80">
            Mẹo: trỏ vault vào folder được Google Drive / OneDrive đồng bộ để save tự động lên cloud. Cài lại app sẽ tự nhận lại vault cũ qua file đánh dấu trong Documents.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {driveMsg && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs text-sky-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-wrap">{driveMsg}</span>
        </div>
      )}

      {/* Configured save folders */}
      <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] p-4">
        <div className="mb-2 text-xs font-semibold text-[#8e95a5]">Folder save đã khai báo ({paths.length})</div>
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-[#8e95a5]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải...
          </div>
        ) : paths.length === 0 ? (
          <p className="py-2 text-xs text-[#8e95a5]/70">
            Chưa khai báo folder nào. Bấm <span className="font-semibold text-white">Quét tự động</span> để tool tìm hộ các vị trí save thường gặp (Documents\My Games, AppData, LocalLow, folder cài game...), hoặc chọn folder bằng <span className="font-semibold text-white">Thêm thủ công</span>.
          </p>
        ) : (
          <div className="space-y-2">
            {paths.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[#0e1015] px-3 py-2 border border-[#2a2e3d]/50"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    onClick={() => handleTogglePath(p)}
                    disabled={busy !== null}
                    title={p.enabled === 1 ? 'Đang backup — bấm để tạm tắt' : 'Đã tắt — bấm để bật lại'}
                    className={`h-4 w-8 shrink-0 rounded-full transition ${p.enabled === 1 ? 'bg-[#ff2a44]' : 'bg-[#2a2e3d]'}`}
                  >
                    <span
                      className={`block h-3 w-3 translate-y-0.5 rounded-full bg-white transition-transform ${p.enabled === 1 ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                  </button>
                  <span className="truncate font-mono text-[11px] text-[#f1f3f7]" title={p.source_path}>
                    {p.source_path}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => handleRemovePath(p)}
                    disabled={busy !== null}
                    className="rounded-lg p-1.5 text-[#8e95a5] transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                    title="Bỏ khai báo folder này"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detection candidates */}
        {candidates !== null && (
          <div className="mt-3 rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Kết quả quét ({candidates.length} vị trí nghi vấn)
              </span>
              <button
                onClick={() => setCandidates(null)}
                className="rounded p-1 text-[#8e95a5] hover:text-white"
                title="Đóng"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {candidates.length === 0 ? (
              <p className="py-2 text-xs text-[#8e95a5]/70">
                Không tìm thấy folder nào khớp với tên game. Thử <span className="font-semibold text-white">Thêm thủ công</span> — nhiều game lưu save ở vị trí riêng.
              </p>
            ) : (
              <>
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {candidates.map((c) => {
                    const meta = CONFIDENCE_META[c.confidence] || CONFIDENCE_META.low;
                    const checked = selectedCandidates.has(c.path);
                    return (
                      <label
                        key={c.path}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-[#161821] px-3 py-2 border border-[#2a2e3d]/50 hover:border-[#ff2a44]/50"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = new Set(selectedCandidates);
                              if (checked) next.delete(c.path);
                              else next.add(c.path);
                              setSelectedCandidates(next);
                            }}
                            className="h-3.5 w-3.5 accent-[#ff2a44]"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[11px] text-[#f1f3f7]" title={c.path}>
                              {c.path}
                            </div>
                            <div className="text-[10px] text-[#8e95a5]">
                              {c.fileCount} file · {formatBytes(c.sizeBytes)}
                            </div>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${meta.className}`}>
                          {meta.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleAddSelected}
                    disabled={busy !== null || selectedCandidates.size === 0}
                    className="rounded-lg bg-[#ff2a44] px-4 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === 'addSelected' ? 'Đang thêm...' : `Thêm ${selectedCandidates.size} folder đã chọn`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Web search candidates */}
        {webCandidates !== null && (
          <div className="mt-3 rounded-xl border border-sky-500/30 bg-[#0e1015] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Globe className="h-3.5 w-3.5 text-sky-400" />
                Kết quả từ web ({webCandidates.filter((c) => c.selectable).length} vị trí khả dụng)
              </span>
              <button
                onClick={() => setWebCandidates(null)}
                className="rounded p-1 text-[#8e95a5] hover:text-white"
                title="Đóng"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {webQuery && (
              <p className="mb-2 truncate font-mono text-[10px] text-[#8e95a5]/70" title={webQuery}>
                🔎 {webQuery}
              </p>
            )}
            {webCandidates.length === 0 ? (
              <p className="py-2 text-xs text-[#8e95a5]/70">
                Web không chỉ ra path nào cho game này. Thử <span className="font-semibold text-white">Thêm thủ công</span> hoặc xem hướng dẫn riêng của game.
              </p>
            ) : (
              <>
                <div className="max-h-52 space-y-1.5 overflow-y-auto">
                  {webCandidates.map((c, i) => {
                    const checked = webSelected.has(c.resolvedPath);
                    const isHint = !c.selectable;
                    return (
                      <label
                        key={`${c.resolvedPath}-${i}`}
                        className={`flex items-center justify-between gap-2 rounded-lg bg-[#161821] px-3 py-2 border border-[#2a2e3d]/50 ${isHint ? 'opacity-60' : 'cursor-pointer hover:border-sky-400/50'}`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isHint}
                            onChange={() => {
                              const next = new Set(webSelected);
                              if (checked) next.delete(c.resolvedPath);
                              else next.add(c.resolvedPath);
                              setWebSelected(next);
                            }}
                            className="h-3.5 w-3.5 accent-sky-400"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[11px] text-[#f1f3f7]" title={c.resolvedPath}>
                              {c.resolvedPath}
                            </div>
                            {c.rawPath !== c.resolvedPath && (
                              <div className="truncate text-[10px] text-[#8e95a5]" title={c.rawPath}>
                                ghi trên web: {c.rawPath}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {c.exists ? (
                            <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Có trên máy
                            </span>
                          ) : (
                            <span className="rounded border border-[#2a2e3d] bg-[#2a2e3d] px-1.5 py-0.5 text-[10px] text-[#8e95a5]">
                              Chưa có
                            </span>
                          )}
                          <span className="max-w-32 truncate rounded bg-[#2a2e3d] px-1.5 py-0.5 text-[10px] text-[#8e95a5]" title={c.url}>
                            {c.source}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleAddWebSelected}
                    disabled={busy !== null || webSelected.size === 0}
                    className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === 'addWebSelected' ? 'Đang thêm...' : `Thêm ${webSelected.size} folder đã chọn`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Last backup result */}
      {lastBackupResult && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Backup thành công — {lastBackupResult.slotTime.replace('_', ' ')}
          </div>
          <div className="mt-1 text-[11px] text-[#8e95a5]">
            {lastBackupResult.totalFiles} file · {formatBytes(lastBackupResult.totalBytes)} · lưu tại{' '}
            <span className="font-mono">{lastBackupResult.backupDir}</span>
          </div>
          {lastBackupResult.sources.some((s) => s.status !== 'copied') && (
            <ul className="mt-2 space-y-1 text-[10px] text-amber-400/90">
              {lastBackupResult.sources
                .filter((s) => s.status !== 'copied')
                .map((s, i) => (
                  <li key={i}>
                    ⚠ {s.sourcePath} — {s.status === 'skipped_missing' ? 'folder không tồn tại' : s.status === 'skipped_empty' ? 'folder trống' : `lỗi: ${s.error}`}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* Backup history */}
      <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] p-4">
        <div className="mb-2 text-xs font-semibold text-[#8e95a5]">Lịch sử backup ({backups.length})</div>
        {backups.length === 0 ? (
          <p className="py-2 text-xs text-[#8e95a5]/70">
            Chưa có bản backup nào. Bấm <span className="font-semibold text-white">Backup ngay</span> để lưu trạng thái save hiện tại — xóa game xong vẫn có thể phục hồi.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {backups.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[#0e1015] px-3 py-2.5 border border-[#2a2e3d]/50 hover:border-[#373c4e] transition"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 font-mono text-xs text-[#f1f3f7]">
                    {b.slot_time.replace('_', ' ')}
                  </span>
                  <span
                    className={`shrink-0 rounded border px-2 py-0.5 text-[10px] ${
                      TRIGGER_STYLE[b.trigger] || 'border-[#2a2e3d] bg-[#2a2e3d] text-[#8e95a5]'
                    }`}
                  >
                    {TRIGGER_LABEL[b.trigger] || b.trigger}
                  </span>
                  {b.id === profileInfo?.hostBackupId && (
                    <span className="shrink-0 rounded border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-bold text-indigo-400" title="Bản snapshot gốc của máy này">
                      Gốc máy
                    </span>
                  )}
                  {b.id === profileInfo?.myBackupId && (
                    <span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400" title="Bản save của tôi được nạp lần gần nhất">
                      Của tôi
                    </span>
                  )}
                  {b.note && (
                    <span className="truncate text-[10px] text-[#8e95a5]/80" title={b.note}>
                      {b.note}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="mr-1 font-mono text-[10px] text-[#8e95a5]">
                    {b.file_count} file · {formatBytes(b.size_bytes)}
                  </span>

                  {/* Quick Apply into Game */}
                  <button
                    onClick={() => handleApplyDirect(b, b.trigger === 'host_snapshot' ? 'host' : 'my_save')}
                    disabled={busy !== null || isGameRunning}
                    className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-40"
                    title="Nạp bản save này vào game ngay lập tức"
                  >
                    {busy === `apply-${b.id}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowLeftRight className="h-3 w-3" />
                    )}
                    <span>Kích hoạt</span>
                  </button>

                  {/* Change Tag */}
                  <button
                    onClick={() => setTagModalBackup(b)}
                    disabled={busy !== null}
                    className="rounded-lg p-1.5 text-[#8e95a5] transition hover:bg-[#2a2e3d] hover:text-white disabled:opacity-50"
                    title="Đổi nhãn phân loại (Save của tôi / Save chủ máy / Thủ công)"
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </button>

                  {/* Upload to Drive */}
                  <button
                    onClick={() => handleUploadToDrive(b)}
                    disabled={busy !== null}
                    className="rounded-lg p-1.5 text-[#8e95a5] transition hover:bg-sky-500/10 hover:text-sky-400 disabled:opacity-50"
                    title="Upload bản backup này lên Google Drive của bạn (cần đăng nhập)"
                  >
                    {busy === `drive-${b.id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <HardDriveUpload className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {/* Open Folder */}
                  <button
                    onClick={() => window.electronAPI.openSaveBackupFolder(b.id)}
                    className="rounded-lg p-1.5 text-[#8e95a5] transition hover:bg-[#2a2e3d] hover:text-white"
                    title="Mở folder backup trên máy"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>

                  {/* Restore */}
                  <button
                    onClick={() => setRestoreTarget(b)}
                    disabled={busy !== null}
                    className="flex items-center gap-1 rounded-lg border border-[#2a2e3d] px-2 py-1 text-[11px] font-semibold text-[#8e95a5] transition hover:border-[#8e95a5] hover:text-white disabled:opacity-50"
                    title="Phục hồi các folder save về trạng thái của bản backup này"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Phục hồi</span>
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDeleteBackup(b)}
                    disabled={busy !== null}
                    className="rounded-lg p-1.5 text-[#8e95a5] transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                    title="Xóa bản backup khỏi vault"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tag Edit Modal */}
      {tagModalBackup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-[#2a2e3d] bg-[#161821] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Tag className="h-4 w-4 text-amber-400" />
                <span>Đổi nhãn phân loại Save</span>
              </h3>
              <button
                onClick={() => setTagModalBackup(null)}
                className="rounded-lg p-1 text-[#8e95a5] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-[#8e95a5]">
              Chọn vai trò cho bản backup: <span className="font-mono text-white">{tagModalBackup.slot_time.replace('_', ' ')}</span>
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleUpdateTag(tagModalBackup.id, 'my_save')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition"
              >
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>Save của tôi (My Profile)</span>
                </div>
                {tagModalBackup.trigger === 'my_save' && <Check className="h-4 w-4" />}
              </button>
              <button
                onClick={() => handleUpdateTag(tagModalBackup.id, 'host_snapshot')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-xs font-semibold transition"
              >
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4" />
                  <span>Save chủ máy (Host Profile)</span>
                </div>
                {tagModalBackup.trigger === 'host_snapshot' && <Check className="h-4 w-4" />}
              </button>
              <button
                onClick={() => handleUpdateTag(tagModalBackup.id, 'manual')}
                className="w-full flex items-center justify-between p-2.5 rounded-xl border border-[#2a2e3d] bg-[#0e1015] text-[#8e95a5] hover:text-white text-xs font-medium transition"
              >
                <span>Sao lưu thủ công thông thường</span>
                {tagModalBackup.trigger === 'manual' && <Check className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cloud Drive Backups Modal */}
      {showCloudModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CloudDownload className="h-5 w-5 text-sky-400" />
                <span>Bản save trên Google Drive</span>
              </h3>
              <button
                onClick={() => setShowCloudModal(false)}
                className="rounded-lg p-1 text-[#8e95a5] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-[#8e95a5]">
              Danh sách các bản save đã đồng bộ trên Google Drive cá nhân của bạn. Bấm tải về để nạp vào Vault của máy này:
            </p>
            {cloudBackups === null || busy === 'cloudBackups' ? (
              <div className="flex items-center justify-center py-8 text-xs text-[#8e95a5] gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                <span>Đang quét Google Drive...</span>
              </div>
            ) : cloudBackups.length === 0 ? (
              <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-6 text-center text-xs text-[#8e95a5]">
                Chưa có bản save nào của game này trên Google Drive. Bạn có thể bấm nút Upload ở các bản backup cục bộ để tải lên Cloud.
              </div>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {cloudBackups.map((cb) => (
                  <div
                    key={cb.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-[#2a2e3d] bg-[#0e1015]"
                  >
                    <div>
                      <div className="font-mono text-xs font-semibold text-white">
                        {cb.slotTime.replace('_', ' ')}
                      </div>
                      <div className="font-mono text-[10px] text-[#8e95a5] truncate max-w-xs" title={cb.drivePath}>
                        {cb.drivePath}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownloadCloudBackup(cb.drivePath)}
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110 disabled:opacity-50"
                    >
                      {busy === `dlCloud-${cb.drivePath}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CloudDownload className="h-3.5 w-3.5" />
                      )}
                      <span>Tải về Vault</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowCloudModal(false)}
                className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-4 py-1.5 text-xs font-semibold text-[#8e95a5] hover:text-white"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Swap Profile Result Modal */}
      {swapResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <span>
                {swapResult.targetProfile === 'my_save'
                  ? 'Đã chuyển sang Save của tôi!'
                  : swapResult.targetProfile === 'host'
                  ? 'Đã hoàn trả Save cho chủ máy!'
                  : 'Đã kích hoạt save thành công!'}
              </span>
            </h3>
            <p className="text-xs text-[#8e95a5] leading-relaxed">
              {swapResult.targetProfile === 'my_save'
                ? 'GameVault đã snapshot an toàn save của máy này và nạp bản save cá nhân của bạn vào game. Bạn có thể mở game lên và tiếp tục hành trình!'
                : swapResult.targetProfile === 'host'
                ? 'GameVault đã lưu lại tiến độ bạn vừa chơi và phục hồi lại đúng file save gốc ban đầu của chủ máy. Máy đã sẵn sàng trả lại cho chủ!'
                : 'Dữ liệu save đã được nạp thành công vào game.'}
            </p>
            <div className="space-y-1 rounded-xl bg-[#0e1015] p-3 text-xs">
              <div className="font-semibold text-white text-[11px] mb-1">Chi tiết phục hồi:</div>
              {swapResult.restored.map((r, i) => (
                <div key={i} className="truncate font-mono text-[10px] text-emerald-400" title={r.sourcePath}>
                  ✓ {r.sourcePath} ({r.files} file)
                </div>
              ))}
              {swapResult.safetyBackupId !== null && (
                <div className="pt-1 text-[10px] text-[#8e95a5]">
                  ✓ Đã tạo snapshot an toàn (ID #{swapResult.safetyBackupId})
                </div>
              )}
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={() => setSwapResult(null)}
                className="rounded-lg bg-emerald-600 px-5 py-1.5 text-xs font-bold text-white shadow hover:brightness-110"
              >
                Tuyệt vời
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore confirmation modal */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-emerald-400" />
              <span>Phục hồi save</span>
            </h3>
            <p className="text-xs leading-relaxed text-[#8e95a5]">
              Copy dữ liệu từ bản backup <span className="font-mono text-white">{restoreTarget.slot_time.replace('_', ' ')}</span> về
              các folder save đã ghi trong manifest. Trước khi ghi đè, GameVault <span className="font-semibold text-white">tự backup an toàn</span> trạng thái save hiện tại — luôn có thể hoàn tác.
            </p>
            <div className="rounded-xl bg-[#0e1015] px-3 py-2 font-mono text-[10px] text-[#8e95a5] break-all">
              {restoreTarget.backup_dir}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setRestoreTarget(null)}
                className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] hover:text-white"
              >
                Hủy
              </button>
              <button
                onClick={handleRestoreConfirm}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
              >
                {busy === 'restore' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Phục hồi ngay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore result modal */}
      {restoreResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              {restoreResult.errors.length === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-400" />
              )}
              <span>{restoreResult.errors.length === 0 ? 'Phục hồi thành công' : 'Phục hồi hoàn tất (có cảnh báo)'}</span>
            </h3>
            <ul className="space-y-1 text-xs text-[#8e95a5]">
              {restoreResult.restored.map((r, i) => (
                <li key={i} className="truncate font-mono text-[11px] text-emerald-400/90" title={r.sourcePath}>
                  ✓ {r.sourcePath} ({r.files} file)
                </li>
              ))}
              {restoreResult.errors.map((e, i) => (
                <li key={`e${i}`} className="text-amber-400/90">⚠ {e}</li>
              ))}
            </ul>
            {restoreResult.safetyBackupId !== null && (
              <p className="text-[10px] text-[#8e95a5]/80">
                Đã tạo backup an toàn của save hiện tại trước khi phục hồi (xem trong lịch sử với nhãn "An toàn tự động").
              </p>
            )}
            <div className="flex justify-end pt-1">
              <button
                onClick={() => setRestoreResult(null)}
                className="rounded-lg bg-[#ff2a44] px-4 py-1.5 text-xs font-bold text-white shadow hover:brightness-110"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generic confirm modal */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-400" />
              <span>{confirmState.title}</span>
            </h3>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#8e95a5]">{confirmState.message}</p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmState(null)}
                className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] hover:text-white"
              >
                Hủy
              </button>
              <button
                onClick={confirmState.onConfirm}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-4 py-1.5 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
              >
                {busy !== null && busy.startsWith('delete') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
