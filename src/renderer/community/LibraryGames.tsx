import React, { useMemo, useState } from "react";
import type { PublicGame, SharedLibraryGame } from "../../shared/community.ts";
import { minutesLabel, qualifyCommunityUrl } from "./client.ts";

export function LibraryGames({ games, publicBase, onGame, onLocalGame, onShareLibrary, sharing }: {
  games: SharedLibraryGame[]; publicBase: string; onGame: (game: PublicGame) => void;
  onLocalGame?: (id: number) => void; onShareLibrary: () => void; sharing: boolean;
}) {
  const [status, setStatus] = useState("completed"), [query, setQuery] = useState("");
  const filtered = useMemo(() => games.filter(g => (!status || g.status === status) && g.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.playtimeMinutes - a.playtimeMinutes || a.title.localeCompare(b.title)), [games, status, query]);
  return <section>
    <h2>Game của tôi</h2>
    <p>{games.length} game · {games.filter(g => g.status === "completed").length} đã hoàn thành · {minutesLabel(games.reduce((sum, g) => sum + g.playtimeMinutes, 0))}</p>
    <p className="gv-muted">Dữ liệu trên máy này. Chọn game để xem thông tin, Top người chơi và cấu hình đã chia sẻ.</p>
    <p className="gv-notice">{sharing ? "Thư viện đã bật chia sẻ. Lưu lại hồ sơ để cập nhật số liệu mới nhất." : "Thư viện của bạn đang riêng tư. Giờ chơi chưa xuất hiện ở Top game và Top người chơi."} <button onClick={onShareLibrary}>{sharing ? "Cập nhật chia sẻ" : "Thiết lập chia sẻ"}</button></p>
    <div className="gv-actions">
      <label>Tìm trong thư viện<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tên game…" /></label>
      <label>Trạng thái<select value={status} onChange={e => setStatus(e.target.value)}><option value="completed">Đã hoàn thành</option><option value="">Tất cả</option><option value="playing">Đang chơi</option><option value="backlog">Chờ chơi</option><option value="paused">Tạm dừng</option><option value="dropped">Đã bỏ</option></select></label>
    </div>
    {filtered.length === 0 && <p className="gv-empty">Không có game phù hợp với bộ lọc.</p>}
    <div className="gv-results">{filtered.map(g => <div className="gv-library-row" key={g.localGameId ?? g.gameKey}>
      <button className="gv-result" onClick={() => onGame(g)}>
        {g.coverUrl && qualifyCommunityUrl(publicBase, g.coverUrl) && <img alt="" loading="lazy" src={qualifyCommunityUrl(publicBase, g.coverUrl)} />}
        <span><strong>{g.title}</strong><br /><span className="gv-muted">{minutesLabel(g.playtimeMinutes)} · {g.status === "completed" ? "Đã hoàn thành" : "Chưa hoàn thành"}</span><br /><span className="gv-muted">Thông tin · Top người chơi · Cấu hình</span></span>
      </button>
      {g.localGameId && onLocalGame && <button className="gv-link" onClick={() => onLocalGame(g.localGameId!)}>Mở game trong thư viện</button>}
    </div>)}</div>
  </section>;
}
