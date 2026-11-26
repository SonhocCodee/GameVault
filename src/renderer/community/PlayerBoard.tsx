import React, { useEffect, useRef, useState } from "react";
import type { CommunityAdapter, Page, PlayerRanking } from "../../shared/community.ts";
import { communityError, minutesLabel } from "./client.ts";

export function PlayerBoard({ api, myUid, onProfile, onShareLibrary }: {
  api: CommunityAdapter; myUid?: string; onProfile: (uid: string) => void; onShareLibrary: () => void;
}) {
  const [sort, setSort] = useState("completed");
  const [board, setBoard] = useState<Page<PlayerRanking>>({ items: [], hasMore: false, nextOffset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);
  const load = async (more = false) => {
    const current = ++ticket.current;
    setLoading(true); setError("");
    try {
      const data = await api.request<Page<PlayerRanking>>(`/players?sort=${sort}&offset=${more ? board.nextOffset : 0}`);
      if (current !== ticket.current) return;
      setBoard(previous => ({ ...data, items: more ? [...previous.items, ...data.items] : data.items }));
    } catch (e) { if (current === ticket.current) setError(communityError(e)); }
    finally { if (current === ticket.current) setLoading(false); }
  };
  useEffect(() => { setBoard({ items: [], hasMore: false, nextOffset: 0 }); void load(); return () => { ++ticket.current; }; }, [api, sort, myUid]);
  return <section>
    <div className="gv-top"><div><h2>Top người chơi</h2><p className="gv-muted">Thành tích từ thư viện được đồng ý chia sẻ. Tính từ trước đến nay; hoàn thành do người chơi tự xác nhận.</p></div><button disabled={loading} onClick={() => void load()}>Làm mới</button></div>
    <div className="gv-actions" aria-label="Sắp xếp người chơi">
      {[["completed", "Game đã hoàn thành"], ["hours", "Tổng giờ chơi"], ["games", "Tổng game"]].map(([value, label]) => <button key={value} aria-pressed={sort === value} onClick={() => setSort(value)}>{label}</button>)}
      <button onClick={onShareLibrary}>Tham gia bảng xếp hạng</button>
    </div>
    {error && <p className="gv-error" role="alert">{error} <button onClick={() => void load()}>Thử lại</button></p>}
    {loading && <p role="status">Đang tải bảng xếp hạng…</p>}
    {board.items.length > 0 && <div className="gv-table-scroll"><table className="gv-table"><thead><tr><th>Hạng</th><th>Người chơi</th><th>Đã hoàn thành</th><th>Tổng giờ chơi</th><th>Tổng game</th></tr></thead><tbody>
      {board.items.map((player, index) => <tr key={player.uid}><td>{index + 1}</td><td><button className="gv-link" onClick={() => onProfile(player.uid)}>{player.nickname}{player.uid === myUid ? " (Bạn)" : ""}</button></td><td>{player.completedGames}</td><td>{minutesLabel(player.totalMinutes)}</td><td>{player.totalGames}</td></tr>)}
    </tbody></table></div>}
    {!loading && !error && board.items.length === 0 && <div className="gv-empty"><h3>Chưa có người chơi chia sẻ thư viện</h3><p>Mở Hồ sơ và bật chia sẻ để số game hoàn thành, giờ chơi của bạn xuất hiện ở đây. Đồng bộ đám mây riêng không tự tham gia bảng xếp hạng.</p><button onClick={onShareLibrary}>Mở thiết lập chia sẻ</button></div>}
    {board.hasMore && <button disabled={loading} className="gv-pager" onClick={() => void load(true)}>Xem thêm người chơi</button>}
  </section>;
}
