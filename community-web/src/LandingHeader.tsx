import React, { useState } from "react";
import { translations, type Lang } from "./i18n";
import libraryImg from "./assets/screenshots/library.jpg";
import timelineImg from "./assets/screenshots/timeline.jpg";
import communityImg from "./assets/screenshots/community.jpg";
import leaderboardImg from "./assets/screenshots/leaderboard.jpg";

const DOWNLOAD_URL = "/community/downloads/GameVault-Web-Setup-1.0.0.exe";
const DOWNLOAD_NAME = "GameVault-Web-Setup-1.0.0.exe";

const SHOT_IMAGES: Record<string, string> = {
  library: libraryImg,
  timeline: timelineImg,
  community: communityImg,
  leaderboard: leaderboardImg,
};

interface LandingHeaderProps {
  lang: Lang;
  onChangeLang: (lang: Lang) => void;
}

export function LandingHeader({ lang, onChangeLang }: LandingHeaderProps) {
  const t = translations[lang];
  const [preview, setPreview] = useState<{ src: string; title: string } | null>(
    null,
  );

  return (
    <>
      <header className="gv-web-nav">
        <div className="gv-web-nav-inner">
          <a href="#top" className="gv-web-brand">
            <div className="gv-web-logo">GV</div>
            <div>
              <div className="gv-web-brand-title">
                <span>GAMEVAULT</span>
                <span className="gv-web-pro">PRO</span>
              </div>
              <div className="gv-web-brand-sub">{t.brandSubtitle}</div>
            </div>
          </a>

          <nav className="gv-web-links" aria-label="Primary">
            <a href="#features">{t.navFeatures}</a>
            <a href="#screenshots">{t.navScreenshots}</a>
            <a href="#community">{t.navCommunity}</a>
          </nav>

          <div className="gv-web-actions">
            <div className="gv-lang-switch" role="group" aria-label="Language">
              <button
                type="button"
                className={`gv-lang-btn ${lang === "vi" ? "active" : ""}`}
                onClick={() => onChangeLang("vi")}
              >
                VI
              </button>
              <button
                type="button"
                className={`gv-lang-btn ${lang === "en" ? "active" : ""}`}
                onClick={() => onChangeLang("en")}
              >
                EN
              </button>
            </div>
            <a
              href={DOWNLOAD_URL}
              download={DOWNLOAD_NAME}
              className="gv-btn-primary"
            >
              {t.downloadExe}
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="gv-hero">
          <div className="gv-web-container gv-hero-grid">
            <div>
              <div className="gv-hero-badge">{t.heroBadge}</div>
              <h1 className="gv-hero-title">
                {t.heroTitle1} <br />
                <span>{t.heroTitle2}</span>
              </h1>
              <p className="gv-hero-desc">{t.heroDesc}</p>
              <div className="gv-hero-cta">
                <a
                  href={DOWNLOAD_URL}
                  download={DOWNLOAD_NAME}
                  className="gv-btn-primary"
                >
                  {t.downloadFull}
                </a>
                <a href="#community" className="gv-btn-secondary">
                  {t.exploreCommunity}
                </a>
              </div>
              <div className="gv-hero-stats">
                <div className="gv-hero-stat">
                  <span className="gv-hero-dot" />
                  <span>{t.statAutoTrack}</span>
                </div>
                <div className="gv-hero-stat">
                  <span className="gv-hero-dot" />
                  <span>{t.statTimeline}</span>
                </div>
                <div className="gv-hero-stat">
                  <span className="gv-hero-dot" />
                  <span>{t.statCloudSync}</span>
                </div>
              </div>
            </div>

            <div
              className="gv-hero-preview"
              onClick={() =>
                setPreview({
                  src: libraryImg,
                  title: t.screenshots[0].title,
                })
              }
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setPreview({
                    src: libraryImg,
                    title: t.screenshots[0].title,
                  });
                }
              }}
            >
              <img src={libraryImg} alt={t.screenshots[0].title} />
            </div>
          </div>
        </section>

        <section id="features" className="gv-section">
          <div className="gv-web-container">
            <div className="gv-section-head">
              <h2 className="gv-section-title">{t.featuresTitle}</h2>
              <p className="gv-section-sub">{t.featuresSubtitle}</p>
            </div>
            <div className="gv-features-grid">
              {t.features.map((item) => (
                <div key={item.badge} className="gv-feature-card">
                  <span className="gv-feature-badge">{item.badge}</span>
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="screenshots" className="gv-section">
          <div className="gv-web-container">
            <div className="gv-section-head">
              <h2 className="gv-section-title">{t.screenshotsTitle}</h2>
              <p className="gv-section-sub">{t.screenshotsSubtitle}</p>
            </div>
            <div className="gv-shots-grid">
              {t.screenshots.map((shot) => {
                const src = SHOT_IMAGES[shot.id];
                return (
                  <button
                    key={shot.id}
                    type="button"
                    className="gv-shot-card"
                    onClick={() => setPreview({ src, title: shot.title })}
                  >
                    <div className="gv-shot-img-wrap">
                      <img src={src} alt={shot.title} loading="lazy" />
                    </div>
                    <div className="gv-shot-body">
                      <h3>{shot.title}</h3>
                      <p>{shot.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {preview && (
        <div
          className="gv-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
        >
          <div
            className="gv-lightbox-inner"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gv-lightbox-bar">
              <strong>{preview.title}</strong>
              <button
                type="button"
                className="gv-btn-secondary"
                onClick={() => setPreview(null)}
              >
                {t.closePreview}
              </button>
            </div>
            <img
              src={preview.src}
              alt={preview.title}
              className="gv-lightbox-img"
            />
          </div>
        </div>
      )}
    </>
  );
}
