import React, { useState, useEffect } from 'react';
import {
  X,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderSync,
  FileImage,
  ArrowRight,
  HardDrive
} from 'lucide-react';
import type { ScreenshotSyncSummary, Game } from '../../shared/types.js';

export interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [assigning, setAssigning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<ScreenshotSyncSummary | null>(null);
  const [gamesList, setGamesList] = useState<Game[]>([]);
  const [selectedTargetGameId, setSelectedTargetGameId] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && window.electronAPI?.getGames) {
      window.electronAPI.getGames().then((games) => {
        setGamesList(games || []);
      }).catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSync = async (isDryRun: boolean) => {
    setLoading(true);
    setErrorMsg(null);
    setSummary(null);

    try {
      if (window.electronAPI?.syncScreenshots) {
        const res = await window.electronAPI.syncScreenshots({ dryRun: isDryRun });
        setSummary(res);
        if (!isDryRun && res.moved > 0) {
          onSuccess();
        }
      } else {
        throw new Error('API Electron không khả dụng.');
      }
    } catch (err: any) {
      console.error('Screenshot sync error:', err);
      setErrorMsg(err?.message || 'Không thể quét hoặc đồng bộ ảnh chụp màn hình');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignUnmatched = async () => {
    if (!selectedTargetGameId || !summary?.unmatched || summary.unmatched.length === 0) return;
    setAssigning(true);
    setErrorMsg(null);

    try {
      if (window.electronAPI?.syncScreenshots) {
        const res = await window.electronAPI.syncScreenshots({
          dryRun: false,
          targetGameId: selectedTargetGameId,
          unmatchedFiles: summary.unmatched.map((u) => u.file),
        });
        setSummary(res);
        onSuccess();
      }
    } catch (err: any) {
      console.error('Failed to assign unmatched screenshots:', err);
      setErrorMsg(err?.message || 'Không thể gán ảnh vào game đã chọn');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-[#2a2e3d] bg-[#161821] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] px-6 py-4 bg-[#0e1015]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40">
              <Zap className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Đồng bộ ảnh chụp F6 vào E:\Game</h2>
              <p className="text-xs text-[#8e95a5]">
                Quét Pictures\Screenshots và tự động ghép vào thư mục game theo mốc thời gian
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
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

          {/* Sync Result Summary */}
          {summary ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="h-5 w-5" />
                <span>
                  {dryRun
                    ? `Kết quả quét thử nghiệm: Khớp ${summary.matched} ảnh.`
                    : `Đồng bộ thành công! Đã chuyển ${summary.moved} ảnh vào E:\\Game.`}
                </span>
              </div>

              {/* Matched Details List */}
              {summary.details && summary.details.length > 0 ? (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-3 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#8e95a5] px-1">
                    Danh sách tệp tin được khớp:
                  </div>
                  {summary.details.map((d, index) => (
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
                <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-6 text-center text-xs text-[#8e95a5]">
                  Không có ảnh chụp F6 mới nào trùng khớp với thời gian phiên chơi hiện tại.
                </div>
              )}

              {/* Unmatched Screenshots Recovery Section */}
              {summary.unmatched && summary.unmatched.length > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>Phát hiện {summary.unmatched.length} ảnh chụp F6 chưa khớp phiên chơi tự động</span>
                  </div>
                  <p className="text-[11px] text-[#8e95a5]">
                    Các ảnh này được chụp lúc AMD hoặc GameVault chưa kịp ghi nhận phiên chơi. Bạn có thể chọn game để gom ngay toàn bộ vào thư mục game đó:
                  </p>
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
                          <span>Đang chuyển...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />
                          <span>Gán vào game này ({summary.unmatched.length} ảnh)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Intro / Explanatory card */
            <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-5 text-xs text-[#8e95a5] space-y-3">
              <div className="flex items-center gap-2 font-bold text-[#f1f3f7]">
                <HardDrive className="h-4 w-4 text-amber-400" />
                <span>Quy trình hoạt động thông minh:</span>
              </div>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  Quét toàn bộ thư mục <code className="text-[#ff2a44]">Pictures\Screenshots</code> tìm ảnh chụp phím F6.
                </li>
                <li>
                  Trích xuất dấu mốc thời gian chụp ảnh và đối chiếu với lịch sử phiên chơi (session history).
                </li>
                <li>
                  Tự động di chuyển an toàn cross-drive sang thư mục <code className="text-[#ff2a44]">E:\Game\&lt;Tên_Game&gt;</code> tương ứng.
                </li>
                <li>
                  Tự động chống trùng tên file bằng hậu tố số thứ tự (ví dụ: <code className="text-amber-400">_1.png</code>).
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#2a2e3d] px-6 py-4 bg-[#0e1015]">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#2a2e3d] bg-[#161821] px-4 py-2 text-xs font-semibold text-[#f1f3f7] hover:bg-[#1f2230] transition-colors"
          >
            {summary ? 'Đóng' : 'Hủy'}
          </button>

          <button
            onClick={() => handleSync(dryRun)}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-[#ff2a44] px-5 py-2 text-xs font-bold text-white shadow-lg shadow-amber-500/25 hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            <span>
              {loading
                ? 'Đang phân tích mốc thời gian...'
                : dryRun
                ? 'Chạy thử nghiệm (Xem trước)'
                : 'Bắt đầu Đồng bộ ảnh ngay'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
