import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LogIn, LogOut, Cpu, ChevronDown, Loader2, User, ShieldCheck, Globe, Settings } from 'lucide-react';
import { type AuthStatus, type HardwareProfile, isAdminEmail } from '../../shared/types.js';

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
  const [hw, setHw] = useState<HardwareProfile>({ gpu: '', cpu: '', ramGb: 0 });
  const [hwSaved, setHwSaved] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    try {
      const current = await window.electronAPI.getMyHardwareProfile?.();
      if (current) setHw(current);
    } catch {
      // no profile yet
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

  const handleSaveHw = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.setMyHardwareProfile?.(hw);
      setHwSaved(true);
      setTimeout(() => setHwModalOpen(false), 700);
    } catch (err: any) {
      setError(String(err?.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
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
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Cpu className="h-5 w-5 text-sky-400" />
              <span>Cấu hình máy của tôi</span>
            </h3>
            <p className="text-xs text-[#8e95a5]">
              Đi kèm mỗi review — giúp bạn bè biết "máy cấu hình giống tui chạy được không".
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#8e95a5] mb-1">GPU (VD: RTX 3050):</label>
                <input
                  value={hw.gpu}
                  onChange={(e) => setHw({ ...hw, gpu: e.target.value })}
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                  placeholder="NVIDIA GeForce RTX 3050"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8e95a5] mb-1">CPU (VD: Ryzen 5 5600):</label>
                <input
                  value={hw.cpu}
                  onChange={(e) => setHw({ ...hw, cpu: e.target.value })}
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                  placeholder="AMD Ryzen 5 5600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8e95a5] mb-1">RAM (GB):</label>
                <input
                  type="number"
                  min={0}
                  value={hw.ramGb || ''}
                  onChange={(e) => setHw({ ...hw, ramGb: parseInt(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs font-mono text-white outline-none focus:border-sky-400"
                />
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setHwModalOpen(false)}
                className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] hover:text-white"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveHw}
                disabled={busy}
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hwSaved ? 'Đã lưu ✓' : 'Lưu lên cloud'}
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
