import React, { useState } from 'react';
import { FolderOpen, Camera, Layers, Gamepad2, HardDrive } from 'lucide-react';

export interface FirstRunSetupModalProps {
  mediaBaseDir: string;
  screenshotsDir: string;
  vaultRoot: string;
  onFieldChange: (field: 'media' | 'screenshots' | 'vault', value: string) => void;
  onBrowseFolder: (field: 'media' | 'screenshots' | 'vault') => Promise<void>;
  onComplete: () => Promise<void>;
}

/**
 * One-time setup wizard shown on the very first app launch: the user picks
 * the drive/folder where game screenshots & videos are stored (plus the
 * screenshot source + save-vault folders). Everything stays changeable later
 * in Settings → "Thư viện & Lưu trữ".
 */
export const FirstRunSetupModal: React.FC<FirstRunSetupModalProps> = ({
  mediaBaseDir,
  screenshotsDir,
  vaultRoot,
  onFieldChange,
  onBrowseFolder,
  onComplete,
}) => {
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (!mediaBaseDir.trim()) {
      setError('Vui lòng chọn thư mục lưu ảnh/video cho game.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onComplete();
    } catch (err: any) {
      setError(`Lỗi lưu cài đặt: ${err?.message || 'Không xác định'}`);
      setSaving(false);
    }
  };

  const fieldCard = (
    icon: React.ReactNode,
    label: string,
    hint: React.ReactNode,
    value: string,
    field: 'media' | 'screenshots' | 'vault'
  ) => (
    <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-bold text-white flex items-center gap-1.5">
            {icon}
            <span>{label}</span>
          </label>
          <p className="text-[11px] text-[#8e95a5]">{hint}</p>
        </div>
        <button
          onClick={() => onBrowseFolder(field)}
          className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/10 hover:text-[#ff2a44]"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>Duyệt thư mục...</span>
        </button>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onFieldChange(field, e.target.value)}
        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#ff2a44]"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-[#2a2e3d] bg-[#0e1015] p-6 shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="mb-1 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#ff2a44]/40 bg-[#ff2a44]/10">
            <HardDrive className="h-5 w-5 text-[#ff2a44]" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Chào mừng đến GameVault!</h2>
            <p className="text-xs text-[#8e95a5]">
              Chọn nơi lưu trữ ảnh/video game trước khi bắt đầu — có thể đổi lại bất cứ lúc nào trong Cài đặt → Thư viện &amp; Lưu trữ.
            </p>
          </div>
        </div>

        {/* Fields */}
        <div className="mt-5 space-y-4">
          {fieldCard(
            <Gamepad2 className="h-4 w-4 text-[#ff2a44]" />,
            'Thư mục lưu ảnh & video game:',
            <>Mặc định <code className="text-white">E:\Game</code> — ảnh chụp/video sẽ tự phân loại theo từng folder game ở đây.</>,
            mediaBaseDir,
            'media'
          )}
          {fieldCard(
            <Camera className="h-4 w-4 text-amber-400" />,
            'Thư mục chụp màn hình nguồn:',
            <>Mặc định <code className="text-white">Pictures\Screenshots</code> — nơi ảnh chụp sinh ra trước khi chuyển vào thư mục game.</>,
            screenshotsDir,
            'screenshots'
          )}
          {fieldCard(
            <Layers className="h-4 w-4 text-emerald-400" />,
            'Thư mục Save Vault (sao lưu save game):',
            <>Mặc định <code className="text-white">E:\Game\SaveVault</code> — nơi lưu các bản backup save game vĩnh viễn.</>,
            vaultRoot,
            'vault'
          )}
        </div>

        {error && <p className="mt-3 text-xs font-semibold text-[#ff2a44]">{error}</p>}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between">
          <p className="text-[11px] text-[#8e95a5]">
            Watchdog đếm giờ chơi đã sẵn sàng chạy ngầm — giờ chơi vẫn được ghi cả khi app tắt.
          </p>
          <button
            onClick={handleStart}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-[#ff2a44] px-6 py-2.5 text-sm font-black text-white shadow-lg shadow-[#ff2a44]/30 transition hover:bg-[#ff2a44]/90 disabled:opacity-60"
          >
            {saving ? 'Đang lưu...' : 'Bắt đầu'}
          </button>
        </div>
      </div>
    </div>
  );
};
