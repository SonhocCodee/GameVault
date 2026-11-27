import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Camera,
  Layers,
  Gamepad2,
  HardDrive,
  Info,
  Zap,
  LogIn,
  ShieldCheck,
  Keyboard,
  Power,
  CheckCircle2,
} from 'lucide-react';

const HOTKEY_CHOICES = ['F6', 'F8', 'F9', 'F10', 'F11', 'F12', 'PrintScreen'] as const;

export interface FirstRunSetupModalProps {
  loggedIn: boolean;
  userEmail?: string | null;
  mediaBaseDir: string;
  screenshotsDir: string;
  vaultRoot: string;
  hddMode: boolean;
  screenshotEnabled: boolean;
  screenshotHotkey: string;
  appStartupEnabled: boolean;
  onHddModeChange: (enabled: boolean) => void;
  onScreenshotEnabledChange: (enabled: boolean) => void;
  onScreenshotHotkeyChange: (hotkey: string) => void;
  onAppStartupChange: (enabled: boolean) => void;
  onFieldChange: (field: 'media' | 'screenshots' | 'vault', value: string) => void;
  onBrowseFolder: (field: 'media' | 'screenshots' | 'vault') => Promise<void>;
  onGoogleLogin: () => Promise<void>;
  onComplete: () => Promise<void>;
}

/**
 * Mandatory 2-step onboarding shown on first launch / signed-out startup:
 * Step 1: Google sign-in (activates account-isolated library, tracker, and cloud sync).
 * Step 2: Storage drive selection + screenshot hotkey/folder setup.
 */
