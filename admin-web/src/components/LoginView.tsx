import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, KeyRound, Loader2, AlertCircle, Globe, Info } from 'lucide-react';
import {
  exchangeGoogleIdToken,
  getAdminConfig,
  getApiBase,
  setApiBase,
  setStoredToken,
} from '../api.ts';

declare global {
  interface Window {
    google?: any;
  }
}

interface LoginViewProps {
  initialError?: string | null;
  onLoggedIn: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ initialError, onLoggedIn }) => {
  const [clientId, setClientId] = useState<string>('');
  const [hasSeparateWebClientId, setHasSeparateWebClientId] = useState<boolean>(false);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(initialError || null);
  const [showTokenBox, setShowTokenBox] = useState<boolean>(false);
  const [manualToken, setManualToken] = useState<string>('');
  const [apiBaseInput, setApiBaseInput] = useState<string>(getApiBase());
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setError(initialError || null);
  }, [initialError]);

  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const cfg = await getAdminConfig();
      setClientId(cfg.webGoogleClientId || '');
      setHasSeparateWebClientId(cfg.hasSeparateWebClientId);
      if (!cfg.hasSeparateWebClientId) {
        setShowTokenBox(true);
      }
    } catch (err: any) {
      setError(err?.message || 'Không kết nối được tới Worker API');
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (!hasSeparateWebClientId || !clientId || !googleBtnRef.current) return;

    let cancelled = false;
    const initGsi = () => {
      if (cancelled || !window.google?.accounts?.id || !googleBtnRef.current) return false;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: { credential?: string }) => {
          if (!response?.credential) {
            setError('Google không trả về credential hợp lệ.');
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const auth = await exchangeGoogleIdToken(response.credential);
            setStoredToken(auth.token);
            onLoggedIn();
          } catch (err: any) {
            setError(err?.message || 'Đăng nhập thất bại');
          } finally {
            setBusy(false);
          }
        },
      });
      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_black',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'rectangular',
      });
      return true;
    };

    if (!initGsi()) {
      const interval = setInterval(() => {
        if (initGsi()) clearInterval(interval);
      }, 250);
      const timeout = setTimeout(() => clearInterval(interval), 8000);
      return () => {
        cancelled = true;
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [hasSeparateWebClientId, clientId, onLoggedIn]);

  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    setStoredToken(manualToken.trim());
    onLoggedIn();
  };

  const handleSaveApiBase = () => {
    setApiBase(apiBaseInput);
    loadConfig();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.08),_transparent_55%)]">
      <div className="w-full max-w-md rounded-2xl border border-[#262b3d] bg-[#131620] p-6 shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-red-500/20 border border-amber-500/30 text-amber-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">GameVault Web Admin</h1>
            <p className="text-xs text-[#8e95a5]">
              Quản trị Master Covers & Đồng bộ ảnh toàn server
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="rounded-xl border border-[#262b3d] bg-[#0d1018] p-4 space-y-3">
          <div className="text-xs font-semibold text-white">Đăng nhập bằng tài khoản Google Admin</div>

          {loadingConfig ? (
            <div className="flex items-center gap-2 py-3 text-xs text-[#8e95a5]">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              <span>Đang tải cấu hình OAuth...</span>
            </div>
          ) : busy ? (
            <div className="flex items-center gap-2 py-3 text-xs text-amber-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Đang xác thực với Cloudflare Worker...</span>
            </div>
          ) : hasSeparateWebClientId ? (
            <div ref={googleBtnRef} className="min-h-[44px] flex items-center justify-center" />
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] text-amber-100/90 leading-relaxed">
              <Info className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="space-y-1.5">
                <div className="font-semibold text-amber-300">
                  Chưa cấu hình Web OAuth Client ID (Client ID hiện tại là loại Desktop)
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[#c2c9dc]">
                  <li>
                    <strong>Cách nhanh nhất (dùng ngay):</strong> Mở App GameVault trên máy tính → bấm <strong>Avatar → Mở Web Admin (/admin)</strong> để tự đăng nhập.
                  </li>
                  <li>
                    <strong>Để đăng nhập Google trực tiếp trên trình duyệt:</strong> vào{' '}
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 underline"
                    >
                      Google Cloud Credentials
                    </a>{' '}
                    → tạo OAuth Client ID loại <strong>Web application</strong> → thêm{' '}
                    <code className="text-amber-300">https://game-vault-worker.gamevault-son.workers.dev</code> vào{' '}
                    <strong>Authorized JavaScript origins</strong> → dán vào{' '}
                    <code className="text-amber-300">WEB_GOOGLE_CLIENT_ID</code> trong <code className="text-amber-300">wrangler.toml</code> rồi chạy <code className="text-amber-300">npm run deploy:worker</code>.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowTokenBox((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-[#262b3d] bg-[#161a26] px-3.5 py-2.5 text-xs font-semibold text-[#b8c0d4] hover:text-white transition"
          >
            <span className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-amber-400" />
              Đăng nhập bằng Session Token / Tùy chọn API
            </span>
            <span>{showTokenBox ? '▲' : '▼'}</span>
          </button>

          {showTokenBox && (
            <div className="rounded-xl border border-[#262b3d] bg-[#0d1018] p-3.5 space-y-3">
              <form onSubmit={handleManualTokenSubmit} className="space-y-2">
                <label className="block text-[11px] text-[#8e95a5]">
                  Dán Bearer Session Token (JWT từ app):
                </label>
                <input
                  type="password"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIs..."
                  className="w-full rounded-lg border border-[#262b3d] bg-[#131620] px-3 py-2 text-xs text-white font-mono outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 py-2 text-xs font-bold text-black transition"
                >
                  Xác thực Token
                </button>
              </form>

              <div className="border-t border-[#262b3d] pt-2.5 space-y-1.5">
                <label className="flex items-center gap-1.5 text-[11px] text-[#8e95a5]">
                  <Globe className="h-3 w-3" />
                  <span>Worker API URL (để trống nếu dùng cùng domain):</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={apiBaseInput}
                    onChange={(e) => setApiBaseInput(e.target.value)}
                    placeholder="https://game-vault-worker.gamevault-son.workers.dev"
                    className="flex-1 rounded-lg border border-[#262b3d] bg-[#131620] px-2.5 py-1.5 text-[11px] text-white font-mono outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={handleSaveApiBase}
                    className="rounded-lg bg-[#262b3d] hover:bg-[#353b52] px-3 py-1.5 text-[11px] font-semibold text-white"
                  >
                    Lưu
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
