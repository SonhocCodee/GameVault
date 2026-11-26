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
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);
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
        <div className="gv-player-grid">
          {board.items.map((player, index) => {
            const banner = player.bannerUrl
              ? qualifyCommunityUrl(api.publicBase, player.bannerUrl)
              : "";
            const topGames = player.topGames || [];
            const topOne = topGames[0];
            const isHovered = hoveredUid === player.uid;
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
                className={`gv-player-card ${index < 3 ? `rank-${index + 1}` : ""}`}
                onMouseEnter={() => setHoveredUid(player.uid)}
                onMouseLeave={() =>
                  setHoveredUid((cur) => (cur === player.uid ? null : cur))
                }
              >
                <div
                  className="gv-player-banner"
                  onClick={() => onProfile(player.uid)}
                >
                  {banner ? (
                    <img src={banner} alt="" loading="lazy" />
                  ) : (
                    <div className="gv-player-banner-fallback" />
                  )}
                  <div className="gv-player-banner-overlay" />
                  <div className="gv-player-banner-badges">
                    <span className={`gv-pill ${rankClass}`}>
                      <Trophy size={12} /> Hạng #{index + 1}
                    </span>
                    {player.uid === myUid && (
                      <span className="gv-pill gv-pill-emerald">Bạn</span>
                    )}
                  </div>
                </div>

                <div className="gv-player-card-body">
                  <div className="gv-player-avatar-row">
                    <div
                      className="gv-player-avatar-ring"
                      onClick={() => onProfile(player.uid)}
                    >
                      <Avatar
                        name={player.nickname}
                        url={player.avatarUrl}
                        size={60}
                      />
                    </div>
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
                    style={{ cursor: "pointer" }}
                    onClick={() => onProfile(player.uid)}
                  >
                    <h3 style={{ fontSize: 17 }}>{player.nickname}</h3>
                    <p
                      className="gv-muted"
                      style={{
                        fontSize: 12,
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {player.bio || "Thành viên cộng đồng GameVault"}
                    </p>
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

                  {topOne && (
                    <div className="gv-player-top1">
                      <Sparkles size={13} className="gv-text-amber" />
                      <span className="gv-muted" style={{ fontSize: 12 }}>
                        Chơi nhiều nhất:{" "}
                        <strong style={{ color: "#f1f3f7" }}>
                          {topOne.title}
                        </strong>{" "}
                        ({minutesLabel(topOne.playtimeMinutes)})
                      </span>
                    </div>
                  )}
                </div>

                {/* Hover Preview Drawer: Top 3 Most-Played Games */}
                {isHovered && topGames.length > 0 && (
                  <div className="gv-player-hover-preview">
                    <div className="gv-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Top game chơi nhiều giờ nhất
                    </div>
                    {topGames.map((tg, i) => {
                      const cover = tg.coverUrl
                        ? qualifyCommunityUrl(api.publicBase, tg.coverUrl)
                        : "";
                      return (
                        <button
                          type="button"
                          key={tg.gameKey}
                          className="gv-hover-game-row"
                          onClick={() => (onGame ? onGame(tg) : onProfile(player.uid))}
                        >
                          <span className="gv-muted" style={{ fontWeight: 800, width: 18 }}>
                            #{i + 1}
                          </span>
                          {cover ? (
                            <img src={cover} alt="" />
                          ) : (
                            <div className="gv-hover-game-ph" />
                          )}
                          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                            <strong
                              style={{
                                display: "block",
                                fontSize: 12,
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
                )}
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
