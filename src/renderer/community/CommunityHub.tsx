import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Compass,
  MessageCircle,
  Search,
  Shield,
  UserRound,
  RefreshCw,
  CalendarDays,
  Trophy,
} from "lucide-react";
import type {
  CommunityAdapter,
  CommunityNotification,
  CommunityPost,
  GameRanking,
  ModerationReport,
  Page,
  PublicGame,
  PublicProfile,
  SharedLibraryGame,
} from "../../shared/community.ts";
import { communityError, minutesLabel, shareUrl, qualifyCommunityUrl } from "./client.ts";
import { GameHub } from "./GameHub.tsx";
import { PostCard } from "./PostCard.tsx";
import { PostComposer } from "./PostComposer.tsx";
import "./community.css";
import type { AuthStatus } from "../../shared/types.ts";
import { loadCommunityIdentity } from "./identity.ts";
import { PlayerBoard } from "./PlayerBoard.tsx";
import { ProfileActivity } from "./ProfileActivity.tsx";
type Tab =
  "feed" | "discover" | "players" | "profile" | "notifications" | "moderation" | "monthly";
type Route = {
  game?: PublicGame;
  post?: string;
  profile?: string;
};
const empty = <T,>(): Page<T> => ({
  items: [],
  hasMore: false,
  nextOffset: 0,
});
function initialRoute(): Route {
  const p = new URLSearchParams(window.location.search);
  if (p.get("game"))
    return {
      game: {
        gameKey: p.get("game")!.slice(0, 100),
        title: (p.get("title") || p.get("game")!).slice(0, 160),
      },
    };
  if (p.get("post"))
    return {
      post: p.get("post")!.slice(0, 100),
    };
  if (p.get("profile"))
    return {
      profile: p.get("profile")!.slice(0, 160),
    };
  return {};
}
export function CommunityHub({
  api,
  games = [],
  onAdd,
  monthly,
  embedded = false,
  shellAuth,
  initialGame,
  onLocalGame,
}: {
  api: CommunityAdapter;
  games?: SharedLibraryGame[];
  onAdd?: (g: PublicGame) => Promise<void>;
  monthly?: React.ReactNode;
  embedded?: boolean;
  shellAuth?: AuthStatus | null;
  initialGame?: PublicGame | null;
  onLocalGame?: (id: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("discover"),
    [route, setRoute] = useState<Route>(() => initialGame ? { game: initialGame } : embedded ? {} : initialRoute()),
    [me, setMe] = useState<PublicProfile | null>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [feed, setFeed] = useState<Page<CommunityPost>>(empty()),
    [saved, setSaved] = useState(false),
    [kind, setKind] = useState(""),
    [loading, setLoading] = useState(false),
    [composer, setComposer] = useState(false);
  const [query, setQuery] = useState(""),
    [gameQuery, setGameQuery] = useState(""),
    [sort, setSort] = useState("players"),
    [rankings, setRankings] = useState<Page<GameRanking>>(empty());
  const [profile, setProfile] = useState<PublicProfile | null>(null),
    [nickname, setNickname] = useState(""),
    [bio, setBio] = useState(""),
    [shareLibrary, setShareLibrary] = useState(false),
    [blocked, setBlocked] = useState<
      Array<{
        uid: string;
        nickname: string;
      }>
    >([]),
    [notifications, setNotifications] =
      useState<Page<CommunityNotification>>(empty()),
    [reports, setReports] = useState<Page<ModerationReport>>(empty());
  const rankingSequence = useRef(0);
  const identitySequence = useRef(0);
  const [identityUnavailable, setIdentityUnavailable] = useState(false);
  const [identityExpired, setIdentityExpired] = useState(false);
  const loadMe = useCallback(async () => {
    setChecking(true);
    const ticket = ++identitySequence.current;
    const identity = await loadCommunityIdentity(
      api.request,
      embedded ? shellAuth : undefined,
    );
    if (ticket !== identitySequence.current) return;
    setMe(identity.profile);
    setIdentityUnavailable(identity.state === "unavailable");
    setIdentityExpired(!!identity.expired);
    if (identity.profile && identity.state === "ready") {
      const p = identity.profile;
      setNickname(p.nickname);
      setBio(p.bio);
      setShareLibrary(p.shareLibrary);
    }
    setChecking(identity.state === "checking");
  }, [api, embedded, shellAuth]);
  useEffect(() => {
    void loadMe();
  }, [loadMe]);
  useEffect(() => {
    const updated = () => void loadMe();
    window.addEventListener("community-auth-changed", updated);
    return () => window.removeEventListener("community-auth-changed", updated);
  }, [loadMe]);
  const navigate = (next: Route) => {
    setRoute(next);
    setError("");
    if (embedded) { window.scrollTo({ top: 0 }); return; }
    const params = new URLSearchParams();
    if (next.game) {
      params.set("game", next.game.gameKey);
      params.set("title", next.game.title);
    }
    if (next.post) params.set("post", next.post);
    if (next.profile) params.set("profile", next.profile);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${params.size ? "?" + params : ""}`,
    );
    window.scrollTo({
      top: 0,
    });
  };
  useEffect(() => {
    if (embedded) return;
    const pop = () => setRoute(initialRoute());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [embedded]);
  const signIn = async () => {
    setError("");
    try {
      await api.signIn();
      await loadMe();
    } catch (e) {
      setError(communityError(e));
    }
  };
  const loadFeed = useCallback(
    async (more = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          offset: String(more ? feed.nextOffset : 0),
        });
        if (saved) params.set("saved", "true");
        if (kind) params.set("kind", kind);
        if (route.profile) params.set("uid", route.profile);
        const next = route.post
          ? {
              items: [
                await api.request<CommunityPost>(
                  `/posts/${encodeURIComponent(route.post)}`,
                ),
              ],
              hasMore: false,
              nextOffset: 1,
            }
          : await api.request<Page<CommunityPost>>(`/posts?${params}`);
        setFeed(
          more
            ? {
                ...next,
                items: [...feed.items, ...next.items],
              }
            : next,
        );
      } catch (e) {
        setError(communityError(e));
        setFeed(empty());
      } finally {
        setLoading(false);
      }
    },
    [api, saved, kind, route.post, route.profile, feed.nextOffset, feed.items],
  );
  useEffect(() => {
    if (!route.game && (tab === "feed" || route.post || route.profile))
      void loadFeed();
  }, [api, saved, kind, route.post, route.profile, route.game, tab, me?.uid]);
  const refreshPost = async (id: string) => {
    try {
      const latest = await api.request<CommunityPost>(`/posts/${id}`);
      setFeed((previous) => ({
        ...previous,
        items: previous.items.map((p) => (p.id === id ? latest : p)),
      }));
    } catch (e) {
      if (/not found/.test(String((e as Error).message)))
        setFeed((previous) => ({
          ...previous,
          items: previous.items.filter((p) => p.id !== id),
        }));
      else setError(communityError(e));
    }
  };
  const loadRankings = async (more = false) => {
    const ticket = ++rankingSequence.current;
    setLoading(true);
    setError("");
    try {
      const p = await api.request<Page<GameRanking>>(
        `/rankings?sort=${sort}&q=${encodeURIComponent(gameQuery)}&offset=${more ? rankings.nextOffset : 0}`,
      );
      if (ticket !== rankingSequence.current) return;
      setRankings(
        more
          ? {
              ...p,
              items: [...rankings.items, ...p.items],
            }
          : p,
      );
    } catch (e) {
      if (ticket === rankingSequence.current) {
        setRankings(empty());
        setError(communityError(e));
      }
    } finally {
      if (ticket === rankingSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (tab === "discover" && !route.game && !route.profile && !route.post) {
      setRankings(empty());
      void loadRankings();
    }
    return () => { rankingSequence.current++; };
  }, [api, tab, sort, gameQuery, route.game, route.profile, route.post, me?.uid]);
  useEffect(() => {
    if (route.profile) {
      setLoading(true);
      void api
        .request<PublicProfile>(
          `/profiles/${encodeURIComponent(route.profile)}`,
        )
        .then(setProfile)
        .catch((e) => {
          setProfile(null);
          setError(communityError(e));
        })
        .finally(() => setLoading(false));
    }
  }, [api, route.profile]);
  useEffect(() => {
    if (tab === "profile" && me)
      void api
        .request<{
          items: Array<{
            uid: string;
            nickname: string;
          }>;
        }>("/blocks")
        .then((r) => setBlocked(r.items))
        .catch((e) => setError(communityError(e)));
  }, [tab, me?.uid, api]);
  const loadNotifications = async (more = false) => {
    try {
      const p = await api.request<Page<CommunityNotification>>(
        `/notifications?offset=${more ? notifications.nextOffset : 0}`,
      );
      setNotifications(
        more
          ? {
              ...p,
              items: [...notifications.items, ...p.items],
            }
          : p,
      );
    } catch (e) {
      setError(communityError(e));
    }
  };
  const loadReports = async (more = false) => {
    try {
      const p = await api.request<Page<ModerationReport>>(
        `/admin/reports?offset=${more ? reports.nextOffset : 0}`,
      );
      setReports(
        more
          ? {
              ...p,
              items: [...reports.items, ...p.items],
            }
          : p,
      );
    } catch (e) {
      setError(communityError(e));
    }
  };
  useEffect(() => {
    if (tab === "notifications" && me) void loadNotifications();
    if (tab === "moderation" && me?.isAdmin) void loadReports();
  }, [tab, me?.uid, api]);
  const switchTab = (t: Tab) => {
    setTab(t);
    navigate({});
    setNotice("");
    setFeed(empty());
  };
  const onGame = (g: PublicGame) =>
      navigate({
        game: g,
      }),
    onProfile = (uid: string) =>
      navigate({
        profile: uid,
      });
  return (
    <div className="gv-community">
      {!embedded && (
        <header className="gv-top">
          <div>
            <h1>GameVault Cộng đồng</h1>
            <p className="gv-muted">
              Chia sẻ khoảnh khắc. Tìm game đáng chơi. Xem máy thật đã chơi ra
              sao.
            </p>
          </div>
          <div>
            {checking ? (
              <span className="gv-muted">Đang kiểm tra tài khoản…</span>
            ) : me ? (
              <span className="gv-muted">{me.nickname}</span>
            ) : identityUnavailable ? (
              <span className="gv-muted">Chưa kết nối được cộng đồng</span>
            ) : (
              <button className="gv-primary" onClick={() => void signIn()}>
                Đăng nhập Google
              </button>
            )}
          </div>
        </header>
      )}
      <nav className="gv-tabs" aria-label="Khu vực cộng đồng">
        {(
          [
            ["feed", "Bảng tin", MessageCircle],
            ["discover", "Top game", Compass],
            ["players", "Top người chơi", Trophy],
            ["profile", "Hồ sơ", UserRound],
            ["notifications", "Thông báo", Bell],
            ...(monthly ? [["monthly", "Game tháng này", CalendarDays]] : []),
            ...(me?.isAdmin ? [["moderation", "Quản trị", Shield]] : []),
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id as string}
            aria-pressed={
              tab === id && !route.game && !route.profile && !route.post
            }
            onClick={() => switchTab(id as Tab)}
          >
            <Icon size={16} />
            {label as string}
          </button>
        ))}
      </nav>
      {identityUnavailable && (
        <p role="status" className="gv-notice">
          {identityExpired
            ? "Phiên tài khoản cần được làm mới. Hãy đăng xuất rồi đăng nhập ở góc trên bên phải."
            : "Máy chủ cộng đồng chưa sẵn sàng. Trạng thái tài khoản ở thanh trên vẫn được giữ."}{" "}
          <button onClick={() => void loadMe()}>Kết nối lại</button>
        </p>
      )}
      {error && (
        <div className="gv-error" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              if (route.game) navigate(route);
              else if (tab === "discover") void loadRankings();
              else void loadFeed();
            }}
          >
            Thử lại
          </button>
        </div>
      )}
      {notice && (
        <p className="gv-notice" role="status">
          {notice}
        </p>
      )}
      {route.game ? (
        <GameHub
          key={route.game.gameKey}
          api={api}
          game={route.game}
          me={me}
          onBack={() => switchTab("discover")}
          onGame={onGame}
          onProfile={onProfile}
          onAdd={onAdd}
          localGame={games.find(g => g.gameKey === route.game!.gameKey)}
          onLocalGame={onLocalGame}
        />
      ) : route.profile ? (
        <>
          <button className="gv-link" onClick={() => switchTab("feed")}>
            Quay lại bảng tin
          </button>
          {profile && (
            <>
              <h2>{profile.nickname}</h2>
              <p>{profile.bio || "Người chơi GameVault"}</p>
              <div className="gv-actions">
                <a
                  href={shareUrl(api.publicBase, "profile", profile.uid)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Liên kết hồ sơ
                </a>
                {me && me.uid !== profile.uid && (
                  <button
                    onClick={() =>
                      void api
                        .request(
                          `/blocks/${encodeURIComponent(profile.uid)}`,
                          "PUT",
                        )
                        .then(() => {
                          setNotice("Đã chặn tài khoản.");
                          switchTab("feed");
                        })
                        .catch((e) => setError(communityError(e)))
                    }
                  >
                    Chặn tài khoản
                  </button>
                )}
              </div>
              <h3
                style={{
                  marginTop: 24,
                }}
              >
                Thư viện được chia sẻ
              </h3>
              {profile.shareLibrary ? (
                <div className="gv-results">
                  {profile.games?.map((g) => (
                    <button
                      className="gv-result"
                      key={g.gameKey}
                      onClick={() => onGame(g)}
                    >
                      <span>
                        <strong>{g.title}</strong>
                        <br />
                        <span className="gv-muted">
                          {minutesLabel(g.playtimeMinutes)} ·{" "}
                          {g.status === "completed"
                            ? "Đã hoàn thành"
                            : g.status === "playing"
                              ? "Đang chơi"
                              : g.status === "backlog"
                                ? "Chờ chơi"
                                : g.status === "dropped"
                                  ? "Đã bỏ"
                                  : "Tạm dừng"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="gv-muted">
                  Người chơi này không công khai thư viện.
                </p>
              )}
            </>
          )}
          <h2>Bài viết</h2>
          {feed.items.map((p) => (
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
        </>
      ) : tab === "feed" || route.post ? (
        <>
          {!route.post && (
            <>
              <div className="gv-top">
                <div>
                  <h2
                    style={{
                      marginTop: 0,
                    }}
                  >
                    Những trải nghiệm mới nhất
                  </h2>
                  <p className="gv-muted">
                    Bài viết và ảnh do người chơi chủ động chia sẻ.
                  </p>
                </div>
                <div className="gv-actions">
                  <button onClick={() => void loadFeed()} disabled={loading}>
                    <RefreshCw size={16} />
                    Làm mới
                  </button>
                  <button
                    onClick={() =>
                      me ? setComposer(!composer) : void signIn()
                    }
                  >
                    Đăng bài
                  </button>
                </div>
              </div>
              <div
                className="gv-actions"
                style={{
                  margin: "20px 0",
                }}
              >
                <button aria-pressed={!saved} onClick={() => setSaved(false)}>
                  Mới nhất
                </button>
                <button
                  aria-pressed={saved}
                  onClick={() => (me ? setSaved(true) : void signIn())}
                >
                  Đã lưu
                </button>
                <label>
                  Loại bài
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="">Tất cả</option>
                    <option value="photo">Ảnh game</option>
                    <option value="thought">Cảm nhận</option>
                    <option value="question">Hỏi cộng đồng</option>
                    <option value="completed">Phá đảo</option>
                    <option value="review">Review</option>
                  </select>
                </label>
              </div>
              {composer && me && (
                <PostComposer
                  api={api}
                  games={games}
                  onPosted={() => {
                    setComposer(false);
                    void loadFeed();
                  }}
                />
              )}
            </>
          )}
          {route.post && (
            <button className="gv-link" onClick={() => switchTab("feed")}>
              Quay lại bảng tin
            </button>
          )}
          {loading && (
            <p role="status" className="gv-muted">
              Đang tải bài viết…
            </p>
          )}
          {!loading && feed.items.length === 0 && (
            <div className="gv-empty">
              <h3>
                {saved ? "Chưa có bài đã lưu" : "Chưa có bài viết phù hợp"}
              </h3>
              <p>
                Bạn có thể tìm một game trong Khám phá rồi chia sẻ cảm nhận đầu
                tiên.
              </p>
              <button onClick={() => switchTab("discover")}>Tìm game</button>
            </div>
          )}
          {feed.items.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              api={api}
              me={me}
              onChanged={() => void refreshPost(p.id)}
              onGame={onGame}
              onProfile={onProfile}
              expanded={!!route.post}
            />
          ))}
          {feed.hasMore && (
            <button
              className="gv-pager"
              disabled={loading}
              onClick={() => void loadFeed(true)}
            >
              Xem thêm bài viết
            </button>
          )}
        </>
      ) : tab === "players" ? (
        <PlayerBoard api={api} myUid={me?.uid} onProfile={onProfile} onShareLibrary={() => switchTab("profile")} />
      ) : tab === "discover" ? (
        <>
          <h2
            style={{
              marginTop: 0,
            }}
          >
            Top game
          </h2>
          <p className="gv-muted">
            Danh sách game đã có trong cơ sở dữ liệu. Chọn game để xem thông tin, người chơi và cấu hình đã chia sẻ.
          </p>
          <form className="gv-search" onSubmit={(e) => { e.preventDefault(); setGameQuery(query.trim()); }}>
            <label>
              <span>Tên game</span>
              <input
                maxLength={80}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm trong danh sách game…"
              />
            </label>
            <button
              className="gv-primary"
              style={{
                alignSelf: "end",
              }}
              disabled={loading}
            >
              <Search size={16} />
              Tìm
            </button>
          </form>
          {gameQuery && <button className="gv-link" onClick={() => { setQuery(""); setGameQuery(""); }}>Xóa tìm kiếm</button>}
          <p className="gv-muted">
            Giờ chơi chỉ tính từ thư viện được đồng ý công khai. Mục Điểm cao chỉ xếp hạng game có ít nhất 1 lượt đánh giá.
          </p>
          <div className="gv-actions">
            {[
              ["players", "Nhiều người chơi"],
              ["hours", "Tổng giờ chơi"],
              ["completed", "Nhiều người hoàn thành"],
              ["score", "Điểm cao"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={sort === id}
                onClick={() => setSort(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {loading && <p className="gv-muted" role="status">Đang tải danh sách game…</p>}
          {rankings.items.length ? (
            <div className="gv-table-scroll">
              <table className="gv-table">
                <thead>
                  <tr>
                    <th>Hạng</th>
                    <th>Game</th>
                    <th>Người chơi</th>
                    <th>Đã hoàn thành</th>
                    <th>Tổng giờ</th>
                    <th>Điểm / đánh giá</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.items.map((g, index) => (
                    <tr key={g.gameKey}>
                      <td>{index + 1}</td>
                      <td>
                        <button className="gv-link" onClick={() => onGame(g)}>
                          {g.coverUrl && qualifyCommunityUrl(api.publicBase, g.coverUrl) && <img className="gv-rank-cover" src={qualifyCommunityUrl(api.publicBase, g.coverUrl)} alt="" loading="lazy" />}
                          {g.title}
                        </button>
                      </td>
                      <td>{g.players}</td>
                      <td>{g.completedPlayers}</td>
                      <td>{minutesLabel(g.totalMinutes)}</td>
                      <td>
                        {g.averageScore?.toFixed(1) ?? "Chưa có điểm"}
                        {g.reviewCount > 0
                          ? ` / ${g.reviewCount} đánh giá`
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !loading && !error && (
              <p className="gv-empty">
                {sort === "score" ? "Chưa có game được đánh giá phù hợp với bộ lọc." : gameQuery ? "Không tìm thấy game phù hợp. Hãy thử tên khác." : "Chưa có game trong cơ sở dữ liệu."}
              </p>
            )
          )}
          {rankings.hasMore && (
            <button
              className="gv-pager"
              disabled={loading}
              onClick={() => void loadRankings(true)}
            >
              Xem thêm game
            </button>
          )}
        </>
      ) : tab === "profile" ? (
        me ? (
          <>
            <ProfileActivity key={me.uid} api={api} me={me} onGame={onGame} onProfile={onProfile} onPost={(post) => navigate({ post })} />
            <h2
              style={{
                marginTop: 0,
              }}
            >
              Hồ sơ và phạm vi công khai
            </h2>
            {me.suspended && (
              <p className="gv-error">
                Tài khoản đang bị hạn chế đăng nội dung.
              </p>
            )}
            <form
              className="gv-form"
              onSubmit={(e) => {
                e.preventDefault();
                setLoading(true);
                void api
                  .request("/me", "PUT", {
                    nickname,
                    bio,
                    shareLibrary,
                  })
                  .then(() => {
                    setNotice("Đã cập nhật hồ sơ.");
                    return loadMe();
                  })
                  .catch((e) => setError(communityError(e)))
                  .finally(() => setLoading(false));
              }}
            >
              <label>
                Biệt danh
                <input
                  required
                  maxLength={60}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </label>
              <label>
                Giới thiệu
                <textarea
                  rows={2}
                  maxLength={300}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                />
              </label>
              <label className="gv-check">
                <input
                  type="checkbox"
                  checked={shareLibrary}
                  onChange={(e) => setShareLibrary(e.target.checked)}
                />
                Công khai thư viện, trạng thái và giờ chơi để tham gia BXH.
              </label>
              <p className="gv-muted">
                Gmail, đường dẫn file và backup không được đưa vào thư viện công khai.
                Điểm và cảm nhận kèm điểm được đăng thành đánh giá riêng. Bỏ chọn sẽ rút
                giờ chơi khỏi hồ sơ và BXH; bài và đánh giá đã đăng được quản lý riêng.
              </p>
              <div className="gv-actions">
                <button
                  className="gv-primary"
                  disabled={loading || identityUnavailable}
                >
                  Lưu hồ sơ
                </button>
                <button type="button" onClick={() => onProfile(me.uid)}>
                  Xem hồ sơ công khai
                </button>
              </div>
            </form>
            <h3>Tài khoản đã chặn</h3>
            {blocked.length ? (
              blocked.map((b) => (
                <p key={b.uid}>
                  {b.nickname || "Người chơi"}{" "}
                  <button
                    className="gv-link"
                    onClick={() =>
                      void api
                        .request(
                          `/blocks/${encodeURIComponent(b.uid)}`,
                          "DELETE",
                        )
                        .then(() =>
                          setBlocked(blocked.filter((x) => x.uid !== b.uid)),
                        )
                        .catch((e) => setError(communityError(e)))
                    }
                  >
                    Bỏ chặn
                  </button>
                </p>
              ))
            ) : (
              <p className="gv-muted">Chưa chặn tài khoản nào.</p>
            )}
            <details
              style={{
                marginTop: 28,
              }}
            >
              <summary>Xóa dữ liệu cộng đồng của tôi</summary>
              <button
                onClick={() =>
                  void api
                    .request("/uploads", "DELETE")
                    .then(() => setNotice("Đã dọn ảnh chưa đăng."))
                    .catch((e) => setError(communityError(e)))
                }
              >
                Dọn ảnh chưa đăng
              </button>
              <p className="gv-muted">
                Xóa bài, ảnh cộng đồng, review, kết quả hiệu năng và thống kê đã
                chia sẻ. Thư viện riêng và backup riêng không bị xóa.
              </p>
              <button
                onClick={() => {
                  if (window.confirm("Xóa tất cả dữ liệu cộng đồng của bạn?"))
                    void api
                      .request("/me", "DELETE")
                      .then(() => {
                        setNotice("Đã xóa dữ liệu cộng đồng.");
                        return loadMe();
                      })
                      .catch((e) => setError(communityError(e)));
                }}
              >
                Xóa dữ liệu cộng đồng
              </button>
            </details>
          </>
        ) : (
          <div className="gv-empty">
            <p>Đăng nhập để tạo hồ sơ và chọn dữ liệu bạn muốn chia sẻ.</p>
            <button onClick={() => void signIn()}>Đăng nhập Google</button>
          </div>
        )
      ) : tab === "notifications" ? (
        me ? (
          <>
            <div className="gv-top">
              <h2
                style={{
                  marginTop: 0,
                }}
              >
                Tương tác với bài của bạn
              </h2>
              <div className="gv-actions">
                <button onClick={() => void loadNotifications()}>
                  Làm mới
                </button>
                <button
                  onClick={() =>
                    void api
                      .request("/notifications/read", "PUT")
                      .then(() => loadNotifications())
                      .catch((e) => setError(communityError(e)))
                  }
                >
                  Đánh dấu đã đọc
                </button>
              </div>
            </div>
            {notifications.items.length ? (
              notifications.items.map((n) => (
                <div className="gv-post" key={n.id}>
                  <button
                    className="gv-link"
                    onClick={() =>
                      navigate({
                        post: n.postId,
                      })
                    }
                  >
                    {n.nickname}{" "}
                    {n.kind === "like" ? "đã thả tim" : "đã bình luận"} bài của
                    bạn
                  </button>
                  {!n.read && <span className="gv-muted"> · Mới</span>}
                </div>
              ))
            ) : (
              <p className="gv-empty">Chưa có thông báo.</p>
            )}
            {notifications.hasMore && (
              <button
                className="gv-pager"
                onClick={() => void loadNotifications(true)}
              >
                Xem thêm thông báo
              </button>
            )}
          </>
        ) : (
          <button onClick={() => void signIn()}>
            Đăng nhập để xem thông báo
          </button>
        )
      ) : tab === "moderation" && me?.isAdmin ? (
        <>
          <div className="gv-top">
            <h2
              style={{
                marginTop: 0,
              }}
            >
              Báo cáo cần xử lý
            </h2>
            <button onClick={() => void loadReports()}>Làm mới</button>
          </div>
          {reports.items.length ? (
            reports.items.map((r) => (
              <article className="gv-post" key={r.id}>
                <strong>
                  {r.targetType} · {r.reason}
                </strong>
                <p className="gv-post-body">{r.targetBody}</p>
                <div className="gv-actions">
                  {[
                    ["dismiss", "Bỏ qua"],
                    ["hide", "Ẩn nội dung"],
                    ["suspend", "Hạn chế tác giả"],
                  ].map(([action, label]) => (
                    <button
                      key={action}
                      onClick={() => {
                        if (
                          action === "suspend" &&
                          !window.confirm("Hạn chế tài khoản tác giả này?")
                        )
                          return;
                        void api
                          .request(`/admin/reports/${r.id}`, "PUT", {
                            action,
                          })
                          .then(() => loadReports())
                          .catch((e) => setError(communityError(e)));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <p className="gv-empty">Không có báo cáo đang chờ.</p>
          )}
          {reports.hasMore && (
            <button className="gv-pager" onClick={() => void loadReports(true)}>
              Xem thêm báo cáo
            </button>
          )}
        </>
      ) : tab === "monthly" ? (
        monthly
      ) : null}
    </div>
  );
}
