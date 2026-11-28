import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookmarkPlus,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Crown,
  Eye,
  ExternalLink,
  Flag,
  Gauge,
  Loader2,
  MessageSquareText,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type {
  CommunityAdapter,
  CommunityPost,
  CommunityReview,
  Page,
  PerformanceReport,
  PerformancePreview,
  PublicGame,
  PublicProfile,
  SharedLibraryGame,
  SteamRequirements,
} from "../../shared/community.ts";
import type { FpsStatus, HardwareInfo } from "../../shared/types.js";
import { setupFpsCapture } from "../fps-setup.js";
import {
  communityError,
  formatRelativeTime,
  minutesLabel,
  parseSteamRequirements,
  qualifyCommunityUrl,
} from "./client.ts";
import { GamePlayers } from "./GamePlayers.tsx";
import { PostCard } from "./PostCard.tsx";
import { PostComposer } from "./PostComposer.tsx";
import {
  Avatar,
  ConfirmModal,
  formatScore,
  getMetacriticTier,
  getMetacriticVerdict,
  ReportModal,
  scoreTierClass,
} from "./CommunityWidgets.tsx";

const emptyPage = <T,>(): Page<T> => ({
  items: [],
  hasMore: false,
  nextOffset: 0,
});

type HubTab = "overview" | "reviews" | "posts" | "players" | "specs";

