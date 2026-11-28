import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, Gamepad2, RefreshCw, Star, Users } from "lucide-react";
import type { CommunityAdapter, MonthlyGameRanking, MonthlyRankings as MonthlyData, PublicGame } from "../../shared/community.ts";
import { currentRankingMonth, rankingMonths } from "../../shared/monthly.ts";
import { communityError, qualifyCommunityUrl } from "./client.ts";
import "./monthly.css";

const decimal = (value: number, digits = 1) => value.toLocaleString("vi-VN", {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const monthLabel = (month: string) => `${Number(month.slice(5))}/${month.slice(0, 4)}`;

function MonthlyCover({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  return url && !failed ?
    <img className="gv-monthly-cover" src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> :
    <span className="gv-monthly-cover gv-monthly-cover-empty"><Gamepad2 size={22} /></span>;
}

export function MonthlyRankings({ api, onGame, month, onMonthChange }: {
  api: CommunityAdapter;
  onGame: (game: PublicGame) => void;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const [currentMonth, setCurrentMonth] = useState(currentRankingMonth);
  const [data, setData] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.request<MonthlyData>(`/rankings/monthly?month=${month}&limit=20`);
      if (ticket !== sequence.current) return;
      setData(result);
      setCurrentMonth(result.currentMonth);
    } catch (e) {
      if (ticket === sequence.current) setError(communityError(e));
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  }, [api, month]);

  useEffect(() => {
    setData(null);
    void load();
    return () => { sequence.current++; };
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = currentRankingMonth();
      if (next !== currentMonth) {
        setCurrentMonth(next);
        if (month === currentMonth) onMonthChange(next);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [currentMonth, month, onMonthChange]);

  const years = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const item of rankingMonths(currentMonth)) {
      const year = item.slice(0, 4);
      result.set(year, [...(result.get(year) || []), item]);
    }
    return [...result];
  }, [currentMonth]);

  const renderGame = (game: MonthlyGameRanking, index: number, online: boolean) => {
    const cover = game.coverUrl ? qualifyCommunityUrl(api.publicBase, game.coverUrl) : "";
    return (
      <li key={game.gameKey}>
        <button type="button" className={`gv-monthly-game ${index === 0 ? "is-first" : ""}`} onClick={() => onGame(game)}>
          <span className="gv-monthly-rank" aria-label={`Hạng ${index + 1}`}>{index + 1}</span>
          <MonthlyCover url={cover} />
          <span className="gv-monthly-game-info">
            <span className="gv-monthly-game-title">{game.title}</span>
            <span className="gv-muted">
              {online ? <><Users size={12} /> {game.players} người chơi</> :
                <><Star size={12} /> {game.reviewCount} đánh giá · Bấm để xem chi tiết</>}
            </span>
            {online && game.averageScore !== null && <span className="gv-muted">{decimal(game.averageScore)}/10 · {game.reviewCount} đánh giá</span>}
          </span>
          <span className="gv-monthly-metric">
            <strong>{online ? decimal(game.totalMinutes / 60) : (Math.round(game.averageScore! * 10) / 10 % 1 === 0 ? Math.round(game.averageScore!).toString() : (Math.round(game.averageScore! * 10) / 10).toFixed(1))}</strong>
            <span>{online ? "giờ trong tháng" : `${game.reviewCount} đánh giá`}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="gv-stack gv-monthly" aria-labelledby="gv-monthly-title">
      <div className="gv-top">
        <div className="gv-stack-sm">
          <h2 id="gv-monthly-title">Game tháng {monthLabel(month)}</h2>
          <p className="gv-muted">Online xếp theo giờ chơi trong tháng. Chơi đơn xếp theo điểm và số lượt đánh giá.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
      </div>
      <div className="gv-monthly-layout">
        <nav className="gv-monthly-history" aria-label="Lịch sử bảng xếp hạng theo tháng">
          <h3><CalendarDays size={15} /> Lịch sử theo tháng</h3>
          {years.map(([year, months]) => (
            <details key={year} open={year === month.slice(0, 4)}>
              <summary>{year}</summary>
              <ul>{months.map(item => (
                <li key={item}><button type="button" aria-current={month === item ? "date" : undefined} onClick={() => onMonthChange(item)}>
                  Tháng {Number(item.slice(5))}{item === currentMonth && <span>Hiện tại</span>}
                </button></li>
              ))}</ul>
            </details>
          ))}
          <p className="gv-muted">Bắt đầu từ tháng 11/2026.</p>
        </nav>
        <div className="gv-stack gv-monthly-content" aria-busy={loading}>
          {error && <div className="gv-error" role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={() => void load()}>Thử tải lại</button></div>}
          {loading && (!data || data.month !== month) && <p className="gv-muted" role="status">Đang tính bảng xếp hạng tháng {monthLabel(month)}…</p>}
          {data && data.month === month && <>
            <div className="gv-actions gv-monthly-period">
              <span className={`gv-pill ${data.state === "live" ? "gv-pill-emerald" : ""}`}>{data.state === "live" ? "Đang cập nhật" : "Đã kết thúc"}</span>
              <span className="gv-muted">Theo giờ Việt Nam (GMT+7) · Tối đa 20 game mỗi bảng</span>
            </div>
            <div className="gv-monthly-boards">
              <section className="gv-monthly-board" aria-labelledby="gv-monthly-solo-title">
                <header><h3 id="gv-monthly-solo-title"><Star size={17} /> Top Chơi đơn</h3><p className="gv-muted">Điểm cao, có xét số người chấm. Giờ chơi không ảnh hưởng thứ hạng.</p></header>
                {data.singlePlayer.length ? <ol>{data.singlePlayer.map((game, i) => renderGame(game, i, false))}</ol> :
                  <p className="gv-monthly-empty">Chưa có đánh giá hợp lệ cho game chơi đơn trong tháng này.</p>}
                <footer>{data.singlePlayerCount} game có đánh giá · Gồm game chơi đơn và game có cả chơi đơn/online.</footer>
              </section>
              <section className="gv-monthly-board" aria-labelledby="gv-monthly-online-title">
                <header><h3 id="gv-monthly-online-title"><Clock size={17} /> Top Online</h3><p className="gv-muted">Cộng giờ app ghi nhận trong tháng. Giờ nhập tay không được tính.</p></header>
                {data.online.length ? <ol>{data.online.map((game, i) => renderGame(game, i, true))}</ol> :
                  <p className="gv-monthly-empty">Chưa có phiên chơi được đồng bộ cho game online trong tháng này.</p>}
                <footer>{data.onlineCount} game có phiên chơi trong tháng.</footer>
              </section>
            </div>
            {data.unclassifiedCount > 0 && <p className="gv-notice" role="status">{data.unclassifiedCount} game đang chờ xác định chế độ chơi nên chưa được xếp vào hai bảng. Bạn có thể làm mới sau khi dữ liệu phân loại được cập nhật.</p>}
          </>}
        </div>
      </div>
    </section>
  );
}
