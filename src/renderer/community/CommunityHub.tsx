import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Bookmark,
  CalendarDays,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Gamepad2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserRound,
  Users,
  X,
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
import type { AuthStatus } from "../../shared/types.ts";
import {
  communityError,
  formatRelativeTime,
  minutesLabel,
  qualifyCommunityUrl,
  shareUrl,
} from "./client.ts";
import { GameHub } from "./GameHub.tsx";
import { PostCard } from "./PostCard.tsx";
import { PostComposer } from "./PostComposer.tsx";
import { loadCommunityIdentity } from "./identity.ts";
import { PlayerBoard } from "./PlayerBoard.tsx";
import { ProfileActivity } from "./ProfileActivity.tsx";
import { Avatar, ConfirmModal, scoreTierClass } from "./CommunityWidgets.tsx";
import "./community.css";

type Tab =
  | "feed"
  | "discover"
  | "players"
  | "profile"
  | "notifications"
  | "moderation"
  | "monthly";

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
  const [tab, setTab] = useState<Tab>("feed");
  const [route, setRoute] = useState<Route>(() =>
    initialGame ? { game: initialGame } : embedded ? {} : initialRoute(),
  );
  const [me, setMe] = useState<PublicProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const [feed, setFeed] = useState<Page<CommunityPost>>(empty());
  const [saved, setSaved] = useState(false);
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);
  const [composer, setComposer] = useState(false);

  const [query, setQuery] = useState("");
  const [gameQuery, setGameQuery] = useState("");
  const [sort, setSort] = useState("players");
  const [rankings, setRankings] = useState<Page<GameRanking>>(empty());

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [shareLibrary, setShareLibrary] = useState(false);
  const [blocked, setBlocked] = useState<Array<{ uid: string; nickname: string }>>([]);
  const [notifications, setNotifications] = useState<Page<CommunityNotification>>(empty());
  const [reports, setReports] = useState<Page<ModerationReport>>(empty());
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmSuspendId, setConfirmSuspendId] = useState<string | null>(null);

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
    if (embedded) {
      window.scrollTo({ top: 0 });
      return;
    }
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
    window.scrollTo({ top: 0 });
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
    return () => {
      rankingSequence.current++;
    };
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
        .request<{ items: Array<{ uid: string; nickname: string }> }>("/blocks")
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
    if (me && !identityUnavailable) {
      void api
        .request<Page<CommunityNotification>>("/notifications?offset=0")
        .then(setNotifications)
        .catch(() => {});
    }
  }, [me?.uid, identityUnavailable, api]);

  useEffect(() => {
    if (tab === "notifications" && me) void loadNotifications();
    if (tab === "moderation" && me?.isAdmin) void loadReports();
  }, [tab, me?.uid, api]);

  const unreadCount = useMemo(
    () => notifications.items.filter((n) => !n.read).length,
    [notifications.items],
  );

  const switchTab = (t: Tab) => {
    setTab(t);
    navigate({});
    setNotice("");
    setFeed(empty());
  };

  const onGame = (g: PublicGame) => navigate({ game: g });
  const onProfile = (uid: string) => navigate({ profile: uid });

  const top3Games = useMemo(
    () => (!gameQuery && rankings.items.length >= 3 ? rankings.items.slice(0, 3) : []),
    [gameQuery, rankings.items],
  );
  const restGames = useMemo(
    () => (top3Games.length ? rankings.items.slice(3) : rankings.items),
    [top3Games.length, rankings.items],
  );

  return (
    <div className="gv-community">
      {/* Header Shell */}
      <header className="gv-header-shell">
        <nav className="gv-nav-bar" aria-label="Khu vực cộng đồng">
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
              type="button"
              key={id as string}
              aria-pressed={
                tab === id && !route.game && !route.profile && !route.post
              }
              onClick={() => switchTab(id as Tab)}
            >
              <Icon size={15} />
              {label as string}
              {id === "notifications" && unreadCount > 0 && (
                <span className="gv-pill gv-pill-accent">{unreadCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="gv-actions">
          {checking ? (
            <span className="gv-muted">Đang kết nối…</span>
          ) : me ? (
            <button
              type="button"
              className="gv-card-subtle"
              style={{ padding: "5px 12px", borderRadius: 999 }}
              onClick={() => switchTab("profile")}
            >
              <Avatar name={me.nickname} url={me.avatarUrl} size={26} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{me.nickname}</span>
              {me.shareLibrary && (
                <span className="gv-pill gv-pill-emerald">Đang chia sẻ</span>
              )}
            </button>
          ) : !embedded ? (
            <button
              type="button"
              className="gv-primary"
              onClick={() => void signIn()}
            >
              Đăng nhập Google
            </button>
          ) : null}
        </div>
      </header>

      {identityUnavailable && (
        <div role="status" className="gv-notice">
          <span>
            {identityExpired
              ? "Phiên tài khoản cần làm mới. Hãy đăng xuất rồi đăng nhập lại ở góc trên bên phải."
              : "Máy chủ cộng đồng đang kết nối lại. Trạng thái đăng nhập trên app vẫn được giữ."}
          </span>
          <button type="button" onClick={() => void loadMe()}>
            Kết nối lại
          </button>
        </div>
      )}

      {error && (
        <div className="gv-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
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
        <div className="gv-notice" role="status">
          <span>{notice}</span>
        </div>
      )}

      {/* ROUTE: GAME HUB */}
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
          localGame={games.find((g) => g.gameKey === route.game!.gameKey)}
          onLocalGame={onLocalGame}
          onToast={showToast}
        />
      ) : route.profile ? (
        /* ROUTE: PUBLIC PROFILE */
        <section className="gv-stack">
          <div>
            <button
              type="button"
              className="gv-link"
              onClick={() => switchTab("feed")}
            >
              <ArrowLeft size={15} />
              Quay lại bảng tin
            </button>
          </div>

          {profile && (
            <div className="gv-card gv-stack">
              <div className="gv-top">
                <div className="gv-actions" style={{ gap: 14 }}>
                  <Avatar
                    name={profile.nickname}
                    url={profile.avatarUrl}
                    size={56}
                  />
                  <div>
                    <h2 style={{ fontSize: 22 }}>{profile.nickname}</h2>
                    <p className="gv-muted">
                      {profile.bio || "Thành viên GameVault"}
                    </p>
                  </div>
                </div>
                <div className="gv-actions">
                  <a
                    className="gv-button"
                    href={shareUrl(api.publicBase, "profile", profile.uid)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} />
                    Liên kết công khai
                  </a>
                  {me && me.uid !== profile.uid && (
                    <button
                      type="button"
                      className="gv-btn-danger"
                      onClick={() =>
                        void api
                          .request(
                            `/blocks/${encodeURIComponent(profile.uid)}`,
                            "PUT",
                          )
                          .then(() => {
                            showToast("Đã chặn tài khoản này.");
                            switchTab("feed");
                          })
                          .catch((e) => setError(communityError(e)))
                      }
                    >
                      Chặn tài khoản
                    </button>
                  )}
                </div>
              </div>

              <div className="gv-stack-sm">
                <h3>Thư viện game đã chia sẻ</h3>
                {profile.shareLibrary ? (
                  profile.games?.length ? (
                    <div className="gv-results">
                      {profile.games.map((g) => (
                        <button
                          type="button"
                          className="gv-result"
                          key={g.gameKey}
                          onClick={() => onGame(g)}
                        >
                          {g.coverUrl &&
                            qualifyCommunityUrl(api.publicBase, g.coverUrl) && (
                              <img
                                className="gv-poster-sm"
                                src={qualifyCommunityUrl(
                                  api.publicBase,
                                  g.coverUrl,
                                )}
                                alt=""
                                loading="lazy"
                              />
                            )}
                          <div>
                            <strong style={{ display: "block", fontSize: 13 }}>
                              {g.title}
                            </strong>
                            <span className="gv-muted" style={{ fontSize: 12 }}>
                              {minutesLabel(g.playtimeMinutes)} ·{" "}
                              {g.status === "completed"
                                ? "Đã phá đảo"
                                : g.status === "playing"
                                  ? "Đang chơi"
                                  : g.status === "backlog"
                                    ? "Chờ chơi"
                                    : g.status === "dropped"
                                      ? "Đã bỏ"
                                      : "Tạm dừng"}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="gv-muted">Chưa có game nào được chia sẻ.</p>
                  )
                ) : (
                  <p className="gv-muted">
                    Người chơi này đang giữ riêng tư thư viện.
                  </p>
                )}
              </div>
            </div>
          )}

          <h2>Bài viết của {profile?.nickname || "người chơi"}</h2>
          <div className="gv-feed-grid">
            {feed.items.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                api={api}
                me={me}
                onChanged={() => void refreshPost(p.id)}
                onGame={onGame}
                onProfile={onProfile}
                onToast={showToast}
              />
            ))}
          </div>
        </section>
      ) : tab === "feed" || route.post ? (
        /* TAB: BẢNG TIN */
        <section className="gv-stack">
          {!route.post && (
            <>
              <div className="gv-top">
                <div>
                  <h2>Bảng tin cộng đồng</h2>
                  <p className="gv-muted">
                    Khoảnh khắc chơi game, cảm nhận, đánh giá và thảo luận mới nhất.
                  </p>
                </div>
                <div className="gv-actions">
                  <button
                    type="button"
                    onClick={() => void loadFeed()}
                    disabled={loading}
                  >
                    <RefreshCw size={15} />
                    Làm mới
                  </button>
                  <button
                    type="button"
                    className="gv-primary"
                    onClick={() =>
                      me ? setComposer(!composer) : void signIn()
                    }
                  >
                    {composer ? (
                      <>
                        <X size={15} /> Đóng khung đăng
                      </>
                    ) : (
                      <>
                        <Plus size={15} /> Đăng bài mới
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="gv-top">
                <div className="gv-chip-row">
                  <button
                    type="button"
                    className={`gv-chip ${!saved ? "active" : ""}`}
                    onClick={() => setSaved(false)}
                  >
                    <Sparkles size={12} /> Mới nhất
                  </button>
                  <button
                    type="button"
                    className={`gv-chip ${saved ? "active" : ""}`}
                    onClick={() => (me ? setSaved(true) : void signIn())}
                  >
                    <Bookmark size={12} /> Đã lưu
                  </button>
                </div>

                <div className="gv-chip-row">
                  {[
                    ["", "Tất cả"],
                    ["photo", "Ảnh game"],
                    ["thought", "Cảm nhận"],
                    ["question", "Hỏi đáp"],
                    ["completed", "Phá đảo"],
                    ["review", "Đánh giá"],
                  ].map(([id, label]) => (
                    <button
                      type="button"
                      key={id || "all"}
                      className={`gv-chip ${kind === id ? "active" : ""}`}
                      onClick={() => setKind(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {composer && me && (
                <PostComposer
                  api={api}
                  games={games}
                  onPosted={() => {
                    setComposer(false);
                    showToast("Đã đăng bài lên cộng đồng!");
                    void loadFeed();
                  }}
                  onCancel={() => setComposer(false)}
                />
              )}
            </>
          )}

          {route.post && (
            <div>
              <button
                type="button"
                className="gv-link"
                onClick={() => switchTab("feed")}
              >
                <ArrowLeft size={15} />
                Quay lại bảng tin
              </button>
            </div>
          )}

          {loading && feed.items.length === 0 && (
            <p role="status" className="gv-muted">
              Đang tải bài viết…
            </p>
          )}

          {!loading && feed.items.length === 0 && (
            <div className="gv-empty">
              <h3>
                {saved ? "Chưa có bài viết đã lưu" : "Chưa có bài viết nào"}
              </h3>
              <p>
                Hãy chọn một game từ thư viện hoặc Top game để chia sẻ khoảnh
                khắc, cảm nhận đầu tiên!
              </p>
              <div className="gv-actions">
                {me && (
                  <button
                    type="button"
                    className="gv-primary"
                    onClick={() => setComposer(true)}
                  >
                    <Plus size={15} /> Đăng bài đầu tiên
                  </button>
                )}
                <button type="button" onClick={() => switchTab("discover")}>
                  Khám phá Top game
                </button>
              </div>
            </div>
          )}

          <div className="gv-feed-grid">
            {feed.items.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                api={api}
                me={me}
                onChanged={() => void refreshPost(p.id)}
                onGame={onGame}
                onProfile={onProfile}
                onToast={showToast}
                expanded={!!route.post}
              />
            ))}
          </div>

          {feed.hasMore && (
            <button
              type="button"
              className="gv-pager"
              disabled={loading}
              onClick={() => void loadFeed(true)}
            >
              Xem thêm bài viết
            </button>
          )}
        </section>
      ) : tab === "players" ? (
        /* TAB: TOP NGƯỜI CHƠI */
        <PlayerBoard
          api={api}
          myUid={me?.uid}
          onProfile={onProfile}
          onShareLibrary={() => switchTab("profile")}
        />
      ) : tab === "discover" ? (
        /* TAB: TOP GAME */
        <section className="gv-stack">
          <div className="gv-top">
            <div>
              <h2>Top game cộng đồng</h2>
              <p className="gv-muted">
                Chọn bất kỳ game nào để xem cấu hình Steam, FPS thực tế của người chơi thật và đánh giá chi tiết.
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadRankings()}
            >
              <RefreshCw size={15} />
              Làm mới
            </button>
          </div>

          <form
            className="gv-search-bar"
            onSubmit={(e) => {
              e.preventDefault();
              setGameQuery(query.trim());
            }}
          >
            <input
              maxLength={80}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm tên game trong danh sách..."
            />
            <div className="gv-actions">
              <button type="submit" className="gv-primary" disabled={loading}>
                <Search size={15} />
                Tìm
              </button>
              {gameQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setGameQuery("");
                  }}
                >
                  Xóa lọc
                </button>
              )}
            </div>
          </form>

          <div className="gv-chip-row">
            {[
              ["players", "Nhiều người chơi"],
              ["hours", "Tổng giờ chơi"],
              ["completed", "Nhiều người phá đảo"],
              ["score", "Điểm đánh giá cao"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={`gv-chip ${sort === id ? "active" : ""}`}
                onClick={() => setSort(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && rankings.items.length === 0 && (
            <p className="gv-muted" role="status">
              Đang tải bảng xếp hạng game…
            </p>
          )}

          {top3Games.length > 0 && (
            <div className="gv-podium-grid">
              {top3Games.map((g, idx) => {
                const img = g.coverUrl
                  ? qualifyCommunityUrl(api.publicBase, g.coverUrl)
                  : "";
                return (
                  <button
                    type="button"
                    key={g.gameKey}
                    className={`gv-podium-card rank-${idx + 1}`}
                    onClick={() => onGame(g)}
                  >
                    <div className="gv-top">
                      <span
                        className={`gv-pill ${
                          idx === 0
                            ? "gv-pill-amber"
                            : idx === 1
                              ? "gv-pill-cyan"
                              : "gv-pill-accent"
                        }`}
                      >
                        <Trophy size={12} /> Hạng #{idx + 1}
                      </span>
                      {g.averageScore != null && (
                        <span
                          className={`gv-score-pill ${scoreTierClass(g.averageScore)}`}
                        >
                          <Star size={12} />
                          {g.averageScore.toFixed(1)}
                        </span>
                      )}
                    </div>

                    <div className="gv-podium-top">
                      {img ? (
                        <img
                          className="gv-poster-md"
                          src={img}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div className="gv-poster-md" />
                      )}
                      <div className="gv-stack-sm">
                        <strong style={{ fontSize: 15, lineHeight: 1.3 }}>
                          {g.title}
                        </strong>
                        <span className="gv-muted" style={{ fontSize: 12 }}>
                          {g.reviewCount > 0
                            ? `${g.reviewCount} đánh giá`
                            : "Chưa có đánh giá"}
                        </span>
                      </div>
                    </div>

                    <div className="gv-actions" style={{ gap: 6 }}>
                      <span className="gv-pill">
                        <Users size={11} /> {g.players} chơi
                      </span>
                      <span className="gv-pill gv-pill-emerald">
                        <CheckCircle2 size={11} /> {g.completedPlayers} phá đảo
                      </span>
                      <span className="gv-pill gv-pill-cyan">
                        <Clock size={11} /> {minutesLabel(g.totalMinutes)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {restGames.length > 0 && (
            <div className="gv-rank-list">
              {restGames.map((g, index) => {
                const rank = top3Games.length ? index + 4 : index + 1;
                const img = g.coverUrl
                  ? qualifyCommunityUrl(api.publicBase, g.coverUrl)
                  : "";
                return (
                  <button
                    type="button"
                    className="gv-rank-row"
                    key={g.gameKey}
                    onClick={() => onGame(g)}
                  >
                    <span className="gv-rank-num">#{rank}</span>
                    <div className="gv-actions" style={{ gap: 12 }}>
                      {img ? (
                        <img
                          className="gv-poster-sm"
                          src={img}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div className="gv-poster-sm" />
                      )}
                      <div>
                        <strong style={{ fontSize: 14, display: "block" }}>
                          {g.title}
                        </strong>
                        <span className="gv-muted" style={{ fontSize: 12 }}>
                          {g.reviewCount > 0
                            ? `${g.reviewCount} lượt đánh giá`
                            : "Xem cấu hình & đánh giá"}
                        </span>
                      </div>
                    </div>
                    <div className="gv-rank-metrics">
                      <span className="gv-pill">
                        <Users size={11} /> {g.players}
                      </span>
                      <span className="gv-pill gv-pill-emerald">
                        <CheckCircle2 size={11} /> {g.completedPlayers}
                      </span>
                      <span className="gv-pill gv-pill-cyan">
                        <Clock size={11} /> {minutesLabel(g.totalMinutes)}
                      </span>
                      {g.averageScore != null && (
                        <span
                          className={`gv-score-pill ${scoreTierClass(g.averageScore)}`}
                        >
                          <Star size={12} /> {g.averageScore.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && !error && rankings.items.length === 0 && (
            <div className="gv-empty">
              <Gamepad2 size={20} className="gv-text-cyan" />
              <p>
                {sort === "score"
                  ? "Chưa có game nào được chấm điểm phù hợp bộ lọc."
                  : gameQuery
                    ? "Không tìm thấy game phù hợp. Hãy thử từ khóa khác."
                    : "Chưa có game nào trong danh sách."}
              </p>
            </div>
          )}

          {rankings.hasMore && (
            <button
              type="button"
              className="gv-pager"
              disabled={loading}
              onClick={() => void loadRankings(true)}
            >
              Xem thêm game
            </button>
          )}
        </section>
      ) : tab === "profile" ? (
        /* TAB: HỒ SƠ */
        me ? (
          <div className="gv-two-col">
            <div className="gv-stack">
              <div className="gv-card gv-stack">
                <div className="gv-actions" style={{ gap: 14 }}>
                  <Avatar name={me.nickname} url={me.avatarUrl} size={52} />
                  <div>
                    <h2>{me.nickname}</h2>
                    <p className="gv-muted">
                      Cấu hình hiển thị công khai và đồng bộ lên bảng xếp hạng.
                    </p>
                  </div>
                </div>

                {me.suspended && (
                  <p className="gv-error">
                    Tài khoản đang bị hạn chế đăng nội dung.
                  </p>
                )}

                <form
                  className="gv-stack"
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
                        showToast("Đã lưu hồ sơ cộng đồng.");
                        return loadMe();
                      })
                      .catch((e) => setError(communityError(e)))
                      .finally(() => setLoading(false));
                  }}
                >
                  <label>
                    Biệt danh hiển thị
                    <input
                      required
                      maxLength={60}
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </label>
                  <label>
                    Giới thiệu ngắn
                    <textarea
                      rows={3}
                      maxLength={300}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Thể loại game yêu thích, cấu hình PC, gu chơi..."
                    />
                  </label>
                  <label className="gv-check">
                    <input
                      type="checkbox"
                      checked={shareLibrary}
                      onChange={(e) => setShareLibrary(e.target.checked)}
                    />
                    Công khai thư viện, số game phá đảo và giờ chơi lên BXH.
                  </label>
                  <p className="gv-muted" style={{ fontSize: 12 }}>
                    Email cá nhân, đường dẫn file trên máy và save game luôn
                    được giữ riêng tư tuyệt đối.
                  </p>
                  <div className="gv-actions">
                    <button
                      type="submit"
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
              </div>

              <div className="gv-card gv-stack-sm">
                <h3>Tài khoản đã chặn ({blocked.length})</h3>
                {blocked.length ? (
                  blocked.map((b) => (
                    <div className="gv-top" key={b.uid}>
                      <span>{b.nickname || "Người chơi"}</span>
                      <button
                        type="button"
                        className="gv-link"
                        onClick={() =>
                          void api
                            .request(
                              `/blocks/${encodeURIComponent(b.uid)}`,
                              "DELETE",
                            )
                            .then(() => {
                              setBlocked(blocked.filter((x) => x.uid !== b.uid));
                              showToast("Đã bỏ chặn.");
                            })
                            .catch((e) => setError(communityError(e)))
                        }
                      >
                        Bỏ chặn
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="gv-muted">Bạn chưa chặn tài khoản nào.</p>
                )}
              </div>

              <div className="gv-card gv-stack-sm">
                <h3>Dọn dẹp dữ liệu cộng đồng</h3>
                <p className="gv-muted">
                  Thư viện game và save cá nhân của bạn sẽ không bị ảnh hưởng.
                </p>
                <div className="gv-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void api
                        .request("/uploads", "DELETE")
                        .then(() => showToast("Đã dọn các ảnh nháp chưa đăng."))
                        .catch((e) => setError(communityError(e)))
                    }
                  >
                    Dọn ảnh nháp
                  </button>
                  <button
                    type="button"
                    className="gv-btn-danger"
                    onClick={() => setConfirmWipe(true)}
                  >
                    <Trash2 size={14} />
                    Xóa toàn bộ dữ liệu cộng đồng
                  </button>
                </div>
              </div>
            </div>

            <ProfileActivity
              key={me.uid}
              api={api}
              me={me}
              onGame={onGame}
              onProfile={onProfile}
              onPost={(post) => navigate({ post })}
              onToast={showToast}
            />

            <ConfirmModal
              open={confirmWipe}
              title="Xóa toàn bộ dữ liệu cộng đồng"
              message="Tất cả bài viết, ảnh cộng đồng, đánh giá và báo cáo FPS bạn đã đăng sẽ bị xóa vĩnh viễn. Thư viện riêng trên máy và Cloud Sync cá nhân không bị xóa."
              confirmLabel="Xóa dữ liệu cộng đồng"
              danger
              busy={loading}
              onCancel={() => setConfirmWipe(false)}
              onConfirm={() => {
                setLoading(true);
                void api
                  .request("/me", "DELETE")
                  .then(() => {
                    setConfirmWipe(false);
                    showToast("Đã xóa dữ liệu cộng đồng.");
                    return loadMe();
                  })
                  .catch((e) => setError(communityError(e)))
                  .finally(() => setLoading(false));
              }}
            />
          </div>
        ) : (
          <div className="gv-empty">
            <h3>Đăng nhập để thiết lập hồ sơ cộng đồng</h3>
            <p>Tạo biệt danh, chọn công khai BXH và xem lịch sử bài viết.</p>
            <button
              type="button"
              className="gv-primary"
              onClick={() => void signIn()}
            >
              Đăng nhập Google
            </button>
          </div>
        )
      ) : tab === "notifications" ? (
        /* TAB: THÔNG BÁO */
        me ? (
          <section className="gv-stack">
            <div className="gv-top">
              <div>
                <h2>Thông báo tương tác</h2>
                <p className="gv-muted">Lượt thả tim và bình luận mới nhất trên bài của bạn.</p>
              </div>
              <div className="gv-actions">
                <button type="button" onClick={() => void loadNotifications()}>
                  <RefreshCw size={14} /> Làm mới
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .request("/notifications/read", "PUT")
                      .then(() => {
                        showToast("Đã đánh dấu tất cả là đã đọc.");
                        return loadNotifications();
                      })
                      .catch((e) => setError(communityError(e)))
                  }
                >
                  Đánh dấu đã đọc
                </button>
              </div>
            </div>

            {notifications.items.length ? (
              <div className="gv-rank-list">
                {notifications.items.map((n) => (
                  <button
                    type="button"
                    className="gv-card-subtle"
                    key={n.id}
                    style={{
                      textAlign: "left",
                      justifyContent: "space-between",
                      borderColor: !n.read ? "rgba(56, 189, 248, 0.45)" : undefined,
                    }}
                    onClick={() => navigate({ post: n.postId })}
                  >
                    <span>
                      <strong>{n.nickname}</strong>{" "}
                      {n.kind === "like" ? "đã thả tim" : "đã bình luận"} bài viết của bạn
                    </span>
                    <span className="gv-actions">
                      <span className="gv-muted" style={{ fontSize: 12 }}>
                        {formatRelativeTime(n.createdAt)}
                      </span>
                      {!n.read && <span className="gv-pill gv-pill-cyan">Mới</span>}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="gv-empty">
                <p>Chưa có thông báo mới.</p>
              </div>
            )}

            {notifications.hasMore && (
              <button
                type="button"
                className="gv-pager"
                onClick={() => void loadNotifications(true)}
              >
                Xem thêm thông báo
              </button>
            )}
          </section>
        ) : (
          <div className="gv-empty">
            <p>Đăng nhập để xem thông báo tương tác.</p>
            <button
              type="button"
              className="gv-primary"
              onClick={() => void signIn()}
            >
              Đăng nhập Google
            </button>
          </div>
        )
      ) : tab === "moderation" && me?.isAdmin ? (
        /* TAB: QUẢN TRỊ */
        <section className="gv-stack">
          <div className="gv-top">
            <div>
              <h2>Báo cáo cần xử lý</h2>
              <p className="gv-muted">Kiểm duyệt nội dung được cộng đồng báo cáo.</p>
            </div>
            <button type="button" onClick={() => void loadReports()}>
              <RefreshCw size={14} /> Làm mới
            </button>
          </div>

          {reports.items.length ? (
            <div className="gv-stack">
              {reports.items.map((r) => (
                <article className="gv-card gv-stack-sm" key={r.id}>
                  <div className="gv-top">
                    <span className="gv-pill gv-pill-amber">{r.targetType}</span>
                    <span className="gv-muted">{formatRelativeTime(r.createdAt)}</span>
                  </div>
                  <strong>Lý do: {r.reason}</strong>
                  <p className="gv-post-body">{r.targetBody}</p>
                  <div className="gv-actions">
                    <button
                      type="button"
                      onClick={() =>
                        void api
                          .request(`/admin/reports/${r.id}`, "PUT", {
                            action: "dismiss",
                          })
                          .then(() => loadReports())
                          .catch((e) => setError(communityError(e)))
                      }
                    >
                      Bỏ qua
                    </button>
                    <button
                      type="button"
                      className="gv-btn-cyan"
                      onClick={() =>
                        void api
                          .request(`/admin/reports/${r.id}`, "PUT", {
                            action: "hide",
                          })
                          .then(() => loadReports())
                          .catch((e) => setError(communityError(e)))
                      }
                    >
                      Ẩn nội dung
                    </button>
                    <button
                      type="button"
                      className="gv-btn-danger"
                      onClick={() => setConfirmSuspendId(r.id)}
                    >
                      Hạn chế tác giả
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="gv-empty">
              <p>Không có báo cáo nào đang chờ xử lý.</p>
            </div>
          )}

          <ConfirmModal
            open={!!confirmSuspendId}
            title="Hạn chế tài khoản tác giả"
            message="Nội dung bị báo cáo sẽ bị ẩn và tác giả sẽ bị khóa quyền đăng nội dung công khai."
            confirmLabel="Hạn chế tài khoản"
            danger
            onCancel={() => setConfirmSuspendId(null)}
            onConfirm={() => {
              if (!confirmSuspendId) return;
              void api
                .request(`/admin/reports/${confirmSuspendId}`, "PUT", {
                  action: "suspend",
                })
                .then(() => {
                  setConfirmSuspendId(null);
                  showToast("Đã xử lý và hạn chế tài khoản.");
                  return loadReports();
                })
                .catch((e) => setError(communityError(e)));
            }}
          />

          {reports.hasMore && (
            <button
              type="button"
              className="gv-pager"
              onClick={() => void loadReports(true)}
            >
              Xem thêm báo cáo
            </button>
          )}
        </section>
      ) : tab === "monthly" ? (
        monthly
      ) : null}

      {toast && (
        <div className="gv-toast" role="status">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
