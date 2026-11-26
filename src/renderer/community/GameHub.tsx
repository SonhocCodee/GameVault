import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import type {
  CommunityAdapter,
  CommunityPost,
  CommunityReview,
  Page,
  PerformanceReport,
  PublicGame,
  PublicProfile,
  SteamRequirements,
  SharedLibraryGame,
} from "../../shared/community.ts";
import { communityError, minutesLabel, qualifyCommunityUrl } from "./client.ts";
import { GamePlayers } from "./GamePlayers.tsx";
import { PerformancePanel } from "./PerformancePanel.tsx";
import { PostCard } from "./PostCard.tsx";
import { PostComposer } from "./PostComposer.tsx";
import { PerformanceShareForm } from "./PerformanceShareForm.tsx";
const emptyPage = <T,>(): Page<T> => ({
  items: [],
  hasMore: false,
  nextOffset: 0,
});
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
}) {
  const [requirements, setRequirements] = useState<SteamRequirements | null>(
      null,
    ),
    [steamError, setSteamError] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [reports, setReports] = useState<Page<PerformanceReport>>(emptyPage()),
    [reviews, setReviews] = useState<Page<CommunityReview>>(emptyPage()),
    [posts, setPosts] = useState<Page<CommunityPost>>(emptyPage());
  const [gpu, setGpu] = useState(""),
    [resolution, setResolution] = useState(""),
    [preset, setPreset] = useState(""),
    [score, setScore] = useState(8),
    [review, setReview] = useState(""),
    [reviewSpoiler, setReviewSpoiler] = useState(false),
    [dropped, setDropped] = useState(false),
    [busy, setBusy] = useState(false);
  const [playersRevision, setPlayersRevision] = useState(0);
  const activeGame: PublicGame = {
    ...game,
    title: requirements?.title && requirements.title !== game.gameKey ? requirements.title : game.title,
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
    setPlayersRevision(value => value + 1);
  }, [api, base, game.gameKey]);
  useEffect(() => {
    setReports(emptyPage());
    setReviews(emptyPage());
    setPosts(emptyPage());
    setRequirements(null);
    setGpu("");
    setResolution("");
    setPreset("");
    void load();
  }, [load]);
  useEffect(() => {
    const mine = reviews.items.find((r) => r.uid === me?.uid);
    if (mine) {
      setScore(mine.score);
      setReview(mine.review);
      setReviewSpoiler(mine.spoiler);
      setDropped(mine.dropped);
    }
  }, [reviews, me?.uid]);
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
  const loadPerformance = async (more = false) => {
    setBusy(true);
    try {
      const params = new URLSearchParams({
        offset: String(more ? reports.nextOffset : 0),
      });
      if (gpu) params.set("gpu", gpu);
      if (resolution) {
        const [w, h] = resolution.split("x");
        params.set("width", w);
        params.set("height", h);
      }
      if (preset) params.set("preset", preset);
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
  const reportContent = async (type: string, id: string) => {
    if (!me) {
      await api.signIn();
      return;
    }
    const reason = window.prompt("Lý do báo cáo nội dung (tối đa 500 ký tự):");
    if (reason?.trim())
      await api.request("/reports", "POST", {
        targetType: type,
        targetId: id,
        reason: reason.slice(0, 500),
      });
    setNotice("Đã gửi báo cáo.");
  };
  return (
    <section>
      <button className="gv-link" onClick={onBack}>
        <ArrowLeft size={16} />
        Quay lại Khám phá
      </button>
      <div
        className="gv-top"
        style={{
          marginTop: 20,
        }}
      >
        <div>
          <h1>{activeGame.title}</h1>
          <p className="gv-muted">
            Cấu hình Steam, trải nghiệm thực tế và đánh giá từ cộng đồng.
          </p>
        </div>
        <div className="gv-actions">
          <button onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} />
            Làm mới
          </button>
          {onAdd && !localGame && (
            <button
              onClick={() =>
                void onAdd(activeGame)
                  .then(() => setNotice("Đã thêm vào Chờ chơi."))
                  .catch((e) => setError(communityError(e)))
              }
            >
              Thêm vào Chờ chơi
            </button>
          )}
        </div>
      </div>
      <div className="gv-game-overview">
        {activeGame.coverUrl && qualifyCommunityUrl(api.publicBase, activeGame.coverUrl) && <img src={qualifyCommunityUrl(api.publicBase, activeGame.coverUrl)} alt={`Ảnh bìa ${activeGame.title}`} />}
        <div>
          {requirements?.description && <p>{requirements.description}</p>}
          {!!requirements?.genres?.length && <p className="gv-muted">Thể loại: {requirements.genres.join(" · ")}</p>}
          {!!requirements?.developers?.length && <p className="gv-muted">Nhà phát triển: {requirements.developers.join(", ")}</p>}
          {requirements?.releaseDate && <p className="gv-muted">Phát hành: {requirements.releaseDate}</p>}
          {localGame && <p className="gv-notice">Trong thư viện của bạn: {minutesLabel(localGame.playtimeMinutes)} · {localGame.status === "completed" ? "Đã hoàn thành" : "Chưa hoàn thành"}. {me?.shareLibrary ? "Đã bật chia sẻ thư viện." : "Giờ chơi này chỉ hiển thị cho bạn cho đến khi bật chia sẻ."}</p>}
          {localGame?.localGameId && onLocalGame && <button onClick={() => onLocalGame(localGame.localGameId!)}>Mở chi tiết trong thư viện của tôi</button>}
        </div>
      </div>
      <GamePlayers key={playersRevision} api={api} gameKey={game.gameKey} myUid={me?.uid} onProfile={onProfile} localGame={localGame} />
      {error && (
        <p role="alert" className="gv-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="gv-notice">
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="gv-muted">
          Đang tải dữ liệu game…
        </p>
      )}
      <h2>Yêu cầu cấu hình từ Steam</h2>
      {steamError ? (
        <div className="gv-empty">
          <p>{steamError}</p>
          <button onClick={() => void load()}>Thử lại</button>
        </div>
      ) : (
        <>
          <div className="gv-requirements">
            <div>
              <h3>Tối thiểu</h3>
              <p>
                {requirements?.minimum ||
                  (loading
                    ? "Đang tải…"
                    : "Steam chưa có thông tin cấu hình tối thiểu cho game này.")}
              </p>
            </div>
            <div>
              <h3>Đề nghị</h3>
              <p>
                {requirements?.recommended ||
                  (loading
                    ? "Đang tải…"
                    : "Steam chưa công bố cấu hình đề nghị cho game này.")}
              </p>
            </div>
          </div>
          {requirements?.sourceUrl && (
            <p
              className="gv-muted"
              style={{
                marginTop: 12,
              }}
            >
              <a href={requirements.sourceUrl} target="_blank" rel="noreferrer">
                Xem nguồn Steam{" "}
                <ExternalLink
                  size={12}
                  style={{
                    display: "inline",
                  }}
                />
              </a>{" "}
              · Cập nhật{" "}
              {new Date(requirements.fetchedAt).toLocaleDateString("vi-VN")}
            </p>
          )}
        </>
      )}
      <h2>Cấu hình thực tế của người đã hoàn thành</h2>
      <p className="gv-muted">
        Hoàn thành do người chơi tự xác nhận. FPS đo bằng PresentMon được ứng
        dụng gửi lên; kết quả tự nhập có nhãn riêng. Không bảo đảm máy khác đạt
        cùng FPS.
      </p>
      <form
        className="gv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void loadPerformance();
        }}
      >
        <div className="gv-spec-form">
          <label>
            Tìm GPU
            <input
              maxLength={100}
              value={gpu}
              onChange={(e) => setGpu(e.target.value)}
              placeholder="RTX 3060 / RX 6600..."
            />
          </label>
          <label>
            Độ phân giải
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              <option value="">Tất cả</option>
              {["1280x720", "1920x1080", "2560x1440", "3840x2160"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Mức đồ họa
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">Tất cả</option>
              {["Low", "Medium", "High", "Ultra", "Custom"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <button disabled={busy}>Lọc kết quả</button>
        </div>
      </form>
      {reports.items.length ? (
        <div className="gv-table-scroll">
          <table className="gv-table gv-performance">
            <thead>
              <tr>
                <th>Người chơi / cấu hình</th>
                <th>FPS</th>
                <th>Điều kiện chơi</th>
                <th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {reports.items.map((r) => (
                <tr key={r.id}>
                  <td data-label="Người chơi / cấu hình">
                    <button
                      className="gv-link"
                      onClick={() => onProfile(r.uid!)}
                    >
                      {r.nickname}
                    </button>
                    <p>{r.gpu}</p>
                    <p className="gv-muted">
                      {r.cpu} · {r.ramGb} GB RAM
                    </p>
                  </td>
                  <td data-label="FPS" className="gv-number">
                    <strong>{r.fpsAverage.toFixed(1)} FPS</strong>
                    <p className="gv-muted">
                      1% low: {r.fpsLow?.toFixed(1) ?? "Chưa đo"}
                    </p>
                  </td>
                  <td data-label="Điều kiện chơi">
                    <strong>
                      {r.graphics.width} × {r.graphics.height}
                    </strong>
                    <p>{r.graphics.preset}</p>
                    <p className="gv-muted">
                      Nâng độ phân giải: {r.graphics.upscaling || "Chưa rõ"}
                      <br />
                      Tạo khung hình: {r.graphics.frameGeneration || "Chưa rõ"}
                      <br />
                      Ray Tracing: {r.graphics.rayTracing || "Chưa rõ"}
                    </p>
                    {r.notes && <p className="gv-muted">{r.notes}</p>}
                  </td>
                  <td data-label="Nguồn">
                    <span>
                      {r.source === "presentmon" ? "PresentMon" : "Tự khai báo"}
                    </span>
                    <p className="gv-muted">
                      {new Date(r.measuredAt).toLocaleDateString("vi-VN")}
                      {r.samples > 0
                        ? ` · ${r.samples.toLocaleString("vi-VN")} khung hình`
                        : ""}
                    </p>
                    <button
                      className="gv-link"
                      onClick={() =>
                        void reportContent("performance", r.id!).catch((e) =>
                          setError(communityError(e)),
                        )
                      }
                    >
                      Báo cáo
                    </button>
                    {me?.uid === r.uid && (
                      <button
                        className="gv-link"
                        onClick={() =>
                          void api
                            .request(`${base}/performance`, "DELETE")
                            .then(() => loadPerformance())
                            .catch((e) => setError(communityError(e)))
                        }
                      >
                        Gỡ kết quả của tôi
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && (
          <div className="gv-empty">
            <h3>Chưa có kết quả phù hợp</h3>
            <p>
              Hãy thử bộ lọc khác hoặc chia sẻ cấu hình của bạn sau khi hoàn
              thành game.
            </p>
          </div>
        )
      )}
      {reports.hasMore && (
        <button className="gv-pager" onClick={() => void loadPerformance(true)}>
          Xem thêm cấu hình
        </button>
      )}
      {me ? (
        <details
          style={{
            marginTop: 20,
          }}
        >
          <summary>Chia sẻ kết quả đã hoàn thành</summary>
          {localGame?.localGameId ? <PerformancePanel gameId={localGame.localGameId} status={localGame.status} onShared={() => void load()} /> : <PerformanceShareForm
            api={api}
            game={activeGame}
            onShared={() => void loadPerformance()}
          />}
        </details>
      ) : (
        <button
          onClick={() =>
            void api.signIn().catch((e) => setError(communityError(e)))
          }
        >
          Đăng nhập để chia sẻ cấu hình
        </button>
      )}
      <h2>Đánh giá từ người chơi</h2>
      {reviews.items.length === 0 && !loading && (
        <p className="gv-empty">
          Chưa có đánh giá. Bạn có thể viết cảm nhận đầu tiên.
        </p>
      )}
      {reviews.items.map((r) => (
        <ReviewItem
          key={r.id}
          review={r}
          me={me}
          onProfile={onProfile}
          onReport={() =>
            void reportContent("review", r.id).catch((e) =>
              setError(communityError(e)),
            )
          }
        />
      ))}
      {reviews.hasMore && (
        <button
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
      {me ? (
        <details
          style={{
            marginTop: 20,
          }}
        >
          <summary>
            {reviews.items.some((r) => r.uid === me.uid)
              ? "Cập nhật đánh giá của tôi"
              : "Viết đánh giá"}
          </summary>
          <form
            className="gv-form"
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
                })
                .then(() => {
                  setNotice("Đã lưu đánh giá công khai.");
                  return load();
                })
                .catch((e) => setError(communityError(e)))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Điểm (1–10)
              <input
                required
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
              />
            </label>
            <label>
              Cảm nhận
              <textarea
                required
                rows={4}
                maxLength={4000}
                value={review}
                onChange={(e) => setReview(e.target.value)}
                placeholder="Bạn thích gì, không thích gì, ai nên chơi game này?"
              />
            </label>
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
            <div className="gv-actions">
              <button className="gv-primary" disabled={busy || !review.trim()}>
                Đăng đánh giá
              </button>
              {reviews.items.some((r) => r.uid === me.uid) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void api
                      .request(`${base}/reviews`, "DELETE")
                      .then(() => {
                        setReview("");
                        return load();
                      })
                      .catch((e) => setError(communityError(e)))
                  }
                >
                  Xóa đánh giá của tôi
                </button>
              )}
            </div>
          </form>
        </details>
      ) : (
        <button
          onClick={() =>
            void api.signIn().catch((e) => setError(communityError(e)))
          }
        >
          Đăng nhập để viết đánh giá
        </button>
      )}
      <h2>Bài viết và ảnh về {activeGame.title}</h2>
      {me && (
        <details>
          <summary>Đăng bài về game này</summary>
          <PostComposer
            api={api}
            game={activeGame}
            onPosted={() => void load()}
          />
        </details>
      )}
      {posts.items.length === 0 && !loading && (
        <p className="gv-empty">Chưa có bài viết cho game này.</p>
      )}
      {posts.items.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          api={api}
          me={me}
          onChanged={() => void refreshPost(p.id)}
          onGame={onGame}
          onProfile={onProfile}
        />
      ))}
      {posts.hasMore && (
        <button
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
    </section>
  );
}
function ReviewItem({
  review,
  me,
  onProfile,
  onReport,
}: {
  review: CommunityReview;
  me: PublicProfile | null;
  onProfile: (uid: string) => void;
  onReport: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <article className="gv-post">
      <div className="gv-post-meta">
        <strong>{review.score}/10</strong>
        <button className="gv-link" onClick={() => onProfile(review.uid)}>
          {review.nickname}
        </button>
        {review.playtimeMinutes > 0 && (
          <span className="gv-muted">
            {minutesLabel(review.playtimeMinutes)}
          </span>
        )}
        {review.dropped && <span className="gv-muted">Đã bỏ game</span>}
      </div>
      {review.spoiler && !revealed ? (
        <button
          style={{
            marginTop: 12,
          }}
          onClick={() => setRevealed(true)}
        >
          Xem đánh giá có spoiler
        </button>
      ) : (
        <p className="gv-post-body">{review.review}</p>
      )}
      {me?.uid !== review.uid && (
        <button className="gv-link" onClick={onReport}>
          Báo cáo đánh giá
        </button>
      )}
    </article>
  );
}
