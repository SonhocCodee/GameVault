import React, { useEffect, useMemo, useState } from "react";
import type { CommunityAdapter, PublicGame, SharedLibraryGame } from "../../shared/community.ts";
import type { AuthStatus, CommunityPick, Game, ReviewSyncResult } from "../../shared/types.ts";
import { CommunityHub } from "./CommunityHub.tsx";
import { communityError } from "./client.ts";
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
  const [base, setBase] = useState(""),
    [games, setGames] = useState<Game[]>([]),
    [error, setError] = useState("");
  const [reviewSync, setReviewSync] = useState<ReviewSyncResult | null>(null);
  const [syncingReviews, setSyncingReviews] = useState(false);
  const [reviewVersion, setReviewVersion] = useState(0);
  const syncReviews = async () => {
    if (!window.electronAPI.syncReviews) return;
    setSyncingReviews(true);
    try {
      const result = await window.electronAPI.syncReviews();
      setReviewSync(result);
      if (result.synced > 0) setReviewVersion(v => v + 1);
    } catch (error) {
      setReviewSync({ state: "pending", synced: 0, pending: 0, error: communityError(error) });
    } finally { setSyncingReviews(false); }
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
        <p className="gv-error">{error}</p>
        <p>
          Hãy mở lại ứng dụng sau khi cập nhật để cầu nối cộng đồng được nạp.
        </p>
      </div>
    );
  if (!base)
    return (
      <div className="gv-community">
        <p role="status">Đang kết nối cộng đồng…</p>
      </div>
    );
  return (
    <>
      {authStatus?.loggedIn && <div className="gv-community gv-review-sync" role="status">
        <span>{syncingReviews ? "Đang đồng bộ đánh giá lên máy chủ…" : reviewSync?.state === "pending" ? "Đánh giá đã lưu trên máy nhưng chưa gửi được lên máy chủ." : reviewSync?.state === "synced" ? `Đã đồng bộ ${reviewSync.synced} đánh giá${reviewSync.migrated ? ` và chuyển ${reviewSync.migrated} điểm cũ lên Top game` : ""}.` : "Đồng bộ đánh giá đã lưu để cập nhật Top game."}</span>{" "}
        <button disabled={syncingReviews} onClick={() => void syncReviews()}>{reviewSync?.state === "pending" ? "Thử đồng bộ lại" : "Đồng bộ đánh giá"}</button>
      </div>}
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
      monthly={<MonthlyPick />}
    />
    </>
  );
}
function MonthlyPick() {
  const [pick, setPick] = useState<CommunityPick | null>(null),
    [games, setGames] = useState<Game[]>([]),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  return (
    <section>
      <h2
        style={{
          marginTop: 0,
        }}
      >
        Game cộng đồng tháng này
      </h2>
      <p className="gv-muted">
        Cùng chọn một game, chia sẻ ảnh và trao đổi trong tháng.
      </p>
      {error && <p className="gv-error">{error}</p>}
      {pick ? (
        <div>
          <h3>{pick.gameTitle || "Đang bình chọn"}</h3>
          <p>
            {pick.month} ·{" "}
            {pick.state === "voting"
              ? "Bình chọn"
              : pick.state === "playing"
                ? "Đang cùng chơi"
                : "Đã kết thúc"}
          </p>
          <p className="gv-muted">
            {Object.keys(pick.votes || {}).length} người đã bình chọn
          </p>
        </div>
      ) : (
        !busy && <p className="gv-muted">Chưa có game được chọn.</p>
      )}
      <form
        className="gv-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void window.electronAPI.votePick!(Number(selected))
            .then(setPick)
            .catch((e) => setError(communityError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Đề cử game
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            required
          >
            <option value="">Chọn game trong thư viện</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <div className="gv-actions">
          <button disabled={busy || !selected}>Bình chọn</button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void window.electronAPI.unvotePick!()
                .then(setPick)
                .catch((e) => setError(communityError(e)))
            }
          >
            Rút bình chọn
          </button>
          <button type="button" disabled={busy} onClick={() => void load()}>
            Làm mới
          </button>
        </div>
      </form>
    </section>
  );
}
