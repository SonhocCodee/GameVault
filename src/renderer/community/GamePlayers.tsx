import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Cpu, Gauge, RefreshCw, Trophy } from "lucide-react";
import type {
  CommunityAdapter,
  GamePlayer,
  Page,
  SharedLibraryGame,
} from "../../shared/community.ts";
import { communityError } from "./client.ts";
import { Avatar, PlaytimeDisplay } from "./CommunityWidgets.tsx";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  completed: { label: "Đã hoàn thành", cls: "gv-pill-emerald" },
  playing: { label: "Đang chơi", cls: "gv-pill-cyan" },
  dropped: { label: "Đã bỏ", cls: "gv-pill-accent" },
  backlog: { label: "Chờ chơi", cls: "" },
  paused: { label: "Tạm dừng", cls: "gv-pill-amber" },
};

export function GamePlayers({
  api,
  gameKey,
  myUid,
  onProfile,
  localGame,
}: {
  api: CommunityAdapter;
  gameKey: string;
  myUid?: string;
  onProfile: (uid: string) => void;
  localGame?: SharedLibraryGame;
}) {
  const [completed, setCompleted] = useState(false);
  const [data, setData] = useState<Page<GamePlayer>>({
    items: [],
    nextOffset: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const load = async (more = false) => {
    const ticket = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await api.request<Page<GamePlayer>>(
        `/games/${encodeURIComponent(gameKey)}/players?offset=${more ? data.nextOffset : 0}${completed ? "&status=completed" : ""}`,
      );
      if (ticket === sequence.current) {
        setData((previous) => ({
          ...next,
          items: more ? [...previous.items, ...next.items] : next.items,
        }));
      }
    } catch (e) {
      if (ticket === sequence.current) setError(communityError(e));
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    setData({ items: [], nextOffset: 0, hasMore: false });
    void load();
    return () => {
      ++sequence.current;
    };
  }, [api, gameKey, completed, myUid]);

  return (
    <section className="gv-stack">
      <div className="gv-top">
        <div>
          <h3>Người chơi game này</h3>
          <p className="gv-muted">
            Xếp theo giờ app ghi nhận, kèm cấu hình / FPS nếu có. Giờ tự thêm không tính top.
          </p>
        </div>
        <div className="gv-actions">
          <button
            type="button"
            className={`gv-chip ${!completed ? "active" : ""}`}
            onClick={() => setCompleted(false)}
          >
            Tất cả
          </button>
          <button
            type="button"
            className={`gv-chip ${completed ? "active" : ""}`}
            onClick={() => setCompleted(true)}
          >
            <CheckCircle2 size={13} />
            Đã hoàn thành
          </button>
          <button type="button" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {localGame &&
        (!completed || localGame.status === "completed") &&
        !data.items.some((p) => p.uid === myUid) && (
          <div className="gv-notice">
            <span>
              Thư viện máy bạn:{" "}
              <strong>
                <PlaytimeDisplay
                  totalMinutes={localGame.playtimeMinutes}
                  recordedMinutes={localGame.recordedPlaytimeMinutes}
                />
              </strong> ·{" "}
              {localGame.status === "completed"
                ? "Đã hoàn thành"
                : "Chưa hoàn thành"}
              . Bật chia sẻ thư viện trong Hồ sơ để tham gia BXH.
            </span>
          </div>
        )}

      {loading && (
        <p role="status" className="gv-muted">
          Đang tải danh sách người chơi…
        </p>
      )}
      {error && (
        <p className="gv-error" role="alert">
          {error} <button onClick={() => void load()}>Thử lại</button>
        </p>
      )}

      {data.items.length > 0 && (
        <div className="gv-rank-list">
          {data.items.map((p, index) => {
            const st = STATUS_LABELS[p.status] || { label: p.status, cls: "" };
            return (
              <div className="gv-card-subtle" key={p.uid}>
                <div className="gv-top">
                  <div className="gv-actions" style={{ gap: 12 }}>
                    <span className="gv-rank-num" style={{ minWidth: 26 }}>
                      {p.playtimeMinutes == null ? "—" : `#${index + 1}`}
                    </span>
                    <Avatar name={p.nickname} url={p.avatarUrl} size={34} />
                    <div>
                      <button
                        className="gv-link"
                        style={{ color: "#f1f3f7", fontWeight: 700, padding: 0 }}
                        onClick={() => onProfile(p.uid)}
                      >
                        {p.nickname}
                        {p.uid === myUid ? " (Bạn)" : ""}
                      </button>
                      <div className="gv-actions" style={{ marginTop: 4, gap: 6 }}>
                        <span className={`gv-pill ${st.cls}`}>{st.label}</span>
                        {p.playtimeMinutes != null && (
                          <span className="gv-pill">
                            <PlaytimeDisplay
                              totalMinutes={p.playtimeMinutes}
                              recordedMinutes={p.recordedPlaytimeMinutes}
                              showRanked
                            />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {p.performance ? (
                    <div className="gv-actions" style={{ gap: 8 }}>
                      <span className="gv-pill gv-pill-cyan">
                        <Cpu size={12} />
                        {p.performance.gpu}
                      </span>
                      <span className="gv-pill gv-pill-emerald">
                        <Gauge size={12} />
                        {p.performance.fpsAverage.toFixed(1)} FPS
                        {p.performance.graphics.width && p.performance.graphics.height
                          ? ` (${p.performance.graphics.width}×${p.performance.graphics.height}${p.performance.graphics.preset ? ` ${p.performance.graphics.preset}` : ""})`
                          : p.performance.graphics.preset
                            ? ` (${p.performance.graphics.preset})`
                            : ""}
                      </span>
                    </div>
                  ) : (
                    <span className="gv-muted" style={{ fontSize: 12 }}>
                      Chưa chia sẻ FPS
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && data.items.length === 0 && (
        <div className="gv-empty">
          <Trophy size={20} className="gv-text-amber" />
          <p>
            {completed
              ? "Chưa có người chơi nào chia sẻ trạng thái hoàn thành game này."
              : "Chưa có người chơi công khai cho game này."}
          </p>
        </div>
      )}

      {data.hasMore && (
        <button
          type="button"
          className="gv-pager"
          disabled={loading}
          onClick={() => void load(true)}
        >
          Xem thêm người chơi
        </button>
      )}
    </section>
  );
}
