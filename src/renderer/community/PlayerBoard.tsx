import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  CalendarDays,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import type {
  CommunityAdapter,
  MonthlyPlayerRankings,
  Page,
  PlayerRanking,
  PublicGame,
} from "../../shared/community.ts";
import {
  currentRankingMonth,
  FIRST_PLAYER_RANKING_MONTH,
  rankingMonths,
} from "../../shared/monthly.ts";
import {
  communityError,
  qualifyCommunityUrl,
} from "./client.ts";
import { Avatar, PlaytimeDisplay } from "./CommunityWidgets.tsx";

const monthLabel = (month: string) => `${Number(month.slice(5))}/${month.slice(0, 4)}`;

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
  const [currentMonth, setCurrentMonth] = useState(currentRankingMonth);
  const availableMonths = useMemo(
    () => rankingMonths(currentMonth, FIRST_PLAYER_RANKING_MONTH),
    [currentMonth],
  );
  const monthlyReady = availableMonths.length > 0;
  const [mode, setMode] = useState<"monthly" | "all">(() =>
    currentRankingMonth() >= FIRST_PLAYER_RANKING_MONTH ? "monthly" : "all",
  );
  const [month, setMonth] = useState(() =>
    currentRankingMonth() >= FIRST_PLAYER_RANKING_MONTH
      ? currentRankingMonth()
      : FIRST_PLAYER_RANKING_MONTH,
  );
  const [monthState, setMonthState] = useState<"live" | "ended">("live");
  const [sort, setSort] = useState("completed");
  const [board, setBoard] = useState<Page<PlayerRanking>>({
    items: [],
    hasMore: false,
    nextOffset: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = currentRankingMonth();
      if (next !== currentMonth) {
        setCurrentMonth(next);
        if (next >= FIRST_PLAYER_RANKING_MONTH && (month === currentMonth || currentMonth < FIRST_PLAYER_RANKING_MONTH)) {
          setMonth(next);
        }
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [currentMonth, month]);

  const load = async (more = false) => {
    if (mode === "monthly" && !monthlyReady) {
      setBoard({ items: [], hasMore: false, nextOffset: 0 });
      setLoading(false);
      setError("");
      return;
    }
    const current = ++ticket.current;
    setLoading(true);
    setError("");
    try {
      if (mode === "monthly") {
        const data = await api.request<MonthlyPlayerRankings>(
          `/players/monthly?month=${encodeURIComponent(month)}&includeTopGames=1&offset=${more ? board.nextOffset : 0}`,
        );
        if (current !== ticket.current) return;
        setCurrentMonth(data.currentMonth);
        setMonthState(data.state);
        setBoard((previous) => ({
          items: more ? [...previous.items, ...data.items] : data.items,
          hasMore: data.hasMore,
          nextOffset: data.nextOffset,
        }));
      } else {
        const data = await api.request<Page<PlayerRanking>>(
          `/players?sort=${sort}&includeTopGames=1&offset=${more ? board.nextOffset : 0}`,
        );
        if (current !== ticket.current) return;
        setBoard((previous) => ({
          ...data,
          items: more ? [...previous.items, ...data.items] : data.items,
        }));
      }
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
  }, [api, mode, month, sort, myUid, monthlyReady]);

  return (
    <section className="gv-stack">
      <div className="gv-top">
        <div>
          <h2>Top người chơi GameVault</h2>
          <p className="gv-muted">
            {mode === "monthly"
              ? "Xếp hạng theo giờ app ghi nhận trong từng tháng (GMT+7). Bắt đầu từ tháng 12/2026."
              : "Xếp hạng giờ chơi chỉ tính giờ app ghi nhận. Di chuột vào dấu ! để xem phần giờ tự thêm."}
          </p>
        </div>
        <div className="gv-actions">
          <button type="button" onClick={onShareLibrary}>
            <Award size={15} />
            Hồ sơ của tôi
          </button>
          <button type="button" disabled={loading || (mode === "monthly" && !monthlyReady)} onClick={() => void load()}>
            <RefreshCw size={15} />
            Làm mới
          </button>
        </div>
      </div>

      <div className="gv-chip-row" role="tablist" aria-label="Chế độ bảng xếp hạng người chơi">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "monthly"}
          className={`gv-chip ${mode === "monthly" ? "active" : ""}`}
          onClick={() => setMode("monthly")}
        >
          <CalendarDays size={13} style={{ display: "inline", verticalAlign: "-2px", marginRight: 5 }} />
          Theo tháng
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "all"}
          className={`gv-chip ${mode === "all" ? "active" : ""}`}
          onClick={() => setMode("all")}
        >
          <Trophy size={13} style={{ display: "inline", verticalAlign: "-2px", marginRight: 5 }} />
          All time
        </button>
      </div>

      {mode === "monthly" ? (
        monthlyReady ? (
          <div className="gv-stack-sm">
            <div className="gv-chip-row" aria-label="Chọn tháng xếp hạng người chơi">
              {availableMonths.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`gv-chip ${month === item ? "active" : ""}`}
                  onClick={() => setMonth(item)}
                >
                  Tháng {monthLabel(item)}
                  {item === currentMonth ? " (Hiện tại)" : ""}
                </button>
              ))}
            </div>
            <div className="gv-actions" style={{ fontSize: 12 }}>
              <span className={`gv-pill ${monthState === "live" ? "gv-pill-emerald" : ""}`}>
                {monthState === "live" ? "Đang cập nhật" : "Đã kết thúc"}
              </span>
              <span className="gv-muted">
                Tháng {monthLabel(month)} · Xếp theo giờ app ghi nhận trong tháng (GMT+7)
              </span>
            </div>
          </div>
        ) : (
          <div className="gv-empty">
            <h3>Bảng xếp hạng theo tháng sắp mở</h3>
            <p>
              Bảng xếp hạng người chơi theo tháng sẽ bắt đầu xuất hiện từ tháng 12/2026. Hiện tại bạn có thể xem bảng xếp hạng All time.
            </p>
            <button type="button" className="gv-primary" onClick={() => setMode("all")}>
              Xem bảng All time
            </button>
          </div>
        )
      ) : (
        <div className="gv-chip-row" aria-label="Sắp xếp người chơi">
          {[
            ["completed", "Game đã phá đảo"],
            ["hours", "Giờ app ghi nhận"],
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
      )}

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
                      <span className="gv-stat-mini-label">
                        {mode === "monthly" ? "Giờ chơi tháng" : "Giờ tính top"}
                      </span>
                      <span className="gv-stat-mini-value gv-text-cyan">
                        <PlaytimeDisplay
                          totalMinutes={player.totalMinutes}
                          recordedMinutes={player.recordedMinutes}
                          showRanked
                        />
                      </span>
                    </div>
                    <div className="gv-stat-mini">
                      <span className="gv-stat-mini-label">
                        {mode === "monthly" ? "Game tháng này" : "Thư viện"}
                      </span>
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
                    {mode === "monthly" ? "Top game tháng này" : "Top game chơi nhiều giờ nhất"}
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
                                <PlaytimeDisplay
                                  totalMinutes={tg.playtimeMinutes}
                                  recordedMinutes={tg.recordedPlaytimeMinutes}
                                  focusable={false}
                                />
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

      {!loading && !error && board.items.length === 0 && (mode === "all" || monthlyReady) && (
        <div className="gv-empty">
          <h3>
            {mode === "monthly"
              ? `Chưa có người chơi trong tháng ${monthLabel(month)}`
              : "Chưa có người chơi trên bảng xếp hạng"}
          </h3>
          <p>
            {mode === "monthly"
              ? "Chơi game và đồng bộ phiên chơi từ app để góp mặt trên bảng xếp hạng tháng này."
              : "Đồng bộ thư viện để số game phá đảo và giờ chơi của bạn góp mặt trên bảng xếp hạng."}
          </p>
          <button type="button" className="gv-primary" onClick={onShareLibrary}>
            Hồ sơ của tôi
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
