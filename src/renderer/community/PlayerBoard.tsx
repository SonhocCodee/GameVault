import React, { useEffect, useRef, useState } from "react";
import {
  Award,
  CheckCircle2,
  Clock,
  Gamepad2,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import type {
  CommunityAdapter,
  Page,
  PlayerRanking,
  PublicGame,
} from "../../shared/community.ts";
import {
  communityError,
  minutesLabel,
  qualifyCommunityUrl,
} from "./client.ts";
import { Avatar } from "./CommunityWidgets.tsx";

export function PlayerBoard({
  api,
  myUid,
  onProfile,
  onGame,
  onShareLibrary,
}: {
  api: CommunityAdapter;
  myUid?: string;
  onProfile: (uid: string) => void;
  onGame?: (g: PublicGame) => void;
  onShareLibrary: () => void;
}) {
  const [sort, setSort] = useState("completed");
  const [board, setBoard] = useState<Page<PlayerRanking>>({
    items: [],
    hasMore: false,
    nextOffset: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);

  const load = async (more = false) => {
    const current = ++ticket.current;
    setLoading(true);
    setError("");
    try {
      const data = await api.request<Page<PlayerRanking>>(
        `/players?sort=${sort}&includeTopGames=1&offset=${more ? board.nextOffset : 0}`,
      );
      if (current !== ticket.current) return;
      setBoard((previous) => ({
        ...data,
        items: more ? [...previous.items, ...data.items] : data.items,
      }));
    } catch (e) {
      if (current === ticket.current) setError(communityError(e));
    } finally {
      if (current === ticket.current) setLoading(false);
    }
  };

  useEffect(() => {
    setBoard({ items: [], hasMore: false, nextOffset: 0 });
    void load();
    return () => {
      ++ticket.current;
    };
  }, [api, sort, myUid]);

  return (
    <section className="gv-stack">
      <div className="gv-top">
        <div>
          <h2>Top người chơi GameVault</h2>
          <p className="gv-muted">
            Di chuột vào thẻ người chơi để xem nhanh những tựa game họ chơi nhiều giờ nhất.
          </p>
        </div>
        <div className="gv-actions">
          <button type="button" onClick={onShareLibrary}>
            <Award size={15} />
            Hồ sơ của tôi
          </button>
          <button type="button" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={15} />
            Làm mới
          </button>
        </div>
      </div>

      <div className="gv-chip-row" aria-label="Sắp xếp người chơi">
        {[
          ["completed", "Game đã phá đảo"],
          ["hours", "Tổng giờ chơi"],
          ["games", "Tổng số game"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`gv-chip ${sort === value ? "active" : ""}`}
            onClick={() => setSort(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="gv-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      )}

      {loading && board.items.length === 0 && (
        <p role="status" className="gv-muted">
          Đang tải bảng xếp hạng…
        </p>
      )}

      {board.items.length > 0 && (
        <div className="gv-player-list">
          {board.items.map((player, index) => {
            const banner = player.bannerUrl
              ? qualifyCommunityUrl(api.publicBase, player.bannerUrl)
              : "";
            const topGames = player.topGames || [];
            const rankClass =
              index === 0
                ? "gv-pill-amber"
                : index === 1
                  ? "gv-pill-cyan"
                  : index === 2
                    ? "gv-pill-accent"
                    : "";

            return (
              <div
                key={player.uid}
                className={`gv-player-row ${index < 3 ? `rank-${index + 1}` : ""}`}
              >
                {banner && (
                  <img
                    className="gv-row-backdrop"
                    src={banner}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div className="gv-row-backdrop-fade" />

                <div className="gv-player-row-left">
                  <div className="gv-player-row-top">
                    <span className={`gv-pill ${rankClass}`}>
                      <Trophy size={12} /> Hạng #{index + 1}
                    </span>
                    {player.uid === myUid && (
                      <span className="gv-pill gv-pill-emerald">Bạn</span>
                    )}
                    <button
                      type="button"
                      className="gv-link"
                      style={{ marginLeft: "auto", fontSize: 12 }}
                      onClick={() => onProfile(player.uid)}
                    >
                      Xem hồ sơ →
                    </button>
                  </div>

                  <div
                    className="gv-player-row-identity"
                    onClick={() => onProfile(player.uid)}
                  >
                    <div className="gv-player-avatar-ring">
                      <Avatar
                        name={player.nickname}
                        url={player.avatarUrl}
                        size={64}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontSize: 19 }}>{player.nickname}</h3>
                      <p
                        className="gv-muted"
                        style={{
                          fontSize: 13,
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {player.bio || "Thành viên cộng đồng GameVault"}
                      </p>
                    </div>
                  </div>

                  <div className="gv-stat-mini-grid">
                    <div className="gv-stat-mini">
                      <span className="gv-stat-mini-label">Phá đảo</span>
                      <span className="gv-stat-mini-value gv-text-emerald">
                        {player.completedGames}
                      </span>
                    </div>
                    <div className="gv-stat-mini">
                      <span className="gv-stat-mini-label">Giờ chơi</span>
                      <span className="gv-stat-mini-value gv-text-cyan">
                        {minutesLabel(player.totalMinutes)}
                      </span>
                    </div>
                    <div className="gv-stat-mini">
                      <span className="gv-stat-mini-label">Thư viện</span>
                      <span className="gv-stat-mini-value">
                        {player.totalGames} game
                      </span>
                    </div>
                  </div>
                </div>

                <div className="gv-player-row-right">
                  <div
                    className="gv-muted"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Sparkles size={12} className="gv-text-amber" />
                    Top game chơi nhiều giờ nhất
                  </div>
                  {topGames.length > 0 ? (
                    <div className="gv-player-topgames-list">
                      {topGames.map((tg, i) => {
                        const cover = tg.coverUrl
                          ? qualifyCommunityUrl(api.publicBase, tg.coverUrl)
                          : "";
                        return (
                          <button
                            type="button"
                            key={tg.gameKey}
                            className="gv-hover-game-row"
                            onClick={() =>
                              onGame ? onGame(tg) : onProfile(player.uid)
                            }
                          >
                            <span
                              className="gv-muted"
                              style={{ fontWeight: 800, width: 20, fontSize: 12 }}
                            >
                              #{i + 1}
                            </span>
                            {cover ? (
                              <img src={cover} alt="" loading="lazy" />
                            ) : (
                              <div className="gv-hover-game-ph" />
                            )}
                            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                              <strong
                                style={{
                                  display: "block",
                                  fontSize: 13,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {tg.title}
                              </strong>
                              <span className="gv-muted" style={{ fontSize: 11 }}>
                                {minutesLabel(tg.playtimeMinutes)}
                                {tg.status === "completed" ? " · Đã phá đảo" : ""}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="gv-muted" style={{ fontSize: 12 }}>
                      Chưa có dữ liệu game chơi nhiều.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && board.items.length === 0 && (
        <div className="gv-empty">
          <h3>Chưa có người chơi chia sẻ thư viện</h3>
          <p>
            Mở Hồ sơ và bật chia sẻ thư viện để số game phá đảo và giờ chơi của
            bạn góp mặt trên bảng xếp hạng.
          </p>
          <button type="button" className="gv-primary" onClick={onShareLibrary}>
            Mở thiết lập chia sẻ
          </button>
        </div>
      )}

      {board.hasMore && (
        <button
          type="button"
          disabled={loading}
          className="gv-pager"
          onClick={() => void load(true)}
        >
          Xem thêm người chơi
        </button>
      )}
    </section>
  );
}
