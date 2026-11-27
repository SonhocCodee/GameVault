import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CommunityAdapter } from "../../src/shared/community.ts";
import { CommunityHub } from "../../src/renderer/community/CommunityHub.tsx";
import "./index.css";
const tokenKey = "gamevault.community.session";
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(`/api/community${path}`, {
    method,
    headers: {
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {}),
    },
    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (response.status === 401) localStorage.removeItem(tokenKey);
  if (!response.ok)
    throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}
function App() {
  const [clientId, setClientId] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [loginOpen, setLoginOpen] = useState(false),
    [error, setError] = useState("");
  const [hasToken, setHasToken] = useState(!!localStorage.getItem(tokenKey));
  useEffect(() => {
    const changed = () => setHasToken(!!localStorage.getItem(tokenKey));
    window.addEventListener("community-auth-changed", changed);
    return () => window.removeEventListener("community-auth-changed", changed);
  }, []);
  const target = useRef<HTMLDivElement>(null),
    pending = useRef<{
      resolve: () => void;
      reject: (e: Error) => void;
    } | null>(null);
  useEffect(() => {
    let active = true;
    void request<{
      googleClientId: string | null;
    }>("/config")
      .then((c) => {
        if (active) setClientId(c.googleClientId);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!clientId) return;
    if ((window as any).google?.accounts?.id) {
      setReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () =>
      setError(
        "Không tải được đăng nhập Google. Hãy thử lại hoặc đăng nhập trong ứng dụng.",
      );
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [clientId]);
  useEffect(() => {
    if (!loginOpen || !ready || !clientId || !target.current) return;
    const google = (window as any).google;
    google.accounts.id.initialize({
      client_id: clientId,
      callback: async ({ credential }: { credential: string }) => {
        try {
          const response = await fetch("/api/auth/google", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              idToken: credential,
            }),
          });
          const body = await response.json();
          if (!response.ok || !body.token)
            throw new Error("Google authentication failed");
          localStorage.setItem(tokenKey, body.token);
          setLoginOpen(false);
          setError("");
          pending.current?.resolve();
          pending.current = null;
          window.dispatchEvent(new Event("community-auth-changed"));
        } catch {
          setError("Đăng nhập không thành công. Hãy thử lại.");
          pending.current?.reject(new Error("Google sign-in failed"));
          pending.current = null;
        }
      },
    });
    target.current.replaceChildren();
    google.accounts.id.renderButton(target.current, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      locale: "vi",
    });
  }, [loginOpen, ready, clientId]);
  const api = useMemo<CommunityAdapter>(
    () => ({
      publicBase: window.location.origin,
      request,
      upload: async (file) => {
        const token = localStorage.getItem(tokenKey);
        const response = await fetch("/api/community/uploads", {
          method: "POST",
          headers: {
            ...(token
              ? {
                  Authorization: `Bearer ${token}`,
                }
              : {}),
            "Content-Type": file.type,
          },
          body: file,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed");
        return data;
      },
      signIn: () => {
        if (!clientId) {
          setError(
            "Đăng nhập web chưa được cấu hình. Bạn vẫn có thể đọc nội dung và tương tác từ ứng dụng GameVault.",
          );
          return Promise.reject(
            new Error("Web OAuth configuration is missing"),
          );
        }
        setLoginOpen(true);
        return new Promise<void>((resolve, reject) => {
          pending.current?.reject(new Error("Sign-in superseded"));
          pending.current = {
            resolve,
            reject,
          };
        });
      },
    }),
    [clientId],
  );
  return (
    <>
      <div
        className="gv-community"
        style={{
          paddingBottom: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            marginBottom: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,42,68,0.35)",
            background: "rgba(255,42,68,0.08)",
          }}
        >
          <span style={{ fontSize: 13 }}>
            <strong>GameVault Desktop (Windows)</strong> — Cài đặt để tự động đếm giờ chơi, chụp màn hình và đồng bộ thư viện.
          </span>
          <a
            href="/community/downloads/GameVault-Web-Setup-1.0.0.exe"
            download="GameVault-Web-Setup-1.0.0.exe"
            style={{
              display: "inline-block",
              padding: "7px 14px",
              borderRadius: 8,
              background: "#ff2a44",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Tải bản cài đặt (.exe)
          </a>
        </div>
      </div>
      {(loginOpen || error || hasToken) && (
        <div
          className="gv-community"
          style={{
            paddingBottom: 0,
          }}
        >
          {error && (
            <p className="gv-error" role="alert">
              {error}
            </p>
          )}
          {loginOpen && (
            <div>
              <p>Đăng nhập Google để đăng bài và tương tác.</p>
              <div ref={target} />
              {!ready && <p>Đang nạp Google…</p>}
              <button
                style={{
                  marginTop: 12,
                }}
                onClick={() => {
                  setLoginOpen(false);
                  pending.current?.reject(new Error("Sign-in cancelled"));
                  pending.current = null;
                }}
              >
                Hủy đăng nhập
              </button>
            </div>
          )}
          {hasToken && (
            <button
              onClick={() => {
                localStorage.removeItem(tokenKey);
                window.dispatchEvent(new Event("community-auth-changed"));
                setError("");
              }}
            >
              Đăng xuất
            </button>
          )}
        </div>
      )}
      <CommunityHub api={api} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
