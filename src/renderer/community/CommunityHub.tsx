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
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
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
  CommunitySearchRequest,
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
  qualifyCommunityUrl,
  shareUrl,
} from "./client.ts";
import { GameHub } from "./GameHub.tsx";
import { PostCard } from "./PostCard.tsx";
import { PostComposer } from "./PostComposer.tsx";
import { loadCommunityIdentity } from "./identity.ts";
import { PlayerBoard } from "./PlayerBoard.tsx";
import { ProfileActivity } from "./ProfileActivity.tsx";
import { ProfileEditor } from "./ProfileEditor.tsx";
import { CommunitySearch } from "./CommunitySearch.tsx";
import { FollowButton } from "./FollowButton.tsx";
import { MonthlyRankings } from "./MonthlyRankings.tsx";
import { currentRankingMonth } from "../../shared/monthly.ts";
import { Avatar, ConfirmModal, PlaytimeDisplay, playtimeBreakdown, scoreTierClass } from "./CommunityWidgets.tsx";
import "./community.css";

type Tab =
  | "search"
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
  searchRequest,
  onBackToLibrary,
  api,
  games = [],
  onAdd,
  embedded = false,
  shellAuth,
  initialGame,
  profileRequest = 0,
  onLocalGame,
}: {
  searchRequest?: CommunitySearchRequest;
  onBackToLibrary?: () => void;
  api: CommunityAdapter;
  games?: SharedLibraryGame[];
  onAdd?: (g: PublicGame) => Promise<void>;
  embedded?: boolean;
  shellAuth?: AuthStatus | null;
  initialGame?: PublicGame | null;
  profileRequest?: number;
  onLocalGame?: (id: number) => void;
}) {
  const [tab, setTab] = useState<Tab>(profileRequest ? "profile" : "feed");
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
  const [following, setFollowing] = useState(false);
  const [postQuery, setPostQuery] = useState("");
  const [searchVersion, setSearchVersion] = useState(0);
  const [playerQuery, setPlayerQuery] = useState("");
  const [followingOnly, setFollowingOnly] = useState(false);
  const [people, setPeople] = useState<Page<PublicProfile>>(empty());
  const [peopleLoading, setPeopleLoading] = useState(false);
  const peopleSequence = useRef(0);
  const feedSequence = useRef(0);
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);
  const [composer, setComposer] = useState(false);
  const [composerKind, setComposerKind] = useState<"thought" | "photo" | "question" | "completed">("thought");

  const [query, setQuery] = useState("");
  const [gameQuery, setGameQuery] = useState("");
  const [sort, setSort] = useState("hours");
  const [classification, setClassification] = useState<
    "all" | "offline" | "online"
  >("all");
  const [rankings, setRankings] = useState<Page<GameRanking>>(empty());
  const [monthlyMonth, setMonthlyMonth] = useState(currentRankingMonth);
  const [gameReturnTab, setGameReturnTab] = useState<"discover" | "monthly">("discover");

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [profileReviews, setProfileReviews] = useState<Page<CommunityPost>>(empty());
  const [profileReviewsLoading, setProfileReviewsLoading] = useState(false);
  const [blocked, setBlocked] = useState<Array<{ uid: string; nickname: string }>>([]);
  const [notifications, setNotifications] = useState<Page<CommunityNotification>>(empty());
  const [reports, setReports] = useState<Page<ModerationReport>>(empty());
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmSuspendId, setConfirmSuspendId] = useState<string | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSubTab, setProfileSubTab] = useState<"activity" | "games">("activity");
  const [publicProfileSubTab, setPublicProfileSubTab] = useState<"activity" | "reviews" | "games">("activity");

  const rankingSequence = useRef(0);
  const profileReviewsSequence = useRef(0);
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
      const ticket = ++feedSequence.current;
      setLoading(true);
      if (!more) setFeed(empty());
      try {
        const params = new URLSearchParams({
          offset: String(more ? feed.nextOffset : 0),
        });
        if (!route.profile && saved) params.set("saved", "true");
        if (!route.profile && following) params.set("following", "true");
        if (!route.profile && postQuery) params.set("q", postQuery);
        if (!route.profile && kind) params.set("kind", kind);
        if (route.profile) params.set("uid", route.profile);
        if (!route.post) params.set("excludeKind", "review");
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
        if (ticket !== feedSequence.current) return;
        setFeed(
          more
            ? {
                ...next,
                items: [...feed.items, ...next.items],
              }
            : next,
        );
      } catch (e) {
        if (ticket !== feedSequence.current) return;
        setError(communityError(e));
        setFeed(empty());
      } finally {
        if (ticket === feedSequence.current) setLoading(false);
      }
    },
    [api, saved, following, postQuery, kind, route.post, route.profile, feed.nextOffset, feed.items],
  );

  useEffect(() => {
    if (!route.game && (tab === "feed" || route.post || route.profile))
      void loadFeed();
    return () => { feedSequence.current++; };
  }, [api, saved, following, postQuery, searchVersion, kind, route.post, route.profile, route.game, tab, me?.uid]);

  useEffect(() => {
    if (!route.profile) {
      setProfileReviews(empty());
      setProfileReviewsLoading(false);
      return;
    }

    const ticket = ++profileReviewsSequence.current;
    setProfileReviews(empty());
    setProfileReviewsLoading(true);
    const params = new URLSearchParams({ uid: route.profile, kind: "review" });
    void api
      .request<Page<CommunityPost>>(`/posts?${params}`)
      .then((next) => {
        if (ticket === profileReviewsSequence.current) setProfileReviews(next);
      })
      .catch((e) => {
        if (ticket === profileReviewsSequence.current) setError(communityError(e));
      })
      .finally(() => {
        if (ticket === profileReviewsSequence.current) setProfileReviewsLoading(false);
      });
    return () => {
      profileReviewsSequence.current++;
    };
  }, [api, route.profile]);

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

  const refreshProfileReview = async (id: string) => {
    try {
      const latest = await api.request<CommunityPost>(`/posts/${id}`);
      setProfileReviews((previous) => ({
        ...previous,
        items: previous.items.map((post) => (post.id === id ? latest : post)),
      }));
    } catch (e) {
      if (/not found/.test(String((e as Error).message))) {
        setProfileReviews((previous) => ({
          ...previous,
          items: previous.items.filter((post) => post.id !== id),
        }));
      } else setError(communityError(e));
    }
  };

  const loadMoreProfileReviews = async () => {
    if (!route.profile || profileReviewsLoading || !profileReviews.hasMore) return;
    const ticket = ++profileReviewsSequence.current;
    setProfileReviewsLoading(true);
    const params = new URLSearchParams({
      uid: route.profile,
      kind: "review",
      offset: String(profileReviews.nextOffset),
    });
    try {
      const next = await api.request<Page<CommunityPost>>(`/posts?${params}`);
      if (ticket === profileReviewsSequence.current) {
        setProfileReviews((previous) => ({
          ...next,
          items: [...previous.items, ...next.items],
        }));
      }
    } catch (e) {
      if (ticket === profileReviewsSequence.current) setError(communityError(e));
    } finally {
      if (ticket === profileReviewsSequence.current) setProfileReviewsLoading(false);
    }
  };

  const loadRankings = async (more = false) => {
    const ticket = ++rankingSequence.current;
    setLoading(true);
    setError("");
    try {
      const p = await api.request<Page<GameRanking>>(
        `/rankings?sort=${sort}&classification=${classification}&q=${encodeURIComponent(gameQuery)}&offset=${more ? rankings.nextOffset : 0}`,
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
  }, [api, tab, sort, classification, gameQuery, route.game, route.profile, route.post, me?.uid]);

  useEffect(() => {
    if (route.profile) {
      let active = true;
      setProfile(null);
      setLoading(true);
      void api
        .request<PublicProfile>(
          `/profiles/${encodeURIComponent(route.profile)}`,
        )
        .then((next) => { if (active) setProfile(next); })
        .catch((e) => {
          if (!active) return;
          setProfile(null);
          setError(communityError(e));
        })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }
  }, [api, route.profile, me?.uid]);

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
  };

  const onGame = (g: PublicGame) => {
    setGameReturnTab(tab === "monthly" ? "monthly" : "discover");
    navigate({ game: g });
  };
  const onProfile = (uid: string) => navigate({ profile: uid });

  useEffect(() => {
    if (!embedded) return;
    if (initialGame) navigate({ game: initialGame });
    else switchTab(profileRequest ? "profile" : "feed");
  }, [embedded, initialGame, profileRequest]);

  const searchCommunity = (request: CommunitySearchRequest) => {
    setSearchVersion((version) => version + 1);
    setSaved(false);
    setFollowing(false);
    setError("");
    if (request.scope === "posts") {
      setPostQuery(request.query);
      switchTab("feed");
    } else {
      setFollowingOnly(false);
      setPlayerQuery(request.query);
      switchTab("search");
    }
  };

  useEffect(() => {
    if (searchRequest) searchCommunity(searchRequest);
  }, [searchRequest]);

  const loadPeople = async (more = false) => {
    const ticket = ++peopleSequence.current;
    setPeopleLoading(true);
    try {
      const params = new URLSearchParams({ q: playerQuery, offset: String(more ? people.nextOffset : 0) });
      if (followingOnly) params.set("following", "true");
      const next = await api.request<Page<PublicProfile>>(`/profiles?${params}`);
      if (ticket === peopleSequence.current) setPeople(more ? { ...next, items: [...people.items, ...next.items] } : next);
    } catch (e) {
      if (ticket === peopleSequence.current) setError(communityError(e));
    } finally {
      if (ticket === peopleSequence.current) setPeopleLoading(false);
    }
  };
  useEffect(() => {
    if (tab === "search" && !route.profile) { setPeople(empty()); void loadPeople(); }
    return () => { peopleSequence.current++; };
  }, [api, tab, playerQuery, searchVersion, followingOnly, route.profile, me?.uid]);

  const followControl = (person: PublicProfile, update: (next: PublicProfile) => void) => (
    <FollowButton key={person.uid} api={api} profile={person} myUid={me?.uid} onSignIn={() => void signIn()}
      onError={setError} onChanged={(next) => { update(next); void loadMe(); }} />
  );

  const renderRankingCard = (g: GameRanking, rank: number, isPodium: boolean) => {
    const poster = g.coverUrl ? qualifyCommunityUrl(api.publicBase, g.coverUrl) : "";
    const rawBanner =
      g.bannerUrl ||
      (g.steamId
        ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.steamId}/header.jpg`
        : "");
    const banner = rawBanner ? qualifyCommunityUrl(api.publicBase, rawBanner) : "";
    const podiumTierClass =
      rank === 1 ? "gv-pill-amber" : rank === 2 ? "gv-pill-cyan" : "gv-pill-accent";

    return (
      <button
        type="button"
        key={g.gameKey}
        className={`gv-game-row ${isPodium ? `is-podium rank-${rank}` : ""}`}
        onClick={() => onGame(g)}
      >
        {(banner || poster) && (
          <img
            src={banner || poster}
            alt=""
            loading="lazy"
            className={`gv-row-backdrop ${!banner ? "is-blur" : ""}`}
          />
        )}
        <div className="gv-row-backdrop-fade" />

        <div className="gv-game-row-left">
          <div className="gv-game-row-rank">
            {isPodium ? (
              <span className={`gv-pill ${podiumTierClass}`}>
                <Trophy size={13} /> #{rank}
              </span>
            ) : (
              <span className="gv-pill gv-rank-badge">#{rank}</span>
            )}
          </div>

          {poster ? (
            <img
              className={`gv-game-row-poster ${isPodium ? "is-lg" : ""}`}
              src={poster}
              alt=""
              loading="lazy"
            />
          ) : (
            <div className={`gv-game-row-poster ${isPodium ? "is-lg" : ""}`} />
          )}

          <div className="gv-game-row-info">
            <h3 className={`gv-game-row-title ${isPodium ? "is-lg" : ""}`}>{g.title}</h3>
            <div className="gv-actions" style={{ gap: 8 }}>
              <span
                className={`gv-pill ${
                  g.classification === "online"
                    ? "gv-pill-cyan"
                    : g.classification === "offline" || g.classification === "hybrid"
                      ? "gv-pill-emerald"
                      : ""
                }`}
              >
                {g.classification === "online"
                  ? "Online"
                  : g.classification === "offline" || g.classification === "hybrid"
                    ? "Offline"
                    : "Chưa phân loại"}
              </span>
              <span className="gv-muted" style={{ fontSize: 12 }}>
                {g.reviewCount > 0
                  ? `${g.reviewCount} lượt đánh giá`
                  : "Xem cấu hình & đánh giá"}
              </span>
            </div>
          </div>
        </div>

        <div className="gv-game-row-right">
          <div className="gv-game-row-stats">
            <div className="gv-stat-mini">
              <span className="gv-stat-mini-label">Giờ tính top</span>
              <span className="gv-stat-mini-value gv-text-emerald">
                <PlaytimeDisplay
                  totalMinutes={g.totalMinutes}
                  recordedMinutes={g.recordedMinutes}
                  showRanked
                  focusable={false}
                />
              </span>
            </div>
            <div className="gv-stat-mini">
              <span className="gv-stat-mini-label">Người chơi</span>
              <span className="gv-stat-mini-value">{g.players}</span>
            </div>
            <div className="gv-stat-mini">
              <span className="gv-stat-mini-label">Phá đảo</span>
              <span className="gv-stat-mini-value gv-text-cyan">{g.completedPlayers}</span>
            </div>
          </div>
          {g.averageScore != null ? (
            <span className={`gv-score-pill ${scoreTierClass(g.averageScore)}`}>
              <Star size={12} /> {g.averageScore.toFixed(1)}/10
            </span>
          ) : (
            <span className="gv-pill">Chưa chấm</span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="gv-community">
      {onBackToLibrary && <div className="gv-library-return"><button type="button" className="gv-link" onClick={onBackToLibrary}>
        <ArrowLeft size={15} /> Quay lại thư viện
      </button></div>}
      {!embedded && <CommunitySearch onSearch={searchCommunity} />}
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
              ["monthly", "Game tháng này", CalendarDays],
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
          onBack={() => switchTab(gameReturnTab)}
          backLabel={gameReturnTab === "monthly" ? "Quay lại Game tháng này" : undefined}
          onGame={onGame}
          onProfile={onProfile}
          onAdd={onAdd}
          localGame={games.find((g) => g.gameKey === route.game!.gameKey)}
          onLocalGame={onLocalGame}
          onToast={showToast}
        />
      ) : route.profile ? (
        /* ROUTE: PUBLIC PROFILE (Discord / Threads / Facebook Style) */
        <section className="gv-stack">
          <div>
            <button
              type="button"
              className="gv-link"
              onClick={() => switchTab("players")}
            >
              <ArrowLeft size={15} />
              Quay lại
            </button>
          </div>

          {profile && (
            <div className="gv-profile-hero">
              <div className="gv-profile-banner">
                {profile.bannerUrl &&
                  qualifyCommunityUrl(api.publicBase, profile.bannerUrl) && (
                    <img
                      src={qualifyCommunityUrl(api.publicBase, profile.bannerUrl)}
                      alt=""
                    />
                  )}
                <div className="gv-profile-banner-fade" />
              </div>

              <div className="gv-profile-body">
                <div className="gv-profile-top-row">
                  <div className="gv-profile-avatar-wrap">
                    <Avatar
                      name={profile.nickname}
                      url={profile.avatarUrl}
                      size={84}
                    />
                  </div>
                  <div className="gv-actions">
                    {followControl(profile, setProfile)}
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(shareUrl(api.publicBase, "profile", profile.uid))
                          .then(() => showToast("Đã sao chép liên kết hồ sơ."))
                          .catch(() => {})
                      }
                    >
                      <Share2 size={14} /> Chia sẻ
                    </button>
                    <a
                      className="gv-button"
                      href={shareUrl(api.publicBase, "profile", profile.uid)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />
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
                        Chặn
                      </button>
                    )}
                  </div>
                </div>

                <div className="gv-stack-sm">
                  <div className="gv-actions" style={{ gap: 10 }}>
                    <h2 style={{ fontSize: 24 }}>{profile.nickname}</h2>
                  </div>
                  <p style={{ color: "#cbd5e1", fontSize: 14 }}>
                    {profile.bio || "Thành viên cộng đồng GameVault"}
                  </p>
                </div>

                <p className="gv-muted">{profile.followersCount ?? 0} người theo dõi · Đang theo dõi {profile.followingCount ?? 0}</p>
                {profile.shareLibrary && (
                  <div className="gv-profile-stats-row">
                    <span className="gv-pill gv-pill-emerald">
                      <CheckCircle2 size={13} />
                      {profile.completedGames ?? 0} đã phá đảo
                    </span>
                    <span className="gv-pill">
                      <Gamepad2 size={13} />
                      {profile.playedGames ?? 0} game đã chơi
                    </span>
                    <span className="gv-pill gv-pill-cyan" title="Tổng thời gian tất cả game, kể cả game treo máy">
                      <Clock size={13} />
                      <PlaytimeDisplay
                        totalMinutes={profile.totalMinutes ?? 0}
                        recordedMinutes={profile.recordedMinutes}
                      />
                    </span>
                    <span className="gv-pill">
                      <Gamepad2 size={13} />
                      {profile.totalGames ?? profile.games?.length ?? 0} game
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="gv-chip-row">
            <button
              type="button"
              className={`gv-chip ${publicProfileSubTab === "activity" ? "active" : ""}`}
              onClick={() => setPublicProfileSubTab("activity")}
            >
              Bài viết ({feed.items.length})
            </button>
            <button
              type="button"
              className={`gv-chip ${publicProfileSubTab === "reviews" ? "active" : ""}`}
              onClick={() => setPublicProfileSubTab("reviews")}
            >
              Đánh giá ({profileReviews.items.length})
            </button>
            <button
              type="button"
              className={`gv-chip ${publicProfileSubTab === "games" ? "active" : ""}`}
              onClick={() => setPublicProfileSubTab("games")}
            >
              Thư viện game ({profile?.games?.length || 0})
            </button>
          </div>

          {publicProfileSubTab === "activity" ? (
            <div className="gv-feed-grid">
              {feed.items.length === 0 ? (
                <div className="gv-empty">
                  <p>Người chơi này chưa đăng bài viết nào.</p>
                </div>
              ) : (
                feed.items.map((p) => (
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
                ))
              )}
            </div>
          ) : publicProfileSubTab === "reviews" ? (
            <div className="gv-stack">
              {profileReviewsLoading && (
                <p className="gv-muted" role="status">
                  Đang tải đánh giá…
                </p>
              )}
              {!profileReviewsLoading && profileReviews.items.length === 0 && (
                <div className="gv-empty">
                  <p>Người chơi này chưa có đánh giá nào.</p>
                </div>
              )}
              {profileReviews.items.length > 0 && (
                <div className="gv-feed-grid">
                  {profileReviews.items.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      api={api}
                      me={me}
                      onChanged={() => void refreshProfileReview(post.id)}
                      onGame={onGame}
                      onProfile={onProfile}
                      onToast={showToast}
                    />
                  ))}
                </div>
              )}
              {profileReviews.hasMore && (
                <button
                  type="button"
                  className="gv-pager"
                  disabled={profileReviewsLoading}
                  onClick={() => void loadMoreProfileReviews()}
                >
                  Xem thêm đánh giá
                </button>
              )}
            </div>
          ) : profile?.shareLibrary ? (
            profile.games?.length ? (
              <div className="gv-profile-games-grid">
                {profile.games.map((g) => {
                  const img = g.coverUrl
                    ? qualifyCommunityUrl(api.publicBase, g.coverUrl)
                    : "";
                  return (
                    <button
                      type="button"
                      className="gv-profile-game-card"
                      key={g.gameKey}
                      onClick={() => onGame(g)}
                    >
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
                      <div style={{ minWidth: 0 }}>
                        <strong
                          style={{
                            display: "block",
                            fontSize: 13,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {g.title}
                        </strong>
                        <span className="gv-muted" style={{ fontSize: 12 }}>
                          <PlaytimeDisplay
                            totalMinutes={g.playtimeMinutes}
                            recordedMinutes={g.recordedPlaytimeMinutes}
                            focusable={false}
                          /> ·{" "}
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
                  );
                })}
              </div>
            ) : (
              <div className="gv-empty">
                <p>Chưa có game nào được chia sẻ.</p>
              </div>
            )
          ) : (
            <div className="gv-empty">
              <p>Người chơi này đang giữ riêng tư thư viện.</p>
            </div>
          )}
        </section>
      ) : tab === "search" ? (
        <section className="gv-stack">
          <div className="gv-top"><h2>{followingOnly ? "Người chơi bạn đang theo dõi" : playerQuery ? `Người chơi: ${playerQuery}` : "Tìm người chơi để theo dõi"}</h2></div>
          {peopleLoading && <p role="status" className="gv-muted">Đang tìm người chơi…</p>}
          {!peopleLoading && !people.items.length && <p className="gv-empty">Không tìm thấy người chơi phù hợp. Hãy thử biệt danh khác.</p>}
          <div className="gv-stack-sm">{people.items.map((person) => <div key={person.uid} className="gv-player-search-row">
            <button className="gv-player-search-identity" type="button" onClick={() => onProfile(person.uid)}>
              <Avatar name={person.nickname} url={person.avatarUrl} size={40} />
              <span><strong>{person.nickname}</strong><span className="gv-muted">{person.bio || "Thành viên GameVault"}</span></span>
            </button>
            {followControl(person, (next) => setPeople((current) => ({ ...current, items: current.items.map((p) => p.uid === next.uid ? next : p) })))}
          </div>)}</div>
          {people.hasMore && <button disabled={peopleLoading} onClick={() => void loadPeople(true)}>Xem thêm người chơi</button>}
        </section>
      ) : tab === "feed" || route.post ? (
        /* TAB: BẢNG TIN (Kiểu mạng xã hội — chỉ bài đăng của người chơi, review nằm trong từng game) */
        <section className="gv-stack">
          {!route.post && postQuery && <div className="gv-top"><h2>Bài viết về {postQuery}</h2>
            <button type="button" onClick={() => setPostQuery("")}><X size={14} /> Xóa tìm kiếm</button></div>}
          {!route.post && (
            <>
              <div className="gv-fb-composer-bar">
                <div className="gv-actions" style={{ gap: 12 }}>
                  <Avatar name={me?.nickname || "P"} url={me?.avatarUrl} size={40} />
                  <button
                    type="button"
                    className="gv-fb-prompt"
                    onClick={() => {
                      if (!me) return void signIn();
                      setComposerKind("thought");
                      setComposer(true);
                    }}
                  >
                    {me
                      ? `${me.nickname} ơi, bạn đang chơi game gì? Chia sẻ khoảnh khắc hoặc cảm nhận...`
                      : "Đăng nhập để chia sẻ bài viết, ảnh chụp và thảo luận cùng cộng đồng..."}
                  </button>
                </div>
                <div className="gv-top" style={{ paddingTop: 8, borderTop: "1px solid rgba(42, 46, 61, 0.55)" }}>
                  <div className="gv-chip-row">
                    {(
                      [
                        ["photo", "Ảnh game"],
                        ["thought", "Cảm nhận"],
                        ["question", "Hỏi đáp"],
                        ["completed", "Vừa phá đảo"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        type="button"
                        key={k}
                        className="gv-chip"
                        onClick={() => {
                          if (!me) return void signIn();
                          setComposerKind(k);
                          setComposer(true);
                        }}
                      >
                        + {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadFeed()}
                    disabled={loading}
                  >
                    <RefreshCw size={14} />
                    Làm mới
                  </button>
                </div>
              </div>

              <div className="gv-top">
                <div className="gv-chip-row">
                  <button
                    type="button"
                    className={`gv-chip ${!saved && !following ? "active" : ""}`}
                    onClick={() => { setSaved(false); setFollowing(false); }}
                  >
                    <Sparkles size={12} /> Mới nhất
                  </button>
                  <button
                    type="button"
                    className={`gv-chip ${saved ? "active" : ""}`}
                    onClick={() => { if (!me) return void signIn(); setSaved(true); setFollowing(false); }}
                  >
                    <Bookmark size={12} /> Đã lưu
                  </button>
                  <button type="button" className={`gv-chip ${following ? "active" : ""}`}
                    onClick={() => { if (!me) return void signIn(); setFollowing(true); setSaved(false); }}>
                    <Users size={12} /> Đang theo dõi
                  </button>
                </div>

                <div className="gv-chip-row">
                  {[
                    ["", "Tất cả bài đăng"],
                    ["photo", "Ảnh game"],
                    ["thought", "Cảm nhận"],
                    ["question", "Hỏi đáp"],
                    ["completed", "Phá đảo"],
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
                  key={composerKind}
                  api={api}
                  games={games}
                  initialKind={composerKind}
                  onPosted={() => {
                    setComposer(false);
                    showToast("Đã đăng bài lên bảng tin!");
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
                {postQuery ? "Không tìm thấy bài viết phù hợp" : following ? "Chưa có bài viết từ người bạn theo dõi" : saved ? "Chưa có bài viết đã lưu" : "Chưa có bài viết nào"}
              </h3>
              <p>
                {following ? "Tìm người chơi ở thanh trên rồi nhấn Theo dõi để xem bài mới của họ tại đây." : postQuery ? "Hãy thử tên game khác hoặc xóa tìm kiếm." : "Hãy chọn một game từ thư viện hoặc Top game để chia sẻ khoảnh khắc, cảm nhận đầu tiên!"}
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
          onGame={onGame}
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

          <div className="gv-topgames-toolbar">
            <form
              className="gv-topgames-search"
              onSubmit={(e) => {
                e.preventDefault();
                setGameQuery(query.trim());
              }}
            >
              <input
                maxLength={80}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm tên game trong cộng đồng..."
              />
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
                  Xóa
                </button>
              )}
            </form>

            <div className="gv-chip-row">
              {[
                ["hours", "Giờ app ghi nhận"],
                ["score", "Điểm đánh giá cao"],
                ["completed", "Nhiều người phá đảo"],
                ["players", "Nhiều người chơi"],
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

            <div className="gv-chip-row" aria-label="Phân loại chế độ chơi">
              {(
                [
                  ["all", "Tất cả"],
                  ["offline", "Offline"],
                  ["online", "Online"],
                ] as const
              ).map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  className={`gv-chip ${classification === id ? "active" : ""}`}
                  aria-pressed={classification === id}
                  onClick={() => setClassification(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading && rankings.items.length === 0 && (
            <p className="gv-muted" role="status">
              Đang tải bảng xếp hạng game…
            </p>
          )}

          {rankings.items.length > 0 && (
            <div className="gv-game-list">
              {rankings.items.map((g, index) =>
                renderRankingCard(g, index + 1, !gameQuery && index < 3),
              )}
            </div>
          )}

          {!loading && !error && rankings.items.length === 0 && (
            <div className="gv-empty">
              <Gamepad2 size={20} className="gv-text-cyan" />
              <p>
                {sort === "score"
                  ? "Chưa có game nào được chấm điểm phù hợp bộ lọc."
                  : gameQuery || classification !== "all"
                    ? "Không tìm thấy game phù hợp với bộ lọc hiện tại."
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
        /* TAB: HỒ SƠ CÁ NHÂN (Discord / Threads / Facebook Profile Style) */
        me ? (
          <section className="gv-stack">
            <div className="gv-profile-hero">
              <div className="gv-profile-banner">
                {me.bannerUrl &&
                  qualifyCommunityUrl(api.publicBase, me.bannerUrl) && (
                    <img
                      src={qualifyCommunityUrl(api.publicBase, me.bannerUrl)}
                      alt=""
                    />
                  )}
                <div className="gv-profile-banner-fade" />
              </div>

              <div className="gv-profile-body">
                <div className="gv-profile-top-row">
                  <div className="gv-profile-avatar-wrap">
                    <Avatar
                      name={me.nickname}
                      url={me.avatarUrl}
                      size={88}
                    />
                  </div>
                  <div className="gv-actions">
                    <button
                      type="button"
                      className="gv-primary"
                      onClick={() => setEditProfileOpen(true)}
                    >
                      <Pencil size={14} />
                      Chỉnh sửa hồ sơ
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(shareUrl(api.publicBase, "profile", me.uid))
                          .then(() => showToast("Đã sao chép liên kết hồ sơ."))
                          .catch(() => {})
                      }
                    >
                      <Share2 size={14} />
                      Chia sẻ
                    </button>
                    <button
                      type="button"
                      onClick={() => onProfile(me.uid)}
                      title="Xem dưới góc nhìn người khác"
                    >
                      <ExternalLink size={14} />
                      Xem công khai
                    </button>
                  </div>
                </div>

                {me.suspended && (
                  <p className="gv-error">
                    Tài khoản đang bị hạn chế đăng nội dung.
                  </p>
                )}

                <div className="gv-stack-sm">
                  <div className="gv-actions" style={{ gap: 10 }}>
                    <h2 style={{ fontSize: 24 }}>{me.nickname}</h2>
                  </div>
                  <p style={{ color: "#cbd5e1", fontSize: 14 }}>
                    {me.bio || "Chưa có giới thiệu. Bấm \"Chỉnh sửa hồ sơ\" để thêm mô tả cá nhân hoặc cấu hình PC của bạn."}
                  </p>
                </div>

                <div className="gv-actions">
                  <span className="gv-muted">{me.followersCount ?? 0} người theo dõi</span>
                  <button type="button" className="gv-link" onClick={() => { setFollowingOnly(true); setPlayerQuery(""); switchTab("search"); }}>
                    Đang theo dõi {me.followingCount ?? 0}
                  </button>
                </div>
                <div className="gv-profile-stats-row">
                  <span className="gv-pill gv-pill-emerald">
                    <CheckCircle2 size={13} />
                    {embedded ? games.filter((g) => g.status === "completed").length : me.completedGames ?? 0} đã phá đảo
                  </span>
                  <span className="gv-pill">
                    <Gamepad2 size={13} />
                    {embedded ? games.filter((g) => g.playtimeMinutes > 0 || ["playing", "completed", "paused", "dropped"].includes(g.status)).length : me.playedGames ?? 0} game đã chơi
                  </span>
                  <span className="gv-pill gv-pill-cyan" title="Tổng thời gian tất cả game, kể cả game treo máy">
                    <Clock size={13} />
                    <PlaytimeDisplay
                      totalMinutes={embedded ? games.reduce((s, g) => s + (g.playtimeMinutes || 0), 0) : me.totalMinutes ?? 0}
                      recordedMinutes={embedded
                        ? games.reduce((s, g) => s + playtimeBreakdown(g.playtimeMinutes, g.recordedPlaytimeMinutes).recorded, 0)
                        : me.recordedMinutes}
                    />
                  </span>
                  <span className="gv-pill">
                    <Gamepad2 size={13} />
                    {embedded ? games.length : me.totalGames ?? 0} game trong thư viện
                  </span>
                </div>
              </div>
            </div>

            <div className="gv-chip-row">
              <button
                type="button"
                className={`gv-chip ${profileSubTab === "activity" ? "active" : ""}`}
                onClick={() => setProfileSubTab("activity")}
              >
                Lịch sử hoạt động
              </button>
              <button
                type="button"
                className={`gv-chip ${profileSubTab === "games" ? "active" : ""}`}
                onClick={() => setProfileSubTab("games")}
              >
                Thư viện của tôi ({games.length})
              </button>
            </div>

            {profileSubTab === "activity" ? (
              <ProfileActivity
                key={me.uid}
                api={api}
                me={me}
                onGame={onGame}
                onProfile={onProfile}
                onPost={(post) => navigate({ post })}
                onToast={showToast}
              />
            ) : games.length > 0 ? (
              <div className="gv-profile-games-grid">
                {[...games]
                  .sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0))
                  .map((g) => {
                    const img = g.coverUrl
                      ? qualifyCommunityUrl(api.publicBase, g.coverUrl)
                      : "";
                    return (
                      <button
                        type="button"
                        className="gv-profile-game-card"
                        key={g.gameKey}
                        onClick={() => onGame(g)}
                      >
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
                        <div style={{ minWidth: 0 }}>
                          <strong
                            style={{
                              display: "block",
                              fontSize: 13,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {g.title}
                          </strong>
                          <span className="gv-muted" style={{ fontSize: 12 }}>
                            <PlaytimeDisplay
                              totalMinutes={g.playtimeMinutes}
                              recordedMinutes={g.recordedPlaytimeMinutes}
                              focusable={false}
                            /> ·{" "}
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
                    );
                  })}
              </div>
            ) : (
              <div className="gv-empty">
                <p>Chưa có game nào trong thư viện.</p>
              </div>
            )}

            {/* Edit profile and account settings */}
            {editProfileOpen && (
              <div
                className="gv-modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="gv-edit-profile-title"
                onClick={() => { if (!profileSaving) setEditProfileOpen(false); }}
              >
                <div
                  className="gv-modal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="gv-modal-head">
                    <div className="gv-modal-title">
                      <Settings size={18} className="gv-text-cyan" />
                      <h3 id="gv-edit-profile-title">Chỉnh sửa hồ sơ</h3>
                    </div>
                    <button
                      type="button"
                      className="gv-icon-btn"
                      disabled={profileSaving}
                      onClick={() => { if (!profileSaving) setEditProfileOpen(false); }}
                      aria-label="Đóng"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <ProfileEditor
                    api={api}
                    me={me}
                    onBusyChange={setProfileSaving}
                    onCancel={() => setEditProfileOpen(false)}
                    onSaved={async () => {
                      await loadMe();
                      setEditProfileOpen(false);
                      showToast("Đã cập nhật hồ sơ.");
                    }}
                  />

                  <div
                    className="gv-stack-sm"
                    style={{
                      paddingTop: 14,
                      borderTop: "1px solid var(--gv-border)",
                    }}
                  >
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
                                  setBlocked(
                                    blocked.filter((x) => x.uid !== b.uid),
                                  );
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
                      <p className="gv-muted">Chưa chặn tài khoản nào.</p>
                    )}
                  </div>

                  <div
                    className="gv-stack-sm"
                    style={{
                      paddingTop: 14,
                      borderTop: "1px solid var(--gv-border)",
                    }}
                  >
                    <h3>Dọn dẹp dữ liệu cộng đồng</h3>
                    <div className="gv-actions">
                      <button
                        type="button"
                        onClick={() =>
                          void api
                            .request("/uploads", "DELETE")
                            .then(() =>
                              showToast("Đã dọn các ảnh nháp chưa đăng."),
                            )
                            .catch((e) => setError(communityError(e)))
                        }
                      >
                        Dọn ảnh nháp
                      </button>
                      <button
                        type="button"
                        className="gv-btn-danger"
                        onClick={() => {
                          setEditProfileOpen(false);
                          setConfirmWipe(true);
                        }}
                      >
                        <Trash2 size={14} />
                        Xóa toàn bộ dữ liệu cộng đồng
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
          </section>
        ) : (
          <div className="gv-empty">
            <h3>Đăng nhập để thiết lập hồ sơ cộng đồng</h3>
            <p>Tạo biệt danh, cập nhật ảnh hồ sơ và xem lịch sử bài viết.</p>
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
        <MonthlyRankings api={api} onGame={onGame} month={monthlyMonth} onMonthChange={setMonthlyMonth} />
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
