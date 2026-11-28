import React, { useEffect, useMemo, useState } from "react";
import type {
  CommunityAdapter,
  CommunitySearchRequest,
  PublicGame,
  SharedLibraryGame,
} from "../../shared/community.ts";
import type {
  AuthStatus,
  Game,
  ReviewSyncResult,
} from "../../shared/types.ts";
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
    recordedPlaytimeMinutes: game.recorded_playtime_minutes ?? game.playtime_minutes,
    localGameId: game.id,
  };
}

const COMMUNITY_PROFILE_SYNC_COOLDOWN_MS = 3 * 60 * 1000;
let lastCommunityProfileSyncAt = 0;

export function createDesktopAdapter(publicBase: string): CommunityAdapter {
  return {
    publicBase,
    request: async <T,>(
      path: string,
      method = "GET",
      body?: unknown,
    ): Promise<T> => {
      if (method === "GET" && path === "/me") {
        const now = Date.now();
        if (now - lastCommunityProfileSyncAt >= COMMUNITY_PROFILE_SYNC_COOLDOWN_MS) {
          lastCommunityProfileSyncAt = now;
          await window.electronAPI.syncLibrary?.();
        }
      }
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
      if (!document.querySelector("[data-navbar-sign-in]")) {
        document.querySelector<HTMLButtonElement>('[aria-label="Menu tài khoản"]')?.click();
      }
      document
        .querySelector<HTMLButtonElement>("[data-navbar-sign-in]")
        ?.focus();
      throw new Error("Use the top-right account menu to sign in");
    },
  };
}

export function DesktopCommunity({
  onBack,
  searchRequest,
  authStatus,
  initialGame,
  profileRequest,
  notificationRequest,
  onLocalGame,
}: {
  onBack?: () => void;
  searchRequest?: CommunitySearchRequest;
  authStatus?: AuthStatus | null;
  initialGame?: PublicGame | null;
  profileRequest?: number;
  notificationRequest?: number;
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
        onBackToLibrary={onBack}
        searchRequest={searchRequest}
        key={`${authStatus?.profile?.uid || "guest"}:${reviewVersion}`}
        api={api}
        embedded
        shellAuth={authStatus}
        initialGame={initialGame}
        profileRequest={profileRequest}
        notificationRequest={notificationRequest}
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
      />
    </>
  );
}
