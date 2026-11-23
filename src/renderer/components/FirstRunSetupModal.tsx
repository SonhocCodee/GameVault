import React, { useState, useEffect } from 'react';
import { FolderOpen, Camera, Layers, Gamepad2, HardDrive, Info, Zap } from 'lucide-react';

export interface FirstRunSetupModalProps {
  mediaBaseDir: string;
  screenshotsDir: string;
  vaultRoot: string;
  hddMode: boolean;
  onHddModeChange: (enabled: boolean) => void;
  onFieldChange: (field: 'media' | 'screenshots' | 'vault', value: string) => void;
  onBrowseFolder: (field: 'media' | 'screenshots' | 'vault') => Promise<void>;
  onComplete: () => Promise<void>;
}

/**
 * One-time setup wizard shown on the very first app launch: the user picks
 * the drive/folder where game screenshots & videos are stored (plus HDD Mode toggle,
 * screenshot source + save-vault folders). Everything stays changeable later
 * in Settings → "Thư viện & Lưu trữ".
 */
export const FirstRunSetupModal: React.FC<FirstRunSetupModalProps> = ({
  mediaBaseDir,
  screenshotsDir,
  vaultRoot,
  hddMode,
  onHddModeChange,
  onFieldChange,
  onBrowseFolder,
  onComplete,
}) => {
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [gdriveDetected, setGdriveDetected] = useState<{ drive: string; path: string } | null>(null);

  useEffect(() => {
    if (window.electronAPI?.detectGoogleDriveDesktop) {
      window.electronAPI
        .detectGoogleDriveDesktop()
        .then((res) => {
          if (res?.suggestedMediaDir) {
            setGdriveDetected({ drive: res.mountedDrive || 'Drive', path: res.suggestedMediaDir });
          }
        })
        .catch(() => {});
    }
  }, []);

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-[#2a2e3d] bg-[#0e1015] p-6 shadow-2xl shadow-black/60 my-auto">
        {/* Header */}
        <div className="mb-2 flex items-center gap-3">
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

        {/* Quick Google Drive Recommendation if Detected */}
        {gdriveDetected && mediaBaseDir !== gdriveDetected.path && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-300">
              <Zap className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>Phát hiện ổ <strong>Google Drive ({gdriveDetected.drive})</strong>! Bạn có thể lưu thẳng ảnh vào đây để tự động đồng bộ lên mây.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                onFieldChange('media', gdriveDetected.path);
                onHddModeChange(false);
              }}
              className="shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-white transition-colors"
            >
              Dùng ổ Google Drive
            </button>
          </div>
        )}

        {/* HDD Mode Toggle Card & Notice */}
        <div className="mt-4 rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-3">
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
              onClick={() => onHddModeChange(!hddMode)}
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

          {/* Advice / Notice Box */}
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

        {/* Fields */}
        <div className="mt-4 space-y-3.5">
          {fieldCard(
            <Gamepad2 className="h-4 w-4 text-[#ff2a44]" />,
            'Thư mục lưu ảnh & video game (ổ đích):',
            <>Mặc định <code className="text-white">E:\Game</code> — ảnh chụp/video sẽ tự phân loại theo từng folder game ở đây.</>,
            mediaBaseDir,
            'media'
          )}
          {hddMode &&
            fieldCard(
              <Camera className="h-4 w-4 text-amber-400" />,
              'Thư mục chụp màn hình nguồn (lưu tạm):',
              <>Mặc định <code className="text-white">Pictures\Screenshots</code> — nơi ảnh chụp sinh ra tạm thời trên ổ nhanh trước khi chuyển vào HDD.</>,
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
        <div className="mt-5 flex items-center justify-between pt-2 border-t border-[#2a2e3d]/60">
          <p className="text-[11px] text-[#8e95a5]">
            Mọi cấu hình trên đều có thể thay đổi lại bất cứ lúc nào trong Cài đặt.
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
