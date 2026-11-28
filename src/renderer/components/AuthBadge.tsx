import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LogIn, LogOut, Cpu, ChevronDown, Loader2, User, ShieldCheck, Globe, Settings, RefreshCw, Monitor } from 'lucide-react';
import { type AuthStatus, type HardwareInfo, isAdminEmail } from '../../shared/types.js';

interface AuthBadgeProps {
  onOpenSettingsModal?: () => void;
  onChanged?: (status: AuthStatus) => void;
  onOpenAdminModal?: () => void;
  onOpenProfile?: () => void;
}

/**
 * Navbar identity widget: "Đăng nhập" button when logged out (opens the system
 * browser via OAuth loopback), avatar + dropdown when logged in.
 */
export const AuthBadge: React.FC<AuthBadgeProps> = ({ onChanged, onOpenAdminModal, onOpenProfile, onOpenSettingsModal }) => {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [hwModalOpen, setHwModalOpen] = useState<boolean>(false);
  const [detectedHw, setDetectedHw] = useState<HardwareInfo | null>(null);
  const [detectingHw, setDetectingHw] = useState<boolean>(false);
  const [hwSaved, setHwSaved] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const formatVram = (vramMb: number): string => {
    if (!vramMb || vramMb <= 0) return '';
    return vramMb >= 1024 ? `${(vramMb / 1024).toFixed(vramMb % 1024 === 0 ? 0 : 1)} GB` : `${vramMb} MB`;
  };

  const refresh = async () => {
    try {
      const next = await window.electronAPI.getAuthStatus();
      setStatus(next);
      onChanged?.(next);
    } catch {
      // auth status is optional
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener('community-auth-changed', changed);
    return () => window.removeEventListener('community-auth-changed', changed);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);

  const openHwModal = async () => {
    setMenuOpen(false);
    setHwModalOpen(true);
    setHwSaved(false);
    setError(null);
    setDetectingHw(true);
    try {
      const [localRes, syncRes] = await Promise.allSettled([
        window.electronAPI.getHardwareInfo?.(false) ?? Promise.resolve(null),
        window.electronAPI.syncMyHardwareProfile?.(false) ?? Promise.resolve(null),
      ]);
      const local = localRes.status === 'fulfilled' ? localRes.value : null;
      if (local) setDetectedHw(local);
      if (syncRes.status === 'fulfilled' && syncRes.value) setHwSaved(true);
    } finally {
      setDetectingHw(false);
    }
  };

  const handleDetectHw = async () => {
    if (!window.electronAPI?.getHardwareInfo) return;
    setDetectingHw(true);
    setHwSaved(false);
    setError(null);
    try {
      const local = await window.electronAPI.getHardwareInfo(true);
      setDetectedHw(local);
      const synced = await window.electronAPI.syncMyHardwareProfile?.(true);
      if (synced) setHwSaved(true);
    } catch (err: any) {
      setError(String(err?.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
    } finally {
      setDetectingHw(false);
    }
  };

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.login();
      await refresh();
    } catch (err: any) {
      let msg = String(err?.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
      if (msg.includes('access_denied') || msg.includes('Google trả về lỗi: access_denied')) {
        msg = 'Tài khoản chưa được cấp quyền (nếu app đang ở chế độ Testing trên Google Cloud, cần thêm email vào Test Users, hoặc chuyển app sang Publish/Production).';
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await window.electronAPI.logout();
      setMenuOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const profile = status?.profile;

  return (
    <>
      {!status ? (
        <div className="h-8 w-8 animate-pulse rounded-full bg-[#2a2e3d]" />
      ) : (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu tài khoản"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-lg border border-[#2a2e3d] bg-[#161821] py-1 pl-1 pr-2 transition hover:border-sky-400"
          >
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2a2e3d]">
                <User className="h-3.5 w-3.5 text-[#8e95a5]" />
              </span>
            )}
            <span className="max-w-28 truncate text-xs font-semibold text-white">{profile?.displayName || 'Tài khoản'}</span>
            <ChevronDown className="h-3 w-3 text-[#8e95a5]" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-[#2a2e3d] bg-[#161821] p-1.5 shadow-2xl">
              <div className="px-2.5 py-1.5 text-[10px] text-[#8e95a5] border-b border-[#2a2e3d]/60 mb-1">
                <div className="font-semibold text-white truncate">{profile?.displayName || 'Khách'}</div>
                <div className="truncate">{profile?.email}</div>
              </div>
              {onOpenSettingsModal && <button onClick={() => { setMenuOpen(false); onOpenSettingsModal(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#f1f3f7] hover:bg-[#0e1015]">
                <Settings className="h-3.5 w-3.5" /> Cài đặt
              </button>}
              {!profile && <button data-navbar-sign-in onClick={handleLogin} disabled={busy}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#f1f3f7] hover:bg-[#0e1015] disabled:opacity-50">
                <LogIn className="h-3.5 w-3.5" /> {busy ? 'Đang đăng nhập…' : 'Đăng nhập Google'}
              </button>}
              {profile && <>
              {onOpenProfile && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenProfile();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#f1f3f7] transition hover:bg-[#0e1015] hover:text-white"
                >
                  <User className="h-3.5 w-3.5" />
                  Trang cá nhân
                </button>
              )}
              {isAdminEmail(profile.email) && onOpenAdminModal && (
                <>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenAdminModal();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-amber-400 font-semibold transition hover:bg-amber-500/10 hover:text-amber-300"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Quản trị Bìa Game
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      window.electronAPI.openAdminWebPortal?.();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-sky-400 font-semibold transition hover:bg-sky-500/10 hover:text-sky-300"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Mở Web Admin (/admin)
                  </button>
                </>
              )}
              <button
                onClick={openHwModal}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#8e95a5] transition hover:bg-[#0e1015] hover:text-white"
              >
                <Cpu className="h-3.5 w-3.5" />
                Cấu hình máy của tôi
              </button>
              <button
                onClick={handleLogout}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#8e95a5] transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                Đăng xuất
              </button>
              </>}
            </div>
          )}
        </div>
      )}

      {/* Hardware profile modal */}
        {hwModalOpen && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Cpu className="h-5 w-5 text-sky-400" />
                <span>Cấu hình máy của tôi</span>
              </h3>
              <button
                type="button"
                onClick={handleDetectHw}
                disabled={detectingHw}
                title="Quét lại phần cứng máy hiện tại và điền vào form"
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${detectingHw ? 'animate-spin' : ''}`} />
                {detectingHw ? 'Đang quét…' : 'Tự nhận diện'}
              </button>
            </div>
            <p className="text-xs text-[#8e95a5]">
              Tự động nhận diện chính xác theo phần cứng máy đang đăng nhập (không cho chỉnh sửa thủ công) để gắn vào review & kết quả đo FPS.
            </p>
            <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015]/80 p-3.5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between text-[#8e95a5] font-semibold">
                <span className="flex items-center gap-1.5 text-sky-300">
                  <Monitor className="h-3.5 w-3.5" />
                  Phần cứng máy hiện tại
                </span>
                {hwSaved && (
                  <span className="text-[10px] font-semibold text-emerald-400">Đã đồng bộ cloud ✓</span>
                )}
              </div>
              {detectingHw && !detectedHw ? (
                <div className="flex items-center gap-2 py-2 text-[#8e95a5]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                  Đang đọc CPU, GPU, RAM, màn hình…
                </div>
              ) : detectedHw ? (
                <div className="space-y-2 text-[#e5e7eb]">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#8e95a5]">Card đồ họa (GPU)</div>
                    <div className="font-semibold text-white">
                      {detectedHw.gpus.length > 0
                        ? detectedHw.gpus.map((g) => `${g.name}${g.vram_mb ? ` (${formatVram(g.vram_mb)})` : ''}`).join(' + ')
                        : 'Không rõ'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#8e95a5]">CPU</div>
                    <div className="font-semibold text-white">
                      {detectedHw.cpu_name || 'Không rõ'}
                      {detectedHw.cpu_cores ? <span className="font-normal text-[#8e95a5]"> ({detectedHw.cpu_cores} nhân / {detectedHw.cpu_threads} luồng)</span> : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#8e95a5]">RAM</div>
                      <div className="font-mono font-semibold text-white">{detectedHw.ram_gb ? `${detectedHw.ram_gb} GB` : '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#8e95a5]">Màn hình</div>
                      <div className="font-mono font-semibold text-white">
                        {detectedHw.display?.width
                          ? `${detectedHw.display.width}×${detectedHw.display.height}${detectedHw.display.refresh_hz ? ` @ ${detectedHw.display.refresh_hz}Hz` : ''}`
                          : '—'}
                      </div>
                    </div>
                  </div>
                  {detectedHw.os_name && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#8e95a5]">Hệ điều hành</div>
                      <div className="text-[11px] text-[#9ca3af]">{detectedHw.os_name}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[#8e95a5]">Không đọc được thông tin phần cứng.</div>
              )}
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setHwModalOpen(false)}
                className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-4 py-1.5 text-xs font-semibold text-white hover:border-sky-400"
              >
                Đóng
              </button>
            </div>
          </div>
          </div>,
          document.body,
        )}

      {/* Login error toast */}
      {error && !hwModalOpen && (
        <div className="fixed bottom-20 right-6 z-50 max-w-sm rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-2xl">
          {error}
        </div>
      )}
    </>
  );
};