export const FirstRunSetupModal: React.FC<FirstRunSetupModalProps> = ({
  loggedIn,
  userEmail,
  mediaBaseDir,
  screenshotsDir,
  vaultRoot,
  hddMode,
  screenshotEnabled,
  screenshotHotkey,
  appStartupEnabled,
  onHddModeChange,
  onScreenshotEnabledChange,
  onScreenshotHotkeyChange,
  onAppStartupChange,
  onFieldChange,
  onBrowseFolder,
  onGoogleLogin,
  onComplete,
}) => {
  const [loggingIn, setLoggingIn] = useState<boolean>(false);
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

  const handleLoginClick = async () => {
    setLoggingIn(true);
    setError(null);
    try {
      await onGoogleLogin();
    } catch (err: any) {
      setError(err?.message || 'Đăng nhập Google thất bại hoặc đã bị hủy. Vui lòng thử lại.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleStart = async () => {
    if (!mediaBaseDir.trim()) {
      setError('Vui lòng chọn ổ / thư mục lưu ảnh & video game.');
      return;
    }
    if (!vaultRoot.trim()) {
      setError('Vui lòng chọn thư mục Save Vault để sao lưu save game.');
      return;
    }
    if ((hddMode || screenshotEnabled) && !screenshotsDir.trim()) {
      setError('Vui lòng chọn thư mục chụp màn hình nguồn.');
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="text-xs font-bold text-white flex items-center gap-1.5">
            {icon}
            <span>{label}</span>
          </label>
          <p className="text-[11px] text-[#8e95a5]">{hint}</p>
        </div>
        <button
          type="button"
          onClick={() => onBrowseFolder(field)}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#202433] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#ff2a44] hover:bg-[#ff2a44]/10 hover:text-[#ff2a44]"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>Chọn thư mục...</span>
        </button>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onFieldChange(field, e.target.value)}
        placeholder="Chọn hoặc nhập đường dẫn thư mục..."
        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#ff2a44]"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-[#2a2e3d] bg-[#0e1015] p-6 shadow-2xl shadow-black/60 my-auto">
        {/* Step Indicator */}
        <div className="mb-5 flex items-center gap-2 text-xs font-bold">
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 border ${
              loggedIn
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-[#ff2a44]/50 bg-[#ff2a44]/15 text-white'
            }`}
          >
            {loggedIn ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <span>1.</span>}
            <span>Đăng nhập Google</span>
          </div>
          <div className="h-px w-6 bg-[#2a2e3d]" />
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 border ${
              loggedIn
                ? 'border-[#ff2a44]/50 bg-[#ff2a44]/15 text-white'
                : 'border-[#2a2e3d] bg-[#161822] text-[#6d7487]'
            }`}
          >
            <span>2.</span>
            <span>Chọn ổ &amp; Chụp màn hình</span>
          </div>
        </div>

        {!loggedIn ? (
          /* STEP 1: Mandatory Google Login */
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#ff2a44]/40 bg-[#ff2a44]/10">
                <ShieldCheck className="h-6 w-6 text-[#ff2a44]" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white">Chào mừng đến với GameVault!</h2>
                <p className="text-xs text-[#8e95a5]">
                  Đăng nhập Google để kích hoạt theo dõi giờ chơi, lưu ảnh/save lên Cloud và đồng bộ thư viện theo tài khoản.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-4 space-y-2 text-xs text-[#b5bccb]">
              <p className="font-semibold text-white">Tại sao cần đăng nhập trước khi sử dụng?</p>
              <ul className="list-disc pl-4 space-y-1 text-[#8e95a5]">
                <li>Cô lập thư viện game &amp; giờ chơi riêng cho từng tài khoản trên máy dùng chung.</li>
                <li>Tự động bật bộ đếm giờ chơi, nhận diện game và đồng bộ dữ liệu Cloud.</li>
                <li>Hỗ trợ sao lưu ảnh chụp màn hình &amp; save game lên Google Drive cá nhân.</li>
              </ul>
            </div>

            {error && (
              <div className="rounded-lg border border-[#ff2a44]/40 bg-[#ff2a44]/10 px-3 py-2 text-xs font-semibold text-[#ff6b7d]">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end pt-2 border-t border-[#2a2e3d]/60">
              <button
                type="button"
                onClick={handleLoginClick}
                disabled={loggingIn}
                className="flex items-center gap-2 rounded-xl bg-[#ff2a44] px-6 py-2.5 text-sm font-black text-white shadow-lg shadow-[#ff2a44]/30 transition hover:bg-[#ff2a44]/90 disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                <span>{loggingIn ? 'Đang mở trình duyệt đăng nhập...' : 'Đăng nhập bằng Google'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* STEP 2: Storage & Screenshot Setup */
          <>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#ff2a44]/40 bg-[#ff2a44]/10">
                <HardDrive className="h-5 w-5 text-[#ff2a44]" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white">Thiết lập ổ lưu trữ &amp; Chụp màn hình</h2>
                <p className="text-xs text-[#8e95a5]">
                  {userEmail ? `Tài khoản: ${userEmail} — ` : ''}Chọn nơi lưu ảnh/video, Save Vault và phím tắt chụp ảnh trước khi bắt đầu.
                </p>
              </div>
            </div>

            {/* Quick Google Drive Recommendation if Detected */}
            {gdriveDetected && mediaBaseDir !== gdriveDetected.path && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                <div className="flex items-center gap-2 text-emerald-300">
                  <Zap className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Phát hiện ổ <strong>Google Drive ({gdriveDetected.drive})</strong>! Có thể lưu thẳng ảnh vào đây để tự đồng bộ.
                  </span>
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

            {/* HDD Mode Toggle Card */}
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
                      <span className="text-xs font-bold text-white">Chế độ HDD (Lưu tạm &amp; Đồng bộ sau)</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          hddMode
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        }`}
                      >
                        {hddMode ? 'Đang BẬT (HDD)' : 'Đang TẮT (SSD)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8e95a5]">
                      {hddMode
                        ? 'Ảnh chụp lưu tạm vào ổ nhanh (SSD) rồi mới chuyển sang ổ HDD.'
                        : 'Ảnh chụp lưu thẳng vào thư mục game trong ổ đích (tối ưu cho SSD).'}
                    </p>
                  </div>
                </div>
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

              <div
                className={`rounded-lg border p-2.5 text-[11px] leading-relaxed flex items-start gap-2 ${
                  hddMode
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200/90'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200/90'
                }`}
              >
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {hddMode
                    ? 'Nếu ổ đích là HDD, giữ BẬT để tránh ổ cứng quay liên tục khi chơi. Nếu dùng SSD, nên TẮT.'
                    : 'Đang tắt HDD Mode — ảnh chụp sẽ lưu thẳng vào thư mục đích bên dưới.'}
                </span>
              </div>
            </div>

            {/* Storage Paths */}
            <div className="mt-3.5 space-y-3">
              {fieldCard(
                <Gamepad2 className="h-4 w-4 text-[#ff2a44]" />,
                'Ổ / Thư mục lưu ảnh & video game:',
                'Ảnh chụp & video sẽ tự phân loại theo từng folder game ở đây.',
                mediaBaseDir,
                'media'
              )}
              {(hddMode || screenshotEnabled) &&
                fieldCard(
                  <Camera className="h-4 w-4 text-amber-400" />,
                  'Thư mục nguồn chụp màn hình:',
                  'Thư mục chứa ảnh chụp màn hình trên máy (vd: Pictures\\Screenshots).',
                  screenshotsDir,
                  'screenshots'
                )}
              {fieldCard(
                <Layers className="h-4 w-4 text-emerald-400" />,
                'Thư mục Save Vault (sao lưu save game):',
                'Nơi lưu các bản backup save game an toàn.',
                vaultRoot,
                'vault'
              )}
            </div>

            {/* Screenshot Hotkey & Startup Quick Setup */}
            <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <Keyboard className="h-4 w-4 text-[#ff2a44]" />
                    <span>Chụp ảnh bằng phím tắt</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onScreenshotEnabledChange(!screenshotEnabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      screenshotEnabled ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        screenshotEnabled ? 'translate-x-4.5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#8e95a5]">Phím chụp nhanh:</span>
                  <select
                    value={screenshotHotkey}
                    disabled={!screenshotEnabled}
                    onChange={(e) => onScreenshotHotkeyChange(e.target.value)}
                    className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-1 text-xs font-semibold text-white outline-none focus:border-[#ff2a44] disabled:opacity-50"
                  >
                    {HOTKEY_CHOICES.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-xl border border-[#2a2e3d] bg-[#161822] p-3.5 flex items-center justify-between gap-2">
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <Power className="h-4 w-4 text-emerald-400" />
                    <span>Chạy cùng Windows</span>
                  </span>
                  <p className="mt-1 text-[11px] text-[#8e95a5]">
                    Tự chạy ngầm trong khay để không sót phút chơi nào.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onAppStartupChange(!appStartupEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    appStartupEnabled ? 'bg-emerald-500' : 'bg-[#2a2e3d]'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      appStartupEnabled ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {error && <p className="mt-3 text-xs font-semibold text-[#ff2a44]">{error}</p>}

            {/* Footer */}
            <div className="mt-5 flex items-center justify-between pt-3 border-t border-[#2a2e3d]/60">
              <p className="text-[11px] text-[#8e95a5]">
                Có thể đổi lại bất cứ lúc nào trong Cài đặt → Thư viện &amp; Lưu trữ.
              </p>
              <button
                type="button"
                onClick={handleStart}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#ff2a44] px-6 py-2.5 text-sm font-black text-white shadow-lg shadow-[#ff2a44]/30 transition hover:bg-[#ff2a44]/90 disabled:opacity-60"
              >
                {saving ? 'Đang lưu...' : 'Hoàn tất & Bắt đầu'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
