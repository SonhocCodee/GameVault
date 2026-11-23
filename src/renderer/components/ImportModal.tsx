import React, { useState } from 'react';
import {
  X,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  HardDrive,
  Gamepad2,
  History,
  FolderOpen
} from 'lucide-react';
import type { AMDImportSummary } from '../../shared/types.js';

export interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const DEFAULT_AMD_PATH = 'C:\\Users\\MacPro\\AppData\\Local\\AMD\\CN\\RGStats.db';

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [dbPath, setDbPath] = useState<string>(DEFAULT_AMD_PATH);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<AMDImportSummary | null>(null);

  if (!isOpen) return null;

  const handleImport = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSummary(null);

    try {
      if (window.electronAPI?.importAMDDatabase) {
        const res = await window.electronAPI.importAMDDatabase(dbPath.trim() || undefined);
        setSummary(res);
        onSuccess();
      } else {
        throw new Error('API Electron không khả dụng.');
      }
    } catch (err: any) {
      console.error('AMD Import error:', err);
      setErrorMsg(err?.message || 'Không thể đọc hoặc import cơ sở dữ liệu AMD RGStats.db');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl rounded-2xl border border-[#2a2e3d] bg-[#161821] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] px-6 py-4 bg-[#0e1015]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff2a44]/20 border border-[#ff2a44]/40">
              <Download className="h-5 w-5 text-[#ff2a44]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">1-Click Import từ AMD Adrenalin</h2>
              <p className="text-xs text-[#8e95a5]">
                Đồng bộ hóa danh sách game &amp; lịch sử phiên chơi từ RGStats.db
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
        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {summary ? (
            /* Successful Import Summary View */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="h-5 w-5" />
                <span>Import thành công vào cơ sở dữ liệu GameVault!</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 text-center">
                  <Gamepad2 className="h-6 w-6 text-[#ff2a44] mx-auto mb-1" />
                  <div className="text-2xl font-black text-white">{summary.importedGames}</div>
                  <div className="text-xs text-[#8e95a5]">Trò chơi đã nạp / cập nhật</div>
                </div>

                <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 text-center">
                  <History className="h-6 w-6 text-amber-400 mx-auto mb-1" />
                  <div className="text-2xl font-black text-white">{summary.importedSessions}</div>
                  <div className="text-xs text-[#8e95a5]">Phiên chơi (Sessions) lịch sử</div>
                </div>
              </div>

              <p className="text-xs text-[#8e95a5] italic">
                Tất cả thời gian chơi và phiên chơi đã được đồng bộ vĩnh viễn vào SQLite. Dữ liệu này sẽ làm mốc để tự động khớp ảnh chụp màn hình F6.
              </p>
            </div>
          ) : (
            /* Path & Execution Form */
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#8e95a5] mb-1.5">
                  Đường dẫn tệp cơ sở dữ liệu AMD RGStats.db:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={dbPath}
                    onChange={(e) => setDbPath(e.target.value)}
                    className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3.5 py-2 text-xs font-mono text-[#f1f3f7] placeholder-[#8e95a5] outline-none focus:border-[#ff2a44]"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-[#8e95a5]">
                  Mặc định: <code className="text-[#ff2a44]">C:\Users\MacPro\AppData\Local\AMD\CN\RGStats.db</code>
                </p>
              </div>

              <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 text-xs text-[#8e95a5] space-y-2">
                <div className="flex items-center gap-2 font-bold text-[#f1f3f7]">
                  <HardDrive className="h-4 w-4 text-[#ff2a44]" />
                  <span>Cơ chế bảo toàn tính toàn vẹn:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Không ghi đè hoặc làm hỏng database gốc của AMD Adrenalin.</li>
                  <li>Hỗ trợ tính Idempotency (chạy nhiều lần không gây trùng lặp dữ liệu).</li>
                  <li>Tự động chuẩn hóa tên hiển thị game từ file thực thi .exe.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#2a2e3d] px-6 py-4 bg-[#0e1015]">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#2a2e3d] bg-[#161821] px-4 py-2 text-xs font-semibold text-[#f1f3f7] hover:bg-[#1f2230] transition-colors"
          >
            {summary ? 'Hoàn tất' : 'Hủy'}
          </button>

          {!summary && (
            <button
              onClick={handleImport}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#ff2a44] to-[#e02424] px-5 py-2 text-xs font-bold text-white shadow-lg shadow-[#ff2a44]/30 hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span>{loading ? 'Đang đọc RGStats.db...' : 'Bắt đầu 1-Click Import'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
