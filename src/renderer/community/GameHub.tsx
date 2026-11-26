import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookmarkPlus,
  Cpu,
  ExternalLink,
  Flag,
  Gauge,
  MessageSquareText,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  CommunityAdapter,
  CommunityPost,
  CommunityReview,
  Page,
  PerformanceReport,
  PublicGame,
  PublicProfile,
  SharedLibraryGame,
  SteamRequirements,
} from "../../shared/community.ts";
import {
  communityError,
  formatRelativeTime,
  minutesLabel,
  parseSteamRequirements,
  qualifyCommunityUrl,
} from "./client.ts";
import { GamePlayers } from "./GamePlayers.tsx";
import { PerformancePanel } from "./PerformancePanel.tsx";
import { PerformanceShareForm } from "./PerformanceShareForm.tsx";
import { PostCard } from "./PostCard.tsx";
import { PostComposer } from "./PostComposer.tsx";
import {
  Avatar,
  ConfirmModal,
  ReportModal,
  scoreTierClass,
} from "./CommunityWidgets.tsx";

const emptyPage = <T,>(): Page<T> => ({
  items: [],
  hasMore: false,
  nextOffset: 0,
});

type HubTab = "specs" | "reviews" | "posts" | "players";

export function GameHub({
  api,
  game,
  me,
  onBack,
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
  onGame: (g: PublicGame) => void;
  onProfile: (uid: string) => void;
  onAdd?: (g: PublicGame) => Promise<void>;
  localGame?: SharedLibraryGame;
  onLocalGame?: (id: number) => void;
  onToast?: (msg: string) => void;
}) {
  const [hubTab, setHubTab] = useState<HubTab>("specs");
  const [requirements, setRequirements] = useState<SteamRequirements | null>(
    null,
  );
  const [steamError, setSteamError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [reports, setReports] = useState<Page<PerformanceReport>>(emptyPage());
  const [reviews, setReviews] = useState<Page<CommunityReview>>(emptyPage());
  const [posts, setPosts] = useState<Page<CommunityPost>>(emptyPage());

  // Performance filter state
  const [gpu, setGpu] = useState("");
  const [resolution, setResolution] = useState("");
  const [preset, setPreset] = useState("");
  const [sharePerfOpen, setSharePerfOpen] = useState(false);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSteamError("");
    const results = await Promise.allSettled([
      api.request<SteamRequirements>(`${base}/requirements`),
      api.request<Page<PerformanceReport>>(`${base}/performance`),
      api.request<Page<CommunityReview>>(`${base}/reviews`),
      api.request<Page<CommunityPost>>(
        `/posts?gameKey=${encodeURIComponent(game.gameKey)}`,
      ),
    ]);
    if (results[0].status === "fulfilled") setRequirements(results[0].value);
    else {
      setRequirements(null);
      setSteamError(communityError(results[0].reason));
    }
    if (results[1].status === "fulfilled") setReports(results[1].value);
    else setError(communityError(results[1].reason));
    if (results[2].status === "fulfilled") setReviews(results[2].value);
    else setError(communityError(results[2].reason));
    if (results[3].status === "fulfilled") setPosts(results[3].value);
    else setError(communityError(results[3].reason));
    setLoading(false);
    setPlayersRevision((value) => value + 1);
  }, [api, base, game.gameKey]);

  useEffect(() => {
    setReports(emptyPage());
    setReviews(emptyPage());
    setPosts(emptyPage());
    setRequirements(null);
    setGpu("");
    setResolution("");
    setPreset("");
    setSharePerfOpen(false);
    setReviewFormOpen(false);
    setPostComposerOpen(false);
    void load();
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
          Quay lại Top game
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

        <div className="gv-stack">
          <div>
            <h1>{activeGame.title}</h1>
            <div className="gv-actions" style={{ marginTop: 10, gap: 8 }}>
              {reviewStats && (
                <span className={`gv-score-pill ${scoreTierClass(reviewStats.avg)}`}>
                  <Star size={14} />
                  {reviewStats.avg.toFixed(1)}/10 ({reviewStats.count} đánh giá)
                </span>
              )}
              {perfStats && (
                <span className="gv-pill gv-pill-emerald">
                  <Gauge size={12} />
                  TB {perfStats.avg.toFixed(0)} FPS ({perfStats.count} cấu hình thật)
                </span>
              )}
              {localGame && (
                <span className="gv-pill gv-pill-cyan">
                  Máy bạn: {minutesLabel(localGame.playtimeMinutes)} ·{" "}
                  {localGame.status === "completed"
                    ? "Đã phá đảo"
                    : localGame.status === "playing"
                      ? "Đang chơi"
                      : "Chưa phá đảo"}
                </span>
              )}
            </div>
          </div>

          {requirements?.description && (
            <p style={{ color: "#d4d8e4", fontSize: 14 }}>
              {requirements.description}
            </p>
          )}

          <div className="gv-actions" style={{ gap: 8 }}>
            {requirements?.genres?.map((g) => (
              <span key={g} className="gv-pill">
                {g}
              </span>
            ))}
            {!!requirements?.developers?.length && (
              <span className="gv-muted">
                · Phát triển: {requirements.developers.join(", ")}
              </span>
            )}
            {requirements?.releaseDate && (
              <span className="gv-muted">
                · Phát hành: {requirements.releaseDate}
              </span>
            )}
            {requirements?.sourceUrl && (
              <a
                className="gv-pill gv-pill-cyan"
                href={requirements.sourceUrl}
                target="_blank"
                rel="noreferrer"
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
          aria-pressed={hubTab === "specs"}
          onClick={() => setHubTab("specs")}
        >
          <Cpu size={15} />
          Cấu hình & FPS ({reports.items.length})
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
      </div>

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

          <div className="gv-card gv-stack">
            <div className="gv-top">
              <div>
                <h2>Cấu hình & FPS của người chơi thật</h2>
                <p className="gv-muted">
                  Kết quả từ những người chơi đã phá đảo (đo qua PresentMon hoặc tự khai báo).
                </p>
              </div>
              <button
                type="button"
                className="gv-primary"
                onClick={() =>
                  me
                    ? setSharePerfOpen(!sharePerfOpen)
                    : void api.signIn().catch((e) => setError(communityError(e)))
                }
              >
                {sharePerfOpen ? (
                  <>
                    <X size={15} /> Đóng biểu mẫu
                  </>
                ) : (
                  <>
                    <Plus size={15} /> Chia sẻ cấu hình & FPS
                  </>
                )}
              </button>
            </div>

            {sharePerfOpen && me && (
              <div>
                {localGame?.localGameId ? (
                  <PerformancePanel
                    gameId={localGame.localGameId}
                    status={localGame.status}
                    onShared={() => {
                      setSharePerfOpen(false);
                      void load();
                    }}
                  />
                ) : (
                  <PerformanceShareForm
                    api={api}
                    game={activeGame}
                    onShared={() => {
                      setSharePerfOpen(false);
                      void loadPerformance();
                    }}
                  />
                )}
              </div>
            )}

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
                        <Avatar name={r.nickname} size={30} />
                        <button
                          type="button"
                          className="gv-link"
                          style={{ color: "#f1f3f7", padding: 0 }}
                          onClick={() => onProfile(r.uid!)}
                        >
                          {r.nickname}
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
                        {r.gpu} · {r.cpu} · {r.ramGb} GB RAM
                      </div>

                      <div className="gv-actions" style={{ gap: 6 }}>
                        <span className="gv-pill gv-pill-cyan">
                          {r.graphics.width}×{r.graphics.height}
                        </span>
                        <span className="gv-pill">{r.graphics.preset}</span>
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
                  <h3>Chưa có báo cáo cấu hình thực tế</h3>
                  <p>
                    Hãy là người đầu tiên chia sẻ FPS và cấu hình máy đã chơi
                    game này!
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
                  ? `Điểm trung bình ${reviewStats.avg.toFixed(1)}/10 từ ${reviewStats.count} người chơi (${reviewStats.dropCount} đã bỏ game).`
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

          {reviews.items.length === 0 && !loading ? (
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
                    `/posts?gameKey=${encodeURIComponent(game.gameKey)}&offset=${posts.nextOffset}`,
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
  onProfile,
  onEdit,
  onReport,
}: {
  review: CommunityReview;
  me: PublicProfile | null;
  onProfile: (uid: string) => void;
  onEdit?: () => void;
  onReport: () => void;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <article className="gv-card-subtle gv-stack-sm">
      <div className="gv-top">
        <div className="gv-actions" style={{ gap: 10 }}>
          <Avatar name={review.nickname} url={review.avatarUrl} size={32} />
          <div>
            <div className="gv-actions" style={{ gap: 8 }}>
              <button
                type="button"
                className="gv-link"
                style={{ color: "#f1f3f7", padding: 0 }}
                onClick={() => onProfile(review.uid)}
              >
                {review.nickname}
              </button>
              <span className={`gv-score-pill ${scoreTierClass(review.score)}`}>
                <Star size={12} />
                {review.score}/10
              </span>
              {review.playtimeMinutes > 0 && (
                <span className="gv-pill">
                  {minutesLabel(review.playtimeMinutes)}
                </span>
              )}
              {review.dropped && (
                <span className="gv-pill gv-pill-accent">Đã bỏ game</span>
              )}
            </div>
            <span className="gv-muted" style={{ fontSize: 11 }}>
              {formatRelativeTime(review.updatedAt)}
            </span>
          </div>
        </div>

        <div className="gv-actions">
          {onEdit && (
            <button type="button" className="gv-link" onClick={onEdit}>
              <Pencil size={12} /> Sửa
            </button>
          )}
          {me?.uid !== review.uid && (
            <button type="button" className="gv-link" onClick={onReport}>
              <Flag size={12} /> Báo cáo
            </button>
          )}
        </div>
      </div>

      {review.spoiler && !revealed ? (
        <div className="gv-spoiler-box">
          <span>Đánh giá này có tiết lộ nội dung game.</span>
          <button type="button" onClick={() => setRevealed(true)}>
            Xem đánh giá
          </button>
        </div>
      ) : (
        <p className="gv-post-body">{review.review}</p>
      )}
    </article>
  );
}
