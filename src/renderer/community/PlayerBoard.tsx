import React, { useEffect, useRef, useState } from "react";
import { Award, CheckCircle2, Clock, Gamepad2, RefreshCw, Trophy } from "lucide-react";
import type {
  CommunityAdapter,
  Page,
  PlayerRanking,
} from "../../shared/community.ts";
import { communityError, minutesLabel } from "./client.ts";
import { Avatar } from "./CommunityWidgets.tsx";

export function PlayerBoard({
  api,
  myUid,
  onProfile,
  onShareLibrary,
}: {
  api: CommunityAdapter;
  myUid?: string;
  onProfile: (uid: string) => void;
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
        `/players?sort=${sort}&offset=${more ? board.nextOffset : 0}`,
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

  const top3 = board.items.slice(0, 3);
  const rest = board.items.slice(3);

  return (
    <section className="gv-stack">
      <div className="gv-top">
        <div>
          <h2>Top người chơi GameVault</h2>
          <p className="gv-muted">
            Thành tích từ thư viện được người chơi chủ động công khai.
          </p>
        </div>
        <div className="gv-actions">
          <button type="button" onClick={onShareLibrary}>
            <Award size={15} />
            Tham gia BXH
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

      {top3.length > 0 && (
        <div className="gv-podium-grid">
          {top3.map((player, index) => (
            <button
              type="button"
              key={player.uid}
              className={`gv-podium-card rank-${index + 1}`}
              onClick={() => onProfile(player.uid)}
            >
              <div className="gv-top">
                <span
                  className={`gv-pill ${
                    index === 0
                      ? "gv-pill-amber"
                      : index === 1
                        ? "gv-pill-cyan"
                        : "gv-pill-accent"
                  }`}
                >
                  <Trophy size={12} />
                  Hạng #{index + 1}
                </span>
                {player.uid === myUid && (
                  <span className="gv-pill gv-pill-emerald">Bạn</span>
                )}
              </div>
              <div className="gv-actions" style={{ gap: 12 }}>
                <Avatar name={player.nickname} url={player.avatarUrl} size={44} />
                <div>
                  <h3 style={{ fontSize: 16 }}>{player.nickname}</h3>
                  <span className="gv-muted">
                    {player.totalGames} game trong thư viện
                  </span>
                </div>
              </div>
              <div className="gv-actions" style={{ gap: 8 }}>
                <span className="gv-pill gv-pill-emerald">
                  <CheckCircle2 size={12} />
                  {player.completedGames} phá đảo
                </span>
                <span className="gv-pill gv-pill-cyan">
                  <Clock size={12} />
                  {minutesLabel(player.totalMinutes)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div className="gv-rank-list">
          {rest.map((player, index) => (
            <button
              type="button"
              className="gv-rank-row"
              key={player.uid}
              onClick={() => onProfile(player.uid)}
            >
              <span className="gv-rank-num">#{index + 4}</span>
              <div className="gv-actions" style={{ gap: 12 }}>
                <Avatar name={player.nickname} url={player.avatarUrl} size={36} />
                <div>
                  <strong style={{ fontSize: 14 }}>
                    {player.nickname}
                    {player.uid === myUid ? " (Bạn)" : ""}
                  </strong>
                </div>
              </div>
              <div className="gv-rank-metrics">
                <span className="gv-pill gv-pill-emerald">
                  <CheckCircle2 size={12} />
                  {player.completedGames} phá đảo
                </span>
                <span className="gv-pill gv-pill-cyan">
                  <Clock size={12} />
                  {minutesLabel(player.totalMinutes)}
                </span>
                <span className="gv-pill">
                  <Gamepad2 size={12} />
                  {player.totalGames} game
                </span>
              </div>
            </button>
          ))}
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