export function GameHub({
  api,
  game,
  me,
  onBack,
  backLabel = "Quay lại Top game",
  onGame,
  onProfile,
  onAdd,
  localGame,
  onLocalGame,
  onToast,
}: {
  api: CommunityAdapter;
  game: PublicGame;
  me: PublicProfile | null;
  onBack: () => void;
  backLabel?: string;
  onGame: (g: PublicGame) => void;
  onProfile: (uid: string) => void;
  onAdd?: (g: PublicGame) => Promise<void>;
  localGame?: SharedLibraryGame;
  onLocalGame?: (id: number) => void;
  onToast?: (msg: string) => void;
}) {
  const [hubTab, setHubTab] = useState<HubTab>("overview");
  const [requirements, setRequirements] = useState<SteamRequirements | null>(
    null,
  );
  const [steamError, setSteamError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [reports, setReports] = useState<Page<PerformanceReport>>(emptyPage());
  const [localPreview, setLocalPreview] = useState<PerformancePreview | null>(null);
  const [localHardware, setLocalHardware] = useState<HardwareInfo | null>(null);
  const [localFpsStatus, setLocalFpsStatus] = useState<FpsStatus | null>(null);
  const [localAutoCaptureEnabled, setLocalAutoCaptureEnabled] = useState(true);
  const [localAutoShareEnabled, setLocalAutoShareEnabled] = useState(false);
  const [localPreviewLoading, setLocalPreviewLoading] = useState(false);
  const [localPreviewError, setLocalPreviewError] = useState("");
  const [settingUpLocalFps, setSettingUpLocalFps] = useState(false);
  const [reviews, setReviews] = useState<Page<CommunityReview>>(emptyPage());
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState("");
  const [posts, setPosts] = useState<Page<CommunityPost>>(emptyPage());

  // Performance filter state
  const [gpu, setGpu] = useState("");
  const [resolution, setResolution] = useState("");
  const [preset, setPreset] = useState("");

  // Review composer state
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [score, setScore] = useState(8);
  const [review, setReview] = useState("");
  const [reviewSpoiler, setReviewSpoiler] = useState(false);
  const [dropped, setDropped] = useState(false);
  const [confirmDeleteReview, setConfirmDeleteReview] = useState(false);

  // Post composer state
  const [postComposerOpen, setPostComposerOpen] = useState(false);

  // Report modal state
  const [reportTarget, setReportTarget] = useState<{
    type: "review" | "performance";
    id: string;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [playersRevision, setPlayersRevision] = useState(0);
  const loadSequence = useRef(0);
  const autoSyncedPerfKeys = useRef<Set<string>>(new Set());

  const activeGame: PublicGame = {
    ...game,
    title:
      requirements?.title && requirements.title !== game.gameKey
        ? requirements.title
        : game.title,
    steamId: requirements?.steamId || game.steamId,
    coverUrl: game.coverUrl || requirements?.coverUrl,
  };

  const base = `/games/${encodeURIComponent(game.gameKey)}`;

  const loadLocalPerformance = useCallback(async () => {
    const gameId = localGame?.localGameId;
    if (!gameId || !window.electronAPI?.getPerformancePreview) {
      setLocalPreview(null);
      setLocalFpsStatus(null);
      return;
    }

    setLocalPreviewLoading(true);
    setLocalPreviewError("");
    try {
      const statusPromise = window.electronAPI.getFpsStatus
        ? window.electronAPI.getFpsStatus().catch(() => null)
        : Promise.resolve(null);
      const settingsPromise = window.electronAPI.getSettings
        ? window.electronAPI.getSettings().catch(() => null)
        : Promise.resolve(null);
      const hardwarePromise = window.electronAPI.getHardwareInfo
        ? window.electronAPI.getHardwareInfo().catch(() => null)
        : Promise.resolve(null);
      const [preview, status, settings, hw] = await Promise.all([
        window.electronAPI.getPerformancePreview(gameId),
        statusPromise,
        settingsPromise,
        hardwarePromise,
      ]);
      setLocalPreview(preview);
      setLocalFpsStatus(status);
      if (hw) setLocalHardware(hw);
      if (settings) {
        setLocalAutoCaptureEnabled(settings.fpsAutoCaptureEnabled);
        setLocalAutoShareEnabled(settings.fpsAutoShareEnabled);
      }
    } catch (e) {
      setLocalPreviewError(communityError(e));
    } finally {
      setLocalPreviewLoading(false);
    }
  }, [localGame?.localGameId]);

  useEffect(() => {
    void loadLocalPerformance();
  }, [loadLocalPerformance]);

  const autoSelectedLocalReport = useMemo(() => {
    const items = (localPreview?.reports || []).filter(
      (r) => Number.isFinite(r.fpsAverage) && r.fpsAverage > 0 && (r.samples || 0) >= 10,
    );
    if (items.length === 0) return null;
    return (
      items.find((r) => r.snapshotAvailable && r.cpu && r.gpu && r.ramGb > 0 && r.graphics.width && r.graphics.height) ||
      items.find((r) => r.snapshotAvailable && r.cpu && r.gpu && r.ramGb > 0) ||
      items[0]
    );
  }, [localPreview]);

  // Tự động chọn phiên FPS đo được và đồng bộ lên trang game cộng đồng khi dữ liệu thay đổi
  useEffect(() => {
    const gameId = localGame?.localGameId;
    if (
      loading ||
      !me?.uid ||
      !gameId ||
      !localAutoShareEnabled ||
      !autoSelectedLocalReport ||
      !window.electronAPI?.syncGamePerformance
    ) {
      return;
    }
    const alreadySynced = reports.items.some(
      (r) =>
        r.uid === me.uid &&
        Math.abs(r.fpsAverage - autoSelectedLocalReport.fpsAverage) < 0.05 &&
        r.measuredAt === autoSelectedLocalReport.measuredAt,
    );
    if (alreadySynced) return;
    const syncKey = `${game.gameKey}:${autoSelectedLocalReport.sessionId}:${autoSelectedLocalReport.fpsAverage}:${autoSelectedLocalReport.measuredAt}`;
    if (autoSyncedPerfKeys.current.has(syncKey)) return;
    autoSyncedPerfKeys.current.add(syncKey);

    let cancelled = false;
    void window.electronAPI
      .syncGamePerformance(gameId)
      .then((res) => {
        if (!cancelled && res?.synced) {
          return api
            .request<Page<PerformanceReport>>(`${base}/performance`)
            .then((next) => {
              if (!cancelled) setReports(next);
            });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    api,
    autoSelectedLocalReport,
    base,
    game.gameKey,
    loading,
    localAutoShareEnabled,
    localGame?.localGameId,
    me?.uid,
    reports.items,
  ]);

  // Tự tải lại FPS đo cục bộ khi game được cập nhật (ví dụ vừa xong phiên chơi hoặc vừa đồng bộ AMD)
  useEffect(() => {
    const gameId = localGame?.localGameId;
    if (!gameId || !window.electronAPI?.onGameUpdated) return;
    return window.electronAPI.onGameUpdated((updatedGame) => {
      if (updatedGame?.id === gameId) {
        void loadLocalPerformance();
      }
    });
  }, [loadLocalPerformance, localGame?.localGameId]);

  const enableLocalFps = async () => {
    if (!window.electronAPI?.saveSettings) return;
    setSettingUpLocalFps(true);
    setLocalPreviewError("");
    try {
      const result = await setupFpsCapture();
      if (!result.ok) {
        setLocalPreviewError(result.error || "Không thể bật đo FPS.");
        return;
      }
      await window.electronAPI.saveSettings({ fpsAutoCaptureEnabled: true });
      setLocalAutoCaptureEnabled(true);
      onToast?.("Đã bật đo FPS. Phiên chơi tiếp theo sẽ được lưu sau khi thoát game.");
      const status = await window.electronAPI.getFpsStatus?.();
      if (status) setLocalFpsStatus(status);
    } catch (e) {
      setLocalPreviewError(communityError(e));
    } finally {
      setSettingUpLocalFps(false);
    }
  };

  const toggleLocalAutoShare = async (enabled: boolean) => {
    if (!window.electronAPI?.saveSettings) return;
    const previous = localAutoShareEnabled;
    setLocalAutoShareEnabled(enabled);
    try {
      await window.electronAPI.saveSettings({ fpsAutoShareEnabled: enabled });
    } catch (e) {
      setLocalAutoShareEnabled(previous);
      setLocalPreviewError(communityError(e));
    }
  };

  const load = useCallback(async () => {
    const ticket = ++loadSequence.current;
    setLoading(true);
    setError("");
    setSteamError("");
    setReviewsLoading(true);
    setReviewsError("");
    const results = await Promise.allSettled([
      api.request<SteamRequirements>(`${base}/requirements`),
      api.request<Page<PerformanceReport>>(`${base}/performance`),
      api.request<Page<CommunityReview>>(`${base}/reviews`).then(
        (value) => {
          if (ticket === loadSequence.current) {
            setReviews(value);
            setReviewsLoading(false);
          }
          return value;
        },
        (reason) => {
          if (ticket === loadSequence.current) {
            setReviewsError(communityError(reason));
            setReviewsLoading(false);
          }
          throw reason;
        },
      ),
      api.request<Page<CommunityPost>>(
        `/posts?gameKey=${encodeURIComponent(game.gameKey)}&excludeKind=review`,
      ),
    ]);
    if (ticket !== loadSequence.current) return;
    if (results[0].status === "fulfilled") setRequirements(results[0].value);
    else {
      setRequirements(null);
      setSteamError(communityError(results[0].reason));
    }
    if (results[1].status === "fulfilled") setReports(results[1].value);
    else setError(communityError(results[1].reason));
    if (results[3].status === "fulfilled") setPosts(results[3].value);
    else setError(communityError(results[3].reason));
    setLoading(false);
    setPlayersRevision((value) => value + 1);
  }, [api, base, game.gameKey, me?.uid]);

  useEffect(() => {
    setHubTab("overview");
    setReports(emptyPage());
    setReviews(emptyPage());
    setPosts(emptyPage());
    setRequirements(null);
    setGpu("");
    setResolution("");
    setPreset("");
    setReviewFormOpen(false);
    setPostComposerOpen(false);
    void load();
    return () => { loadSequence.current++; };
  }, [load]);

  const myReview = useMemo(
    () => reviews.items.find((r) => r.uid === me?.uid) || null,
    [reviews.items, me?.uid],
  );

  useEffect(() => {
    if (myReview) {
      setScore(myReview.score);
      setReview(myReview.review);
      setReviewSpoiler(myReview.spoiler);
      setDropped(myReview.dropped);
    }
  }, [myReview]);

  const refreshPost = async (id: string) => {
    try {
      const latest = await api.request<CommunityPost>(`/posts/${id}`);
      setPosts((previous) => ({
        ...previous,
        items: previous.items.map((p) => (p.id === id ? latest : p)),
      }));
    } catch (e) {
      if (/not found/.test(String((e as Error).message))) {
        setPosts((previous) => ({
          ...previous,
          items: previous.items.filter((p) => p.id !== id),
        }));
        const current = await api.request<Page<CommunityReview>>(
          `${base}/reviews`,
        );
        setReviews(current);
      } else setError(communityError(e));
    }
  };

  const loadPerformance = async (
    more = false,
    overrides?: { gpu?: string; resolution?: string; preset?: string },
  ) => {
    setBusy(true);
    try {
      const activeGpu = overrides?.gpu ?? gpu;
      const activeRes = overrides?.resolution ?? resolution;
      const activePreset = overrides?.preset ?? preset;
      const params = new URLSearchParams({
        offset: String(more ? reports.nextOffset : 0),
      });
      if (activeGpu) params.set("gpu", activeGpu);
      if (activeRes) {
        const [w, h] = activeRes.split("x");
        params.set("width", w);
        params.set("height", h);
      }
      if (activePreset) params.set("preset", activePreset);
      const next = await api.request<Page<PerformanceReport>>(
        `${base}/performance?${params}`,
      );
      setReports(
        more
          ? {
              ...next,
              items: [...reports.items, ...next.items],
            }
          : next,
      );
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };

  const minSpecs = useMemo(
    () => parseSteamRequirements(requirements?.minimum),
    [requirements?.minimum],
  );
  const recSpecs = useMemo(
    () => parseSteamRequirements(requirements?.recommended),
    [requirements?.recommended],
  );

  const perfStats = useMemo(() => {
    const items = reports.items;
    if (!items.length) return null;
    const avg =
      items.reduce((acc, r) => acc + r.fpsAverage, 0) / items.length;
    const min = Math.min(...items.map((r) => r.fpsAverage));
    const max = Math.max(...items.map((r) => r.fpsAverage));
    const verified = items.filter((r) => r.source === "presentmon").length;
    return { count: items.length, avg, min, max, verified };
  }, [reports.items]);

  const reviewStats = useMemo(() => {
    const items = reviews.items;
    if (!items.length) return null;
    const avg = items.reduce((acc, r) => acc + r.score, 0) / items.length;
    const dropCount = items.filter((r) => r.dropped).length;
    return { count: items.length, avg, dropCount };
  }, [reviews.items]);

  const coverImg = activeGame.coverUrl
    ? qualifyCommunityUrl(api.publicBase, activeGame.coverUrl)
    : "";

  return (
    <section className="gv-stack">
      <div className="gv-top">
        <button type="button" className="gv-link" onClick={onBack}>
          <ArrowLeft size={16} />
          {backLabel}
        </button>
        <div className="gv-actions">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={15} />
            Làm mới
          </button>
          {onAdd && !localGame && (
            <button
              type="button"
              className="gv-primary"
              onClick={() =>
                void onAdd(activeGame)
                  .then(() => {
                    setNotice("Đã thêm game vào danh sách Chờ chơi.");
                    onToast?.("Đã thêm vào Chờ chơi.");
                  })
                  .catch((e) => setError(communityError(e)))
              }
            >
              <BookmarkPlus size={15} />
              Thêm vào Chờ chơi
            </button>
          )}
          {localGame?.localGameId && onLocalGame && (
            <button
              type="button"
              className="gv-btn-cyan"
              onClick={() => onLocalGame(localGame.localGameId!)}
            >
              Mở trong thư viện
            </button>
          )}
        </div>
      </div>

      {/* Hero Header */}
      <div className="gv-game-hero">
        {coverImg ? (
          <img
            className="gv-game-hero-cover"
            src={coverImg}
            alt={`Ảnh bìa ${activeGame.title}`}
          />
        ) : (
          <div
            className="gv-game-hero-cover"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6b7386",
            }}
          >
            No Cover
          </div>
        )}

        <div className="gv-stack" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{activeGame.title}</h1>

            {/* Compact Community Rating Showcase */}
            <div
              className="gv-meta-rating-card"
              role="button"
              tabIndex={0}
              onClick={() => setHubTab("reviews")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setHubTab("reviews");
                }
              }}
              title="Nhấn để xem chi tiết các đánh giá cộng đồng"
            >
              <div className="gv-meta-score-box-wrap">
                <div
                  className={`gv-meta-score-badge gv-meta-${getMetacriticTier(reviewStats?.avg)}`}
                >
                  {reviewStats && reviewStats.count > 0
                    ? formatScore(reviewStats.avg)
                    : "--"}
                </div>
                <div className="gv-meta-score-details">
                  <div className="gv-meta-score-headline">
                    <span
                      className={`gv-meta-verdict gv-meta-text-${getMetacriticTier(reviewStats?.avg)}`}
                    >
                      {getMetacriticVerdict(reviewStats?.avg, reviewStats?.count ?? 0)}
                    </span>
                  </div>
                  <div className="gv-meta-stats-row">
                    <span className="gv-meta-count">
                      <strong>{reviewStats?.count ?? 0}</strong> đánh giá
                    </span>
                    {reviewStats && reviewStats.dropCount > 0 && (
                      <>
                        <span className="gv-meta-sep">·</span>
                        <span className="gv-meta-drop">
                          {reviewStats.dropCount} bỏ dở
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {perfStats && (
                <div
                  className="gv-meta-perf-box"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHubTab("specs");
                  }}
                  title="Nhấn để xem chi tiết cấu hình & FPS"
                >
                  <div className="gv-meta-perf-icon">
                    <Gauge size={18} />
                  </div>
                  <div>
                    <div className="gv-meta-perf-label">Hiệu năng cộng đồng</div>
                    <div className="gv-meta-perf-value">
                      TB <strong>{perfStats.avg.toFixed(0)} FPS</strong>
                      <span className="gv-meta-sub"> ({perfStats.count} benchmark)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {requirements?.description && (
            <p style={{ color: "#d4d8e4", fontSize: 14, margin: "4px 0 8px 0", lineHeight: 1.5 }}>
              {requirements.description}
            </p>
          )}

          <div className="gv-actions" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {requirements?.genres?.map((g) => (
              <span key={g} className="gv-pill">
                {g}
              </span>
            ))}
            {!!requirements?.developers?.length && (
              <span className="gv-muted" style={{ fontSize: 13 }}>
                · Phát triển: <strong style={{ color: "#cbd5e1" }}>{requirements.developers.join(", ")}</strong>
              </span>
            )}
            {requirements?.releaseDate && (
              <span className="gv-muted" style={{ fontSize: 13 }}>
                · Phát hành: <strong style={{ color: "#cbd5e1" }}>{requirements.releaseDate}</strong>
              </span>
            )}
            {requirements?.sourceUrl && (
              <a
                className="gv-pill gv-pill-cyan"
                href={requirements.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: 4 }}
              >
                Steam Store <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="gv-error">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="gv-notice">
          <span>{notice}</span>
        </div>
      )}

      {/* GameHub Sub-navigation */}
      <div className="gv-nav-bar" role="tablist" aria-label="Chi tiết game cộng đồng">
        <button
          type="button"
          role="tab"
          aria-pressed={hubTab === "overview"}
          onClick={() => setHubTab("overview")}
        >
          <Sparkles size={15} />
          Tổng quan
        </button>
        <button
          type="button"
          role="tab"
          aria-pressed={hubTab === "reviews"}
          onClick={() => setHubTab("reviews")}
        >
          <Star size={15} />
          Đánh giá ({reviews.items.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-pressed={hubTab === "posts"}
          onClick={() => setHubTab("posts")}
        >
          <MessageSquareText size={15} />
          Bài viết & Ảnh ({posts.items.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-pressed={hubTab === "players"}
          onClick={() => setHubTab("players")}
        >
          <Users size={15} />
          Người chơi
        </button>
        <button
          type="button"
          role="tab"
          aria-pressed={hubTab === "specs"}
          onClick={() => setHubTab("specs")}
        >
          <Cpu size={15} />
          Cấu hình & FPS ({reports.items.length})
        </button>
      </div>

      {/* TAB 0: TỔNG QUAN (THÔNG TIN + ĐIỂM + ĐÁNH GIÁ ĐẦU, FPS Ở CUỐI) */}
      {hubTab === "overview" && (
        <div className="gv-stack">
          {/* 1. Đánh giá nổi bật từ người chơi */}
          <div className="gv-card gv-stack">
            <div className="gv-top">
              <div>
                <h2>Đánh giá từ người chơi</h2>
                <p className="gv-muted">
                  {reviewStats
                    ? `Điểm trung bình ${formatScore(reviewStats.avg)}/10 từ ${reviewStats.count} người chơi${reviewStats.dropCount > 0 ? ` (${reviewStats.dropCount} đã bỏ game)` : ""}.`
                    : "Chưa có đánh giá nào cho game này."}
                </p>
              </div>
              <div className="gv-actions">
                <button
                  type="button"
                  className="gv-primary"
                  onClick={() => {
                    if (!me) {
                      void api.signIn().catch((e) => setError(communityError(e)));
                      return;
                    }
                    setHubTab("reviews");
                    setReviewFormOpen(true);
                  }}
                >
                  {myReview ? (
                    <>
                      <Pencil size={15} /> Sửa đánh giá
                    </>
                  ) : (
                    <>
                      <Star size={15} /> Viết đánh giá
                    </>
                  )}
                </button>
                {reviews.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setHubTab("reviews")}
                  >
                    Xem tất cả ({reviews.items.length})
                    <ChevronRight size={15} />
                  </button>
                )}
              </div>
            </div>

            {reviewsLoading && <p role="status" className="gv-muted">Đang tải đánh giá…</p>}
            {reviewsError && (
              <div role="alert" className="gv-error">
                <span>{reviewsError}</span>
                <button type="button" onClick={() => void load()}>Thử lại</button>
              </div>
            )}
            {reviews.items.length === 0 && !reviewsLoading && !reviewsError ? (
              <div className="gv-empty">
                <p>Chưa có đánh giá nào. Hãy là người đầu tiên chia sẻ cảm nhận!</p>
              </div>
            ) : (
              <div className="gv-stack">
                {reviews.items.slice(0, 3).map((r) => (
                  <ReviewItem
                    key={r.id}
                    review={r}
                    me={me}
                    publicBase={api.publicBase}
                    onProfile={onProfile}
                    onEdit={
                      me?.uid === r.uid
                        ? () => {
                            setHubTab("reviews");
                            setReviewFormOpen(true);
                          }
                        : undefined
                    }
                    onReport={() =>
                      me
                        ? setReportTarget({ type: "review", id: r.id })
                        : void api
                            .signIn()
                            .catch((e) => setError(communityError(e)))
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* 2. Yêu cầu cấu hình từ Steam */}
          <div className="gv-card gv-stack">
            <div className="gv-top">
              <div>
                <h2>Yêu cầu cấu hình từ Steam</h2>
                <p className="gv-muted">
                  Thông số chính thức từ trang cửa hàng Steam.
                </p>
              </div>
              {requirements?.fetchedAt && (
                <span className="gv-muted" style={{ fontSize: 12 }}>
                  Cập nhật:{" "}
                  {new Date(requirements.fetchedAt).toLocaleDateString("vi-VN")}
                </span>
              )}
            </div>

            {steamError ? (
              <div className="gv-empty">
                <p>{steamError}</p>
                <button type="button" onClick={() => void load()}>
                  Thử lại
                </button>
              </div>
            ) : (
              <div className="gv-spec-grid">
                <div className="gv-card-subtle gv-stack-sm">
                  <span className="gv-pill gv-pill-amber" style={{ width: "fit-content" }}>
                    Cấu hình Tối thiểu
                  </span>
                  {minSpecs.length > 0 ? (
                    <div className="gv-spec-table">
                      {minSpecs.map((row, idx) => (
                        <div className="gv-spec-item" key={idx}>
                          <span className="gv-spec-key">{row.label}</span>
                          <span className="gv-spec-val">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="gv-muted">
                      {loading
                        ? "Đang tải từ Steam…"
                        : "Steam chưa cung cấp cấu hình tối thiểu."}
                    </p>
                  )}
                </div>

                <div className="gv-card-subtle gv-stack-sm">
                  <span className="gv-pill gv-pill-emerald" style={{ width: "fit-content" }}>
                    Cấu hình Đề nghị
                  </span>
                  {recSpecs.length > 0 ? (
                    <div className="gv-spec-table">
                      {recSpecs.map((row, idx) => (
                        <div className="gv-spec-item" key={idx}>
                          <span className="gv-spec-key">{row.label}</span>
                          <span className="gv-spec-val">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="gv-muted">
                      {loading
                        ? "Đang tải từ Steam…"
                        : "Steam chưa công bố cấu hình đề nghị."}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Mục FPS thực tế ở cuối */}
          <div className="gv-card gv-stack">
            <div className="gv-top">
              <div>
                <h2>FPS & cấu hình thực tế</h2>
                <p className="gv-muted">
                  {perfStats
                    ? `Trung bình ${perfStats.avg.toFixed(0)} FPS (từ ${perfStats.min.toFixed(0)} đến ${perfStats.max.toFixed(0)} FPS) qua ${perfStats.count} báo cáo.`
                    : "Phiên đo trên máy bạn và báo cáo từ người chơi khác."}
                </p>
              </div>
              <div className="gv-actions">
                <button
                  type="button"
                  onClick={() => setHubTab("specs")}
                >
                  Lọc &amp; Xem tất cả ({reports.items.length})
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>

            {autoSelectedLocalReport &&
              !reports.items.some((item) => item.uid && item.uid === me?.uid) &&
              (() => {
                const r = autoSelectedLocalReport;
                return (
                  <div className="gv-stack-sm">
                    <div className="gv-perf-section-label">Phiên đo trên máy bạn (đang chờ đồng bộ)</div>
                    <article className="gv-perf-card">
                      <div className="gv-stack-sm">
                        <div className="gv-actions" style={{ gap: 10 }}>
                          <Avatar name={me?.nickname || "Bạn"} url={me?.avatarUrl} size={36} />
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#f1f3f7" }}>
                              {me?.nickname || "Máy của bạn"}
                            </div>
                            <div className="gv-actions" style={{ gap: 6, marginTop: 2 }}>
                              <span className="gv-pill gv-pill-cyan">Máy bạn · Tự chọn đồng bộ</span>
                              <span className="gv-pill gv-pill-emerald">Tự đo</span>
                              <span className="gv-muted" style={{ fontSize: 12 }}>
                                {new Date(r.measuredAt).toLocaleString("vi-VN")}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          <Monitor size={14} style={{ display: "inline", marginRight: 6 }} />
                          {r.gpu || localHardware?.gpus?.map((g) => g.name).filter(Boolean).join(" / ") || "GPU chưa nhận diện"} ·{" "}
                          {r.cpu || localHardware?.cpu_name || "CPU chưa nhận diện"} ·{" "}
                          {(r.ramGb > 0 ? r.ramGb : localHardware?.ram_gb || 0) > 0
                            ? `${r.ramGb > 0 ? r.ramGb : localHardware?.ram_gb} GB RAM`
                            : "RAM chưa nhận diện"}
                        </div>
                        <div className="gv-actions" style={{ gap: 6 }}>
                          <span className="gv-pill gv-pill-cyan">
                            {r.graphics.width && r.graphics.height
                              ? `${r.graphics.width}×${r.graphics.height}`
                              : localHardware?.display?.width && localHardware?.display?.height
                                ? `${localHardware.display.width}×${localHardware.display.height} (Màn hình)`
                                : "Chưa nhận diện độ phân giải"}
                          </span>
                          <span className="gv-pill">{r.graphics.preset || "Mức đồ họa chưa nhận diện"}</span>
                        </div>
                      </div>
                      <div className="gv-fps-box">
                        <div className="gv-fps-big">{r.fpsAverage.toFixed(1)}</div>
                        <div className="gv-muted" style={{ fontSize: 11 }}>AVG FPS</div>
                        <div className="gv-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          1% Low: {r.fpsLow != null ? r.fpsLow.toFixed(1) : "—"}
                        </div>
                      </div>
                    </article>
                  </div>
                );
              })()}

            {reports.items.length > 0 ? (
              <div className="gv-stack">
                {reports.items.slice(0, 5).map((r) => (
                  <article className="gv-perf-card" key={r.id}>
                    <div className="gv-stack-sm">
                      <div className="gv-actions" style={{ gap: 10 }}>
                        <Avatar name={r.nickname} url={r.avatarUrl} size={36} />
                        <div>
                          <div className="gv-actions" style={{ gap: 8 }}>
                            {r.uid ? (
                              <button
                                type="button"
                                className="gv-link"
                                onClick={() => onProfile(r.uid!)}
                                style={{ padding: 0, fontWeight: 700, fontSize: 14, color: "#f1f3f7" }}
                              >
                                {r.nickname}
                                {r.uid === me?.uid ? " (Bạn)" : ""}
                              </button>
                            ) : (
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{r.nickname}</span>
                            )}
                            {r.source === "presentmon" && (
                              <span className="gv-pill gv-pill-emerald">
                                <CheckCircle2 size={11} /> PresentMon
                              </span>
                            )}
                            <span className="gv-pill">
                              {r.completionStatus === "completed" ? "Đã hoàn thành" : "Đã chơi"}
                            </span>
                          </div>
                          <div className="gv-muted" style={{ fontSize: 12, marginTop: 2 }}>
                            {new Date(r.measuredAt).toLocaleDateString("vi-VN")}
                            {r.samples > 0 ? ` · ${r.samples.toLocaleString("vi-VN")} frames` : ""}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        <Monitor size={14} style={{ display: "inline", marginRight: 6 }} />
                        {r.gpu} · {r.cpu} · {r.ramGb} GB RAM
                      </div>
                      <div className="gv-actions" style={{ gap: 6, flexWrap: "wrap" }}>
                        <span className="gv-pill gv-pill-cyan">
                          {r.graphics.width && r.graphics.height
                            ? `${r.graphics.width}×${r.graphics.height}`
                            : "Chưa nhận diện độ phân giải"}
                        </span>
                        <span className="gv-pill">
                          {r.graphics.preset || "Chưa nhận diện preset"}
                        </span>
                        {r.graphics.upscaling && r.graphics.upscaling !== "Off" && (
                          <span className="gv-pill">Upscaling: {r.graphics.upscaling}</span>
                        )}
                      </div>
                    </div>
                    <div className="gv-fps-box">
                      <div className="gv-fps-big">{r.fpsAverage.toFixed(1)}</div>
                      <div className="gv-muted" style={{ fontSize: 11 }}>AVG FPS</div>
                      {r.fpsLow != null && (
                        <div className="gv-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          1% Low: {r.fpsLow.toFixed(1)}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              !loading && (
                <div className="gv-empty">
                  <p>Chưa có báo cáo cộng đồng cho game này. Phiên đo trên máy bạn sẽ hiện riêng khi có dữ liệu.</p>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* TAB 1: CẤU HÌNH & HIỆU NĂNG THẬT */}
      {hubTab === "specs" && (
        <div className="gv-stack">
          <div className="gv-card gv-stack">
            <div className="gv-top">
              <div>
                <h2>Yêu cầu cấu hình từ Steam</h2>
                <p className="gv-muted">
                  Thông số chính thức từ trang cửa hàng Steam.
                </p>
              </div>
              {requirements?.fetchedAt && (
                <span className="gv-muted" style={{ fontSize: 12 }}>
                  Cập nhật:{" "}
                  {new Date(requirements.fetchedAt).toLocaleDateString("vi-VN")}
                </span>
              )}
            </div>

            {steamError ? (
              <div className="gv-empty">
                <p>{steamError}</p>
                <button type="button" onClick={() => void load()}>
                  Thử lại
                </button>
              </div>
            ) : (
              <div className="gv-spec-grid">
                <div className="gv-card-subtle gv-stack-sm">
                  <span className="gv-pill gv-pill-amber" style={{ width: "fit-content" }}>
                    Cấu hình Tối thiểu
                  </span>
                  {minSpecs.length > 0 ? (
                    <div className="gv-spec-table">
                      {minSpecs.map((row, idx) => (
                        <div className="gv-spec-item" key={idx}>
                          <span className="gv-spec-key">{row.label}</span>
                          <span className="gv-spec-val">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="gv-muted">
                      {loading
                        ? "Đang tải từ Steam…"
                        : "Steam chưa cung cấp cấu hình tối thiểu."}
                    </p>
                  )}
                </div>

                <div className="gv-card-subtle gv-stack-sm">
                  <span className="gv-pill gv-pill-emerald" style={{ width: "fit-content" }}>
                    Cấu hình Đề nghị
                  </span>
                  {recSpecs.length > 0 ? (
                    <div className="gv-spec-table">
                      {recSpecs.map((row, idx) => (
                        <div className="gv-spec-item" key={idx}>
                          <span className="gv-spec-key">{row.label}</span>
                          <span className="gv-spec-val">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="gv-muted">
                      {loading
                        ? "Đang tải từ Steam…"
                        : "Steam chưa công bố cấu hình đề nghị."}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {localGame?.localGameId && (
            <section className="gv-stack">
              <div className="gv-top">
                <div>
                  <h2>FPS đo trên máy bạn</h2>
                  <p className="gv-muted">
                    App tự động quét từ PresentMon / AMD GameReport, tự chọn phiên đại diện và đồng bộ lên Cộng đồng khi có dữ liệu mới.
                  </p>
                </div>
                <div className="gv-actions">
                  {localFpsStatus && (
                    <span className={`gv-pill ${localAutoCaptureEnabled && localFpsStatus.ready ? "gv-pill-emerald" : "gv-pill-amber"}`}>
                      {!localAutoCaptureEnabled
                        ? "Đo FPS đang tắt"
                        : localFpsStatus.ready
                          ? "Đo FPS sẵn sàng"
                          : "Cần thiết lập"}
                    </span>
                  )}
                  {(!localAutoCaptureEnabled || !localFpsStatus?.ready) && (
                    <button
                      type="button"
                      className="gv-btn-cyan"
                      disabled={settingUpLocalFps}
                      onClick={() => void enableLocalFps()}
                    >
                      {settingUpLocalFps ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
                      {settingUpLocalFps ? "Đang bật đo..." : "Bật đo FPS"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="gv-icon-btn"
                    aria-label="Tải lại các phiên FPS trên máy"
                    title="Tải lại các phiên FPS trên máy"
                    disabled={localPreviewLoading}
                    onClick={() => void loadLocalPerformance()}
                  >
                    <RefreshCw size={15} className={localPreviewLoading ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              <label className="gv-check">
                <input
                  type="checkbox"
                  checked={localAutoShareEnabled}
                  disabled={!localAutoCaptureEnabled}
                  onChange={(e) => void toggleLocalAutoShare(e.target.checked)}
                />
                <span>Tự chia sẻ FPS và cấu hình nhận diện được lên Cộng đồng sau mỗi phiên hợp lệ</span>
              </label>

              {localPreviewLoading ? (
                <p className="gv-muted" role="status">Đang tải các phiên đã đo…</p>
              ) : localPreviewError ? (
                <div className="gv-error" role="alert">
                  <span>{localPreviewError}</span>
                  <button type="button" onClick={() => void loadLocalPerformance()}>Thử lại</button>
                </div>
              ) : localPreview?.reports.length ? (
                <div className="gv-stack" style={{ maxHeight: 420, overflowY: "auto" }}>
                  {localPreview.reports.map((r) => (
                    <article className="gv-perf-card" key={r.sessionId}>
                      <div className="gv-stack-sm">
                        <div className="gv-actions" style={{ gap: 8 }}>
                          <span className="gv-muted" style={{ fontSize: 12 }}>
                            {new Date(r.measuredAt).toLocaleString("vi-VN")}
                          </span>
                          <span className="gv-pill gv-pill-emerald">Tự đo</span>
                          {autoSelectedLocalReport?.sessionId === r.sessionId && (
                            <span className="gv-pill gv-pill-cyan">
                              <CheckCircle2 size={11} /> Tự chọn đồng bộ Cộng đồng
                            </span>
                          )}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          <Monitor size={14} style={{ display: "inline", marginRight: 6 }} />
                          {r.gpu || localHardware?.gpus?.map((g) => g.name).filter(Boolean).join(" / ") || "GPU chưa nhận diện"} ·{" "}
                          {r.cpu || localHardware?.cpu_name || "CPU chưa nhận diện"} ·{" "}
                          {(r.ramGb > 0 ? r.ramGb : localHardware?.ram_gb || 0) > 0
                            ? `${r.ramGb > 0 ? r.ramGb : localHardware?.ram_gb} GB RAM`
                            : "RAM chưa nhận diện"}
                        </div>
                        <div className="gv-actions" style={{ gap: 6 }}>
                          <span className="gv-pill gv-pill-cyan">
                            {r.graphics.width && r.graphics.height
                              ? `${r.graphics.width}×${r.graphics.height}`
                              : localHardware?.display?.width && localHardware?.display?.height
                                ? `${localHardware.display.width}×${localHardware.display.height} (Màn hình)`
                                : "Chưa nhận diện độ phân giải"}
                          </span>
                          <span className="gv-pill">{r.graphics.preset || "Mức đồ họa chưa nhận diện"}</span>
                          <span className="gv-pill">
                            {r.graphics.source === "config"
                              ? "Đọc từ file cấu hình"
                              : r.graphics.source === "manual"
                                ? "Người chơi khai báo"
                                : "Chưa nhận diện cấu hình"}
                          </span>
                          {r.graphics.upscaling && <span className="gv-pill">Upscaling: {r.graphics.upscaling}</span>}
                          {r.graphics.frameGeneration && <span className="gv-pill">FG: {r.graphics.frameGeneration}</span>}
                          {r.graphics.rayTracing && <span className="gv-pill">RT: {r.graphics.rayTracing}</span>}
                        </div>
                      </div>
                      <div className="gv-fps-box">
                        <div className="gv-fps-big">{r.fpsAverage.toFixed(1)}</div>
                        <div className="gv-muted" style={{ fontSize: 11 }}>AVG FPS</div>
                        <div className="gv-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          1% low: {r.fpsLow != null ? r.fpsLow.toFixed(1) : "—"}
                        </div>
                        <div className="gv-muted" style={{ fontSize: 10, marginTop: 4 }}>
                          {r.samples.toLocaleString("vi-VN")} frames
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="gv-empty">
                  <h3>Chưa có phiên FPS trên máy này</h3>
                  <p>
                    Bật đo rồi chơi và thoát game. FPS và cấu hình sẽ được lưu theo phiên; thiết lập nào không đọc được sẽ được đánh dấu chưa nhận diện.
                  </p>
                  {!localFpsStatus?.ready && (
                    <p className="gv-muted">Windows sẽ hỏi quyền UAC một lần để tạo tác vụ đo nền.</p>
                  )}
                </div>
              )}
            </section>
          )}

          <div className="gv-card gv-stack">
            <div className="gv-top">
              <div>
                <h2>Báo cáo FPS từ Cộng đồng</h2>
                <p className="gv-muted">
                  Tự động đồng bộ phiên FPS mới nhất của người chơi khi có dữ liệu: FPS, 1% low, phần cứng và thiết lập nhận diện được.
                </p>
              </div>
              <button
                type="button"
                className="gv-icon-btn"
                title="Tải lại báo cáo Cộng đồng"
                aria-label="Tải lại báo cáo Cộng đồng"
                disabled={busy}
                onClick={() => void loadPerformance()}
              >
                <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
              </button>
            </div>

            {perfStats && (
              <div className="gv-perf-summary">
                <div className="gv-stat-box">
                  <span className="gv-muted">Số báo cáo</span>
                  <div className="gv-stat-val">{perfStats.count}</div>
                </div>
                <div className="gv-stat-box">
                  <span className="gv-muted">FPS trung bình</span>
                  <div className="gv-stat-val gv-text-emerald">
                    {perfStats.avg.toFixed(1)} FPS
                  </div>
                </div>
                <div className="gv-stat-box">
                  <span className="gv-muted">Khoảng FPS</span>
                  <div className="gv-stat-val">
                    {perfStats.min.toFixed(0)} – {perfStats.max.toFixed(0)}
                  </div>
                </div>
                <div className="gv-stat-box">
                  <span className="gv-muted">Đo bằng PresentMon</span>
                  <div className="gv-stat-val gv-text-cyan">
                    {perfStats.verified}/{perfStats.count}
                  </div>
                </div>
              </div>
            )}

            <form
              className="gv-card-subtle gv-stack-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void loadPerformance();
              }}
            >
              <div className="gv-spec-form">
                <label>
                  Lọc theo GPU
                  <input
                    maxLength={100}
                    value={gpu}
                    onChange={(e) => setGpu(e.target.value)}
                    placeholder="RTX 3060, RX 6600 XT..."
                  />
                </label>
                <label>
                  Độ phân giải
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                  >
                    <option value="">Tất cả</option>
                    {["1280x720", "1920x1080", "2560x1440", "3840x2160"].map(
                      (r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Mức đồ họa
                  <select
                    value={preset}
                    onChange={(e) => setPreset(e.target.value)}
                  >
                    <option value="">Tất cả</option>
                    {["Low", "Medium", "High", "Ultra", "Custom"].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="gv-actions" style={{ alignSelf: "end" }}>
                  <button type="submit" className="gv-btn-cyan" disabled={busy}>
                    Lọc
                  </button>
                  {(gpu || resolution || preset) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setGpu("");
                        setResolution("");
                        setPreset("");
                        void loadPerformance(false, {
                          gpu: "",
                          resolution: "",
                          preset: "",
                        });
                      }}
                    >
                      Xóa lọc
                    </button>
                  )}
                </div>
              </div>
            </form>

            {reports.items.length > 0 ? (
              <div className="gv-stack">
                {reports.items.map((r) => (
                  <article className="gv-perf-card" key={r.id}>
                    <div className="gv-stack-sm">
                      <div className="gv-actions" style={{ gap: 10 }}>
                        <Avatar name={r.nickname} url={r.avatarUrl} size={36} />
                        <button
                          type="button"
                          className="gv-link"
                          style={{ color: "#f1f3f7", padding: 0 }}
                          onClick={() => onProfile(r.uid!)}
                        >
                          {r.nickname}
                          {r.uid === me?.uid ? " (Bạn)" : ""}
                        </button>
                        <span
                          className={`gv-pill ${
                            r.source === "presentmon"
                              ? "gv-pill-emerald"
                              : "gv-pill-amber"
                          }`}
                        >
                          {r.source === "presentmon"
                            ? "PresentMon Verified"
                            : "Tự khai báo"}
                        </span>
                        <span className="gv-pill">
                          {r.completionStatus === "completed" ? "Đã hoàn thành" : "Đã chơi"}
                        </span>
                        <span className="gv-muted" style={{ fontSize: 12 }}>
                          {new Date(r.measuredAt).toLocaleDateString("vi-VN")}
                          {r.samples > 0
                            ? ` · ${r.samples.toLocaleString("vi-VN")} frames`
                            : ""}
                        </span>
                      </div>

                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        <Monitor
                          size={14}
                          style={{ display: "inline", marginRight: 6 }}
                        />
                        {r.gpu || "GPU chưa nhận diện"} · {r.cpu || "CPU chưa nhận diện"} · {r.ramGb > 0 ? `${r.ramGb} GB RAM` : "RAM chưa nhận diện"}
                      </div>

                      <div className="gv-actions" style={{ gap: 6 }}>
                        <span className="gv-pill gv-pill-cyan">
                          {r.graphics.width && r.graphics.height
                            ? `${r.graphics.width}×${r.graphics.height}`
                            : "Chưa nhận diện độ phân giải"}
                        </span>
                        <span className="gv-pill">{r.graphics.preset || "Mức đồ họa chưa nhận diện"}</span>
                        <span className="gv-pill">
                          {r.graphics.source === "config"
                            ? "Đọc từ file cấu hình"
                            : r.graphics.source === "manual"
                              ? "Người chơi khai báo"
                              : "Chưa nhận diện cấu hình"}
                        </span>
                        {r.graphics.upscaling && (
                          <span className="gv-pill">
                            Upscaling: {r.graphics.upscaling}
                          </span>
                        )}
                        {r.graphics.frameGeneration && (
                          <span className="gv-pill">
                            FG: {r.graphics.frameGeneration}
                          </span>
                        )}
                        {r.graphics.rayTracing && (
                          <span className="gv-pill">
                            RT: {r.graphics.rayTracing}
                          </span>
                        )}
                      </div>

                      {r.notes && <p className="gv-muted">{r.notes}</p>}

                      <div className="gv-actions">
                        <button
                          type="button"
                          className="gv-link"
                          onClick={() =>
                            me
                              ? setReportTarget({
                                  type: "performance",
                                  id: r.id!,
                                })
                              : void api
                                  .signIn()
                                  .catch((e) => setError(communityError(e)))
                          }
                        >
                          <Flag size={12} /> Báo cáo
                        </button>
                        {me?.uid === r.uid && (
                          <button
                            type="button"
                            className="gv-link"
                            style={{ color: "#fda4af" }}
                            onClick={() =>
                              void api
                                .request(`${base}/performance`, "DELETE")
                                .then(() => {
                                  onToast?.("Đã gỡ kết quả của bạn.");
                                  return loadPerformance();
                                })
                                .catch((e) => setError(communityError(e)))
                            }
                          >
                            <Trash2 size={12} /> Gỡ kết quả của tôi
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="gv-fps-box">
                      <div className="gv-fps-big">
                        {r.fpsAverage.toFixed(1)}
                      </div>
                      <div className="gv-muted" style={{ fontSize: 11 }}>
                        AVG FPS
                      </div>
                      {r.fpsLow != null && (
                        <div className="gv-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          1% Low: {r.fpsLow.toFixed(1)}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              !loading && (
                <div className="gv-empty">
                  <h3>Chưa có báo cáo cộng đồng</h3>
                  <p>
                    Báo cáo FPS và cấu hình sẽ xuất hiện khi người chơi bật tự chia sẻ hoặc gửi báo cáo thủ công.
                  </p>
                </div>
              )
            )}

            {reports.hasMore && (
              <button
                type="button"
                className="gv-pager"
                onClick={() => void loadPerformance(true)}
              >
                Xem thêm cấu hình
              </button>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ĐÁNH GIÁ & CHẤM ĐIỂM */}
      {hubTab === "reviews" && (
        <div className="gv-card gv-stack">
          <div className="gv-top">
            <div>
              <h2>Đánh giá từ người chơi</h2>
              <p className="gv-muted">
                {reviewStats
                  ? `Điểm trung bình ${formatScore(reviewStats.avg)}/10 từ ${reviewStats.count} người chơi (${reviewStats.dropCount} đã bỏ game).`
                  : "Chưa có đánh giá nào cho game này."}
              </p>
            </div>
            <button
              type="button"
              className="gv-primary"
              onClick={() =>
                me
                  ? setReviewFormOpen(!reviewFormOpen)
                  : void api.signIn().catch((e) => setError(communityError(e)))
              }
            >
              {reviewFormOpen ? (
                <>
                  <X size={15} /> Đóng
                </>
              ) : myReview ? (
                <>
                  <Pencil size={15} /> Sửa đánh giá của tôi
                </>
              ) : (
                <>
                  <Star size={15} /> Viết đánh giá
                </>
              )}
            </button>
          </div>

          {reviewFormOpen && me && (
            <form
              className="gv-card-subtle gv-stack"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void api
                  .request(`${base}/reviews`, "POST", {
                    title: activeGame.title,
                    coverUrl: activeGame.coverUrl,
                    score,
                    review,
                    spoiler: reviewSpoiler,
                    dropped,
                    playtimeMinutes: localGame?.playtimeMinutes ?? 0,
                  })
                  .then(() => {
                    setReviewFormOpen(false);
                    onToast?.("Đã đăng đánh giá công khai.");
                    return load();
                  })
                  .catch((e) => setError(communityError(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <div className="gv-stack-sm">
                <span className="gv-muted" style={{ fontSize: 12, fontWeight: 600 }}>
                  Chấm điểm: <strong>{score}/10</strong>
                </span>
                <div className="gv-score-picker">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`gv-score-btn ${score === n ? "gv-primary" : ""}`}
                      onClick={() => setScore(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={0.5}
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    style={{ width: 78 }}
                    aria-label="Điểm chi tiết"
                  />
                </div>
              </div>

              <label>
                Cảm nhận chi tiết
                <textarea
                  required
                  rows={4}
                  maxLength={4000}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  placeholder="Điểm hay, điểm dở, cốt truyện, gameplay, tối ưu... Ai nên chơi game này?"
                />
              </label>

              <div className="gv-top">
                <div className="gv-actions" style={{ gap: 16 }}>
                  <label className="gv-check">
                    <input
                      type="checkbox"
                      checked={reviewSpoiler}
                      onChange={(e) => setReviewSpoiler(e.target.checked)}
                    />
                    Có spoiler
                  </label>
                  <label className="gv-check">
                    <input
                      type="checkbox"
                      checked={dropped}
                      onChange={(e) => setDropped(e.target.checked)}
                    />
                    Tôi đã bỏ game này
                  </label>
                </div>

                <div className="gv-actions">
                  {myReview && (
                    <button
                      type="button"
                      className="gv-btn-danger"
                      disabled={busy}
                      onClick={() => setConfirmDeleteReview(true)}
                    >
                      <Trash2 size={14} /> Xóa đánh giá
                    </button>
                  )}
                  <button
                    className="gv-primary"
                    disabled={busy || !review.trim()}
                  >
                    {busy ? "Đang lưu…" : "Đăng đánh giá"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {reviewsLoading && <p role="status" className="gv-muted">Đang tải đánh giá…</p>}
          {reviewsError && (
            <div role="alert" className="gv-error">
              <span>{reviewsError}</span>
              <button type="button" onClick={() => void load()}>Thử lại</button>
            </div>
          )}
          {reviews.items.length === 0 && !reviewsLoading && !reviewsError ? (
            <div className="gv-empty">
              <p>Chưa có đánh giá nào. Hãy là người đầu tiên chia sẻ cảm nhận!</p>
            </div>
          ) : (
            <div className="gv-stack">
              {reviews.items.map((r) => (
                <ReviewItem
                  key={r.id}
                  review={r}
                  me={me}
                  publicBase={api.publicBase}
                  onProfile={onProfile}
                  onEdit={
                    me?.uid === r.uid ? () => setReviewFormOpen(true) : undefined
                  }
                  onReport={() =>
                    me
                      ? setReportTarget({ type: "review", id: r.id })
                      : void api
                          .signIn()
                          .catch((e) => setError(communityError(e)))
                  }
                />
              ))}
            </div>
          )}

          {reviews.hasMore && (
            <button
              type="button"
              className="gv-pager"
              onClick={() =>
                void api
                  .request<Page<CommunityReview>>(
                    `${base}/reviews?offset=${reviews.nextOffset}`,
                  )
                  .then((p) =>
                    setReviews({
                      ...p,
                      items: [...reviews.items, ...p.items],
                    }),
                  )
                  .catch((e) => setError(communityError(e)))
              }
            >
              Xem thêm đánh giá
            </button>
          )}
        </div>
      )}

      {/* TAB 3: BÀI VIẾT & ẢNH */}
      {hubTab === "posts" && (
        <div className="gv-stack">
          <div className="gv-top">
            <div>
              <h2>Bài viết và ảnh về {activeGame.title}</h2>
              <p className="gv-muted">
                Khoảnh khắc, câu hỏi và cảm nhận của cộng đồng.
              </p>
            </div>
            <button
              type="button"
              className="gv-primary"
              onClick={() =>
                me
                  ? setPostComposerOpen(!postComposerOpen)
                  : void api.signIn().catch((e) => setError(communityError(e)))
              }
            >
              {postComposerOpen ? (
                <>
                  <X size={15} /> Đóng
                </>
              ) : (
                <>
                  <Plus size={15} /> Đăng bài về game này
                </>
              )}
            </button>
          </div>

          {postComposerOpen && me && (
            <PostComposer
              api={api}
              game={activeGame}
              onPosted={() => {
                setPostComposerOpen(false);
                onToast?.("Đã đăng bài viết mới.");
                void load();
              }}
              onCancel={() => setPostComposerOpen(false)}
            />
          )}

          {posts.items.length === 0 && !loading ? (
            <div className="gv-empty">
              <p>Chưa có bài viết nào cho game này.</p>
            </div>
          ) : (
            <div className="gv-feed-grid">
              {posts.items.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  api={api}
                  me={me}
                  onChanged={() => void refreshPost(p.id)}
                  onGame={onGame}
                  onProfile={onProfile}
                  onToast={onToast}
                />
              ))}
            </div>
          )}

          {posts.hasMore && (
            <button
              type="button"
              className="gv-pager"
              onClick={() =>
                void api
                  .request<Page<CommunityPost>>(
                    `/posts?gameKey=${encodeURIComponent(game.gameKey)}&excludeKind=review&offset=${posts.nextOffset}`,
                  )
                  .then((p) =>
                    setPosts({
                      ...p,
                      items: [...posts.items, ...p.items],
                    }),
                  )
                  .catch((e) => setError(communityError(e)))
              }
            >
              Xem thêm bài viết
            </button>
          )}
        </div>
      )}

      {/* TAB 4: NGƯỜI CHƠI */}
      {hubTab === "players" && (
        <div className="gv-card">
          <GamePlayers
            key={playersRevision}
            api={api}
            gameKey={game.gameKey}
            myUid={me?.uid}
            onProfile={onProfile}
            localGame={localGame}
          />
        </div>
      )}

      <ConfirmModal
        open={confirmDeleteReview}
        title="Xóa đánh giá của bạn"
        message="Đánh giá này sẽ bị xóa khỏi trang game và Bảng tin cộng đồng."
        confirmLabel="Xóa đánh giá"
        danger
        busy={busy}
        onCancel={() => setConfirmDeleteReview(false)}
        onConfirm={() => {
          setBusy(true);
          void api
            .request(`${base}/reviews`, "DELETE")
            .then(() => {
              setReview("");
              setConfirmDeleteReview(false);
              setReviewFormOpen(false);
              onToast?.("Đã xóa đánh giá.");
              return load();
            })
            .catch((e) => setError(communityError(e)))
            .finally(() => setBusy(false));
        }}
      />

      <ReportModal
        open={!!reportTarget}
        title={
          reportTarget?.type === "performance"
            ? "Báo cáo cấu hình / FPS"
            : "Báo cáo đánh giá"
        }
        busy={busy}
        onCancel={() => setReportTarget(null)}
        onSubmit={(reason) => {
          if (!reportTarget) return;
          setBusy(true);
          void api
            .request("/reports", "POST", {
              targetType: reportTarget.type,
              targetId: reportTarget.id,
              reason,
            })
            .then(() => {
              setReportTarget(null);
              onToast?.("Đã gửi báo cáo.");
            })
            .catch((e) => setError(communityError(e)))
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}

function ReviewItem({
  review,
  me,
  publicBase,
  onProfile,
  onEdit,
  onReport,
}: {
  review: CommunityReview;
  me: PublicProfile | null;
  publicBase?: string;
  onProfile: (uid: string) => void;
  onEdit?: () => void;
  onReport: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const isVip = Boolean(review.vipTier && review.vipTier > 0);
  const vipTier = review.vipTier || (isVip ? 1 : 0);

  const bannerRaw = review.bannerUrl;
  const banner = bannerRaw ? qualifyCommunityUrl(publicBase || "", bannerRaw) : "";
  const [bannerFailed, setBannerFailed] = useState(false);
  useEffect(() => setBannerFailed(false), [banner]);

  return (
    <article className={`gv-review-card ${isVip ? `is-vip vip-tier-${vipTier}` : ""}`}>
      {/* Full-card Banner Backdrop */}
      {banner && !bannerFailed ? (
        <img
          className="gv-review-backdrop"
          src={banner}
          alt=""
          loading="lazy"
          onError={() => setBannerFailed(true)}
        />
      ) : (
        <div className="gv-review-backdrop-fallback" />
      )}
      <div className="gv-review-backdrop-fade" />

      <div className="gv-review-inner">
        <div className="gv-review-header">
          <div className="gv-review-author">
            <div
              className={`gv-review-avatar-frame ${isVip ? `vip-frame-tier-${vipTier}` : ""}`}
              onClick={() => onProfile(review.uid)}
              role="button"
              tabIndex={0}
              title={review.nickname}
            >
              <Avatar
                name={review.nickname}
                url={review.avatarUrl ? qualifyCommunityUrl(publicBase || "", review.avatarUrl) : undefined}
                size={42}
              />
              {isVip && (
                <span className="gv-vip-crown-badge">
                  <Crown size={10} />
                </span>
              )}
            </div>

            <div className="gv-review-user-info">
              <div className="gv-review-name-row">
                <button
                  type="button"
                  className="gv-review-user-name"
                  onClick={() => onProfile(review.uid)}
                >
                  {review.nickname}
                </button>

                {isVip && (
                  <span className="gv-vip-pill">
                    <Sparkles size={9} /> VIP
                  </span>
                )}

                <span className={`gv-review-score-capsule ${scoreTierClass(review.score)}`}>
                  <Star size={12} fill="currentColor" />
                  {formatScore(review.score)}/10
                </span>

                {review.dropped && (
                  <span className="gv-review-status-pill gv-pill-dropped">
                    <XCircle size={11} /> Đã bỏ game
                  </span>
                )}
              </div>

              <div className="gv-review-meta-row">
                {review.playtimeMinutes > 0 && (
                  <span className="gv-review-meta-item">
                    <Clock size={11} />
                    {minutesLabel(review.playtimeMinutes)}
                  </span>
                )}
                {review.playtimeMinutes > 0 && <span className="gv-review-meta-dot">·</span>}
                <span className="gv-review-meta-item">
                  {formatRelativeTime(review.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          <div className="gv-review-top-actions">
            {onEdit && (
              <button
                type="button"
                className="gv-review-btn-action"
                onClick={onEdit}
                title="Sửa đánh giá"
              >
                <Pencil size={11} /> Sửa
              </button>
            )}
            {me?.uid !== review.uid && (
              <button
                type="button"
                className="gv-review-btn-action"
                onClick={onReport}
                title="Báo cáo đánh giá"
              >
                <Flag size={11} /> Báo cáo
              </button>
            )}
          </div>
        </div>

        <div className="gv-review-content">
          {review.spoiler && !revealed ? (
            <div className="gv-review-spoiler-box">
              <div className="gv-review-spoiler-text">
                <ShieldAlert size={15} />
                <span>Đánh giá này có tiết lộ nội dung game (Spoiler).</span>
              </div>
              <button
                type="button"
                className="gv-review-btn-reveal"
                onClick={() => setRevealed(true)}
              >
                <Eye size={12} /> Xem nội dung
              </button>
            </div>
          ) : (
            <p className="gv-review-text">{review.review}</p>
          )}
        </div>
      </div>
    </article>
  );
}
