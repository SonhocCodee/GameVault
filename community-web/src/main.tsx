import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CommunityAdapter } from "../../src/shared/community.ts";
import { CommunityHub } from "../../src/renderer/community/CommunityHub.tsx";
import { LandingHeader } from "./LandingHeader.tsx";
import { translations, type Lang } from "./i18n.ts";
import "./index.css";

const tokenKey = "gamevault.community.session";
const langKey = "gamevault.web.lang";

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
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(langKey);
    return saved === "en" ? "en" : "vi";
  });
  const t = translations[lang];

  const handleChangeLang = (next: Lang) => {
    setLang(next);
    localStorage.setItem(langKey, next);
    document.documentElement.lang = next;
  };

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
    script.onerror = () => setError(t.googleLoadError);
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [clientId, t.googleLoadError]);

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
          setError(t.signInFailed);
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
      locale: lang,
    });
  }, [loginOpen, ready, clientId, lang, t.signInFailed]);

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
          setError(t.oauthMissing);
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
    [clientId, t.oauthMissing],
  );

  return (
    <>
      <LandingHeader lang={lang} onChangeLang={handleChangeLang} />

      <section id="community" className="gv-web-container gv-community-divider">
        <div className="gv-section-head">
          <h2 className="gv-section-title">{t.communitySectionTitle}</h2>
          <p className="gv-section-sub">{t.communitySectionDesc}</p>
        </div>

        {(loginOpen || error || hasToken) && (
          <div className="gv-auth-card">
            {error && (
              <p className="gv-error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            {loginOpen && (
              <div>
                <p style={{ margin: "0 0 10px" }}>{t.signInPrompt}</p>
                <div ref={target} />
                {!ready && (
                  <p style={{ margin: "8px 0 0", color: "var(--gv-muted)" }}>
                    {t.loadingGoogle}
                  </p>
                )}
                <button
                  type="button"
                  className="gv-btn-secondary"
                  style={{ marginTop: 12 }}
                  onClick={() => {
                    setLoginOpen(false);
                    pending.current?.reject(new Error("Sign-in cancelled"));
                    pending.current = null;
                  }}
                >
                  {t.cancelSignIn}
                </button>
              </div>
            )}
            {hasToken && (
              <button
                type="button"
                className="gv-btn-secondary"
                onClick={() => {
                  localStorage.removeItem(tokenKey);
                  window.dispatchEvent(new Event("community-auth-changed"));
                  setError("");
                }}
              >
                {t.signOut}
              </button>
            )}
          </div>
        )}
      </section>

      <CommunityHub api={api} />

      <footer className="gv-web-footer">{t.footerText}</footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
