import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw, Trophy, Users, Vote } from "lucide-react";
import type {
  CommunityAdapter,
  PublicGame,
  SharedLibraryGame,
} from "../../shared/community.ts";
import type {
  AuthStatus,
  CommunityPick,
  Game,
  ReviewSyncResult,
} from "../../shared/types.ts";
import { CommunityHub } from "./CommunityHub.tsx";
import { communityError, qualifyCommunityUrl } from "./client.ts";

export function gameToPublic(game: Game): SharedLibraryGame {
  return {
    gameKey:
      game.steam_id && game.steam_id > 0
        ? String(game.steam_id)
        : `t_${game.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    title: game.title,
    steamId: game.steam_id && game.steam_id > 0 ? game.steam_id : null,
    coverUrl: game.cover_url,
    status: game.status,
    playtimeMinutes: game.playtime_minutes,
    localGameId: game.id,
  };
}

export function createDesktopAdapter(publicBase: string): CommunityAdapter {
  return {
    publicBase,
    request: async <T,>(
      path: string,
      method = "GET",
      body?: unknown,
    ): Promise<T> => {
      if (method === "PUT" && path === "/me" && (body as any)?.shareLibrary)
        await window.electronAPI.syncLibrary?.();
      return window.electronAPI.communityRequest!<T>(
        `/api/community${path}`,
        method,
        body,
      );
    },
    upload: async (file: File) =>
      window.electronAPI.communityUploadImage!(
        await file.arrayBuffer(),
        file.type,
      ),
    signIn: async () => {
      document
        .querySelector<HTMLButtonElement>("[data-navbar-sign-in]")
        ?.focus();
      throw new Error("Use the top-right account menu to sign in");
    },
  };
}

export function DesktopCommunity({
  authStatus,
  initialGame,
  onLocalGame,
}: {
  authStatus?: AuthStatus | null;
  initialGame?: PublicGame | null;
  onLocalGame?: (id: number) => void;
}) {
  const [base, setBase] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState("");
  const [reviewSync, setReviewSync] = useState<ReviewSyncResult | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);

  const syncReviews = async () => {
    if (!window.electronAPI.syncReviews) return;
    try {
      const result = await window.electronAPI.syncReviews();
      setReviewSync(result);
      if (result.synced > 0 || (result.migrated ?? 0) > 0) {
        setReviewVersion((v) => v + 1);
      }
    } catch (e) {
      setReviewSync({
        state: "pending",
        synced: 0,
        pending: 0,
        error: communityError(e),
      });
    }
  };

  useEffect(() => {
    if (authStatus?.loggedIn) void syncReviews();
  }, [authStatus?.loggedIn, authStatus?.profile?.uid]);

  useEffect(() => {
    void Promise.all([
      window.electronAPI.getCommunityBaseUrl!(),
      window.electronAPI.getGames(),
    ])
      .then(([b, g]) => {
        setBase(b);
        setGames(g);
      })
      .catch((e) => setError(communityError(e)));
  }, []);

  const api = useMemo(() => createDesktopAdapter(base), [base]);

  if (error)
    return (
      <div className="gv-community">
        <div className="gv-error">
          <span>{error}</span>
        </div>
        <p className="gv-muted">
          Hãy mở lại ứng dụng sau khi cập nhật để cầu nối cộng đồng được nạp.
        </p>
      </div>
    );

  if (!base)
    return (
      <div className="gv-community">
        <p role="status" className="gv-muted">
          Đang kết nối cộng đồng…
        </p>
      </div>
    );

  return (
    <>
      {authStatus?.loggedIn && reviewSync?.state === "pending" && (
        <div className="gv-community" style={{ paddingBottom: 0 }}>
          <div className="gv-notice" role="status">
            <span>
              Một số đánh giá cục bộ đang chờ đồng bộ lên Top game.
            </span>
            <button type="button" onClick={() => void syncReviews()}>
              Thử đồng bộ lại
            </button>
          </div>
        </div>
      )}
      <CommunityHub
        key={`${authStatus?.profile?.uid || "guest"}:${reviewVersion}`}
        api={api}
        embedded
        shellAuth={authStatus}
        initialGame={initialGame}
        onLocalGame={onLocalGame}
        games={games.map(gameToPublic)}
        onAdd={async (g) => {
          await window.electronAPI.addWishlistGame!({
            title: g.title,
            steamId: g.steamId || undefined,
            status: "backlog",
          });
          setGames(await window.electronAPI.getGames());
        }}
        monthly={<MonthlyPick publicBase={base} />}
      />
    </>
  );
}

function MonthlyPick({ publicBase }: { publicBase: string }) {
  const [pick, setPick] = useState<CommunityPick | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true);
    try {
      const [p, g] = await Promise.all([
        window.electronAPI.getCurrentPick!(),
        window.electronAPI.getGames(),
      ]);
      setPick(p);
      setGames(g);
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const voteCount = Object.keys(pick?.votes || {}).length;
  const coverUrl = pick?.coverUrl
    ? qualifyCommunityUrl(publicBase, pick.coverUrl)
    : "";

  return (
    <section className="gv-stack">
      <div className="gv-top">
        <div>
          <h2>Game cộng đồng tháng này</h2>
          <p className="gv-muted">
            Cả cộng đồng cùng bình chọn một tựa game để chơi và chia sẻ ảnh trong tháng.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={15} />
          Làm mới
        </button>
      </div>

      {error && <p className="gv-error">{error}</p>}

      <div className="gv-two-col">
        <div className="gv-card gv-stack">
          {pick ? (
            <div className="gv-actions" style={{ gap: 16, alignItems: "flex-start" }}>
              {coverUrl && (
                <img
                  className="gv-poster-md"
                  src={coverUrl}
                  alt={pick.gameTitle || "Monthly Pick"}
                />
              )}
              <div className="gv-stack-sm">
                <div className="gv-actions" style={{ gap: 8 }}>
                  <span className="gv-pill gv-pill-amber">
                    <CalendarDays size={12} /> {pick.month}
                  </span>
                  <span className="gv-pill gv-pill-emerald">
                    <Trophy size={12} />
                    {pick.state === "voting"
                      ? "Đang bình chọn"
                      : pick.state === "playing"
                        ? "Đang cùng chơi"
                        : "Đã kết thúc"}
                  </span>
                </div>
                <h3 style={{ fontSize: 20 }}>
                  {pick.gameTitle || "Đang chờ đề cử"}
                </h3>
                <span className="gv-muted">
                  <Users size={13} style={{ display: "inline", marginRight: 5 }} />
                  {voteCount} người đã tham gia bình chọn
                </span>
              </div>
            </div>
          ) : (
            !busy && (
              <p className="gv-muted">Chưa có game nào được chọn trong tháng này.</p>
            )
          )}
        </div>

        <form
          className="gv-card gv-stack"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void window.electronAPI
              .votePick!(Number(selected))
              .then(setPick)
              .catch((e) => setError(communityError(e)))
              .finally(() => setBusy(false));
          }}
        >
          <h3>Đề cử & Bình chọn</h3>
          <label>
            Chọn game trong thư viện của bạn
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              required
            >
              <option value="">-- Chọn game --</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <div className="gv-actions">
            <button type="submit" className="gv-primary" disabled={busy || !selected}>
              <Vote size={15} />
              Bình chọn
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void window.electronAPI
                  .unvotePick!()
                  .then(setPick)
                  .catch((e) => setError(communityError(e)))
              }
            >
              Rút bình chọn
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
