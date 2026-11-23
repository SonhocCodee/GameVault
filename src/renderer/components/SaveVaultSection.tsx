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
} from 'lucide-react';
import type {
  SaveBackup,
  SaveLocationCandidate,
  SavePathConfig,
  SavesListResult,
  SaveBackupResult,
  SaveRestoreResult,
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
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {backups.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[#0e1015] px-3 py-2 border border-[#2a2e3d]/50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 font-mono text-xs text-[#f1f3f7]">
                    {b.slot_time.replace('_', ' ')}
                  </span>
                  <span className="shrink-0 rounded bg-[#2a2e3d] px-2 py-0.5 text-[10px] text-[#8e95a5]">
                    {TRIGGER_LABEL[b.trigger] || b.trigger}
                  </span>
                  {b.note && (
                    <span className="truncate text-[10px] text-[#8e95a5]/80" title={b.note}>
                      {b.note}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[10px] text-[#8e95a5]">
                    {b.file_count} file · {formatBytes(b.size_bytes)}
                  </span>
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
                  <button
                    onClick={() => window.electronAPI.openSaveBackupFolder(b.id)}
                    className="rounded-lg p-1.5 text-[#8e95a5] transition hover:bg-[#2a2e3d] hover:text-white"
                    title="Mở folder backup"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setRestoreTarget(b)}
                    disabled={busy !== null}
                    className="flex items-center gap-1 rounded-lg border border-[#2a2e3d] px-2.5 py-1 text-[11px] font-semibold text-[#8e95a5] transition hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-50"
                    title="Phục hồi các folder save về trạng thái của bản backup này"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Phục hồi
                  </button>
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
