import React, { useEffect, useRef, useState } from "react";
import type { CommunityAdapter, GamePlayer, Page, SharedLibraryGame } from "../../shared/community.ts";
import { communityError, minutesLabel } from "./client.ts";

export function GamePlayers({ api, gameKey, myUid, onProfile, localGame }: {
  api: CommunityAdapter; gameKey: string; myUid?: string; onProfile: (uid: string) => void; localGame?: SharedLibraryGame;
}) {
  const [completed, setCompleted] = useState(false);
  const [data, setData] = useState<Page<GamePlayer>>({ items: [], nextOffset: 0, hasMore: false });
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);
  const load = async (more = false) => {
    const ticket = ++sequence.current;
    setLoading(true); setError("");
    try {
      const next = await api.request<Page<GamePlayer>>(`/games/${encodeURIComponent(gameKey)}/players?offset=${more ? data.nextOffset : 0}${completed ? "&status=completed" : ""}`);
      if (ticket === sequence.current) setData(previous => ({ ...next, items: more ? [...previous.items, ...next.items] : next.items }));
    } catch (e) { if (ticket === sequence.current) setError(communityError(e)); }
    finally { if (ticket === sequence.current) setLoading(false); }
  };
  useEffect(() => { setData({ items: [], nextOffset: 0, hasMore: false }); void load(); return () => { ++sequence.current; }; }, [api, gameKey, completed, myUid]);
  return <section>
    <div className="gv-top"><div><h2>Top người chơi game này</h2><p className="gv-muted">Xếp theo tổng giờ chơi đã chia sẻ của từng người. Có thể xem người đã hoàn thành ngay cả khi họ chưa đăng FPS.</p></div><button disabled={loading} onClick={() => void load()}>Làm mới</button></div>
    <div className="gv-actions"><button aria-pressed={!completed} onClick={() => setCompleted(false)}>Tất cả người chơi</button><button aria-pressed={completed} onClick={() => setCompleted(true)}>Đã hoàn thành</button></div>
    {localGame && (!completed || localGame.status === "completed") && !data.items.some(p => p.uid === myUid) && <p className="gv-notice">Bạn trên máy này: <strong>{minutesLabel(localGame.playtimeMinutes)}</strong> · {localGame.status === "completed" ? "Đã hoàn thành" : "Chưa hoàn thành"}. Đây là số liệu riêng, chưa có hạng công khai. Bật chia sẻ thư viện trong Hồ sơ để tham gia.</p>}
    {loading && <p role="status">Đang tải người chơi…</p>}
    {error && <p className="gv-error" role="alert">{error} <button onClick={() => void load()}>Thử lại</button></p>}
    {data.items.length > 0 && <div className="gv-table-scroll"><table className="gv-table"><thead><tr><th>Hạng</th><th>Người chơi</th><th>Giờ chơi</th><th>Trạng thái</th><th>Cấu hình / FPS đã chia sẻ</th></tr></thead><tbody>
      {data.items.map((p, index) => <tr key={p.uid}>
        <td>{p.playtimeMinutes == null ? "—" : index + 1}</td>
        <td><button className="gv-link" onClick={() => onProfile(p.uid)}>{p.nickname}{p.uid === myUid ? " (Bạn)" : ""}</button></td>
        <td>{p.playtimeMinutes == null ? "Chưa chia sẻ" : minutesLabel(p.playtimeMinutes)}</td>
        <td>{p.status === "completed" ? "Đã hoàn thành" : p.status === "playing" ? "Đang chơi" : p.status === "dropped" ? "Đã bỏ" : p.status === "backlog" ? "Chờ chơi" : "Tạm dừng"}</td>
        <td>{p.performance ? <details><summary>{p.performance.gpu} · {p.performance.fpsAverage.toFixed(1)} FPS</summary><p>{p.performance.cpu} · {p.performance.ramGb} GB RAM</p><p>{p.performance.graphics.width} × {p.performance.graphics.height} · {p.performance.graphics.preset}</p><p className="gv-muted">{p.performance.source === "presentmon" ? "Đo bằng PresentMon" : "Tự khai báo"} · {new Date(p.performance.measuredAt).toLocaleDateString("vi-VN")}<br />Nâng độ phân giải: {p.performance.graphics.upscaling || "Chưa rõ"}<br />Tạo khung hình: {p.performance.graphics.frameGeneration || "Chưa rõ"}<br />Ray Tracing: {p.performance.graphics.rayTracing || "Chưa rõ"}</p></details> : <span className="gv-muted">Chưa chia sẻ cấu hình/FPS</span>}</td>
      </tr>)}
    </tbody></table></div>}
    {!loading && !error && data.items.length === 0 && <p className="gv-empty">{completed ? "Chưa có người hoàn thành chia sẻ game này." : "Chưa có thư viện công khai hoặc báo cáo cấu hình cho game này."} Thư viện riêng không tự xuất hiện trên bảng xếp hạng.</p>}
    {data.hasMore && <button className="gv-pager" disabled={loading} onClick={() => void load(true)}>Xem thêm người chơi</button>}
  </section>;
}
