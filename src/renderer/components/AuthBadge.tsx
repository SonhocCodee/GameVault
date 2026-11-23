import React, { useState, useEffect, useRef } from 'react';
import { LogIn, LogOut, Cpu, ChevronDown, Loader2, User } from 'lucide-react';
import type { AuthStatus, HardwareProfile } from '../../shared/types.js';

interface AuthBadgeProps {
  onChanged?: (status: AuthStatus) => void;
}

/**
 * Navbar identity widget: "Đăng nhập" button when logged out (opens the system
 * browser via OAuth loopback), avatar + dropdown when logged in.
 */
export const AuthBadge: React.FC<AuthBadgeProps> = ({ onChanged }) => {
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
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
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
      ) : !profile ? (
        <button
          onClick={handleLogin}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs font-semibold text-[#f1f3f7] transition hover:border-[#4285F4] hover:bg-[#1c1f2e] hover:text-white disabled:opacity-50 shadow-sm"
          title="Đăng nhập bằng tài khoản Google"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4285F4]" />
          ) : (
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
          )}
          <span>{busy ? 'Đang mở trình duyệt...' : 'Đăng nhập Google'}</span>
        </button>
      ) : (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-[#2a2e3d] bg-[#161821] py-1 pl-1 pr-2 transition hover:border-sky-400"
          >
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2a2e3d]">
                <User className="h-3.5 w-3.5 text-[#8e95a5]" />
              </span>
            )}
            <span className="max-w-28 truncate text-xs font-semibold text-white">{profile.displayName}</span>
            <ChevronDown className="h-3 w-3 text-[#8e95a5]" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-[#2a2e3d] bg-[#161821] p-1.5 shadow-2xl">
              <div className="px-2.5 py-1.5 text-[10px] text-[#8e95a5]">{profile.email}</div>
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
            </div>
          )}
        </div>
      )}

      {/* Hardware profile modal */}
      {hwModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
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
        </div>
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
