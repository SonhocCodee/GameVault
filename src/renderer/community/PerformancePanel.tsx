import React, { useEffect, useMemo, useState } from "react";
import { Download, FileCode2, FolderOpen, Gauge, RefreshCw, Save } from "lucide-react";
import type {
  ConfigCandidate,
  GraphicsContext,
  PerformancePreview,
  PerformanceReport,
} from "../../shared/community.ts";
import { createDesktopAdapter } from "./DesktopCommunity.tsx";
import {
  GraphicsFields,
  PerformanceShareForm,
} from "./PerformanceShareForm.tsx";
import { communityError } from "./client.ts";
import "./community.css";

const blank: GraphicsContext = {
  width: null,
  height: null,
  preset: "",
  upscaling: "",
  frameGeneration: "",
  rayTracing: "",
  source: "manual",
};

export function PerformancePanel({
  gameId,
  status,
  onShared,
}: {
  gameId: number;
  status: string;
  onShared?: () => void;
}) {
  const [preview, setPreview] = useState<PerformancePreview | null>(null);
  const [graphics, setGraphics] = useState(blank);
  const [selected, setSelected] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [session, setSession] = useState("");
  const [measured, setMeasured] = useState<PerformanceReport | undefined>();
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hardware, setHardware] = useState<Partial<PerformanceReport>>({});

  const api = useMemo(() => createDesktopAdapter(base), [base]);

  const load = async () => {
    try {
      const [p, b] = await Promise.all([
        window.electronAPI.getPerformancePreview!(gameId),
        window.electronAPI.getCommunityBaseUrl!(),
      ]);
      setPreview(p);
      setGraphics(p.context);
      setBase(b);
      try {
        const h = await window.electronAPI.getHardwareInfo?.();
        if (h)
          setHardware({
            cpu: h.cpu_name,
            gpu: h.gpus.map((g) => g.name).join(" / "),
            ramGb: h.ram_gb,
          });
      } catch {}
    } catch (e) {
      setError(communityError(e));
    }
  };

  useEffect(() => {
    void load();
    setShare(false);
    setSelected([]);
    setMeasured(undefined);
    setSession("");
  }, [gameId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gv-community" style={{ padding: "12px 0" }}>
      <div className="gv-card gv-stack">
        <div className="gv-top">
          <div>
            <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Gauge size={18} className="gv-text-cyan" />
              Cấu hình đồ họa & Hiệu năng máy của bạn
            </h3>
            <p className="gv-muted">
              Thiết lập độ phân giải và mức đồ họa trong game để các phiên đo FPS tiếp theo tự động gắn bối cảnh chính xác.
            </p>
          </div>
          {hardware.gpu && (
            <span className="gv-pill gv-pill-cyan">
              {hardware.gpu} · {hardware.ramGb} GB RAM
            </span>
          )}
        </div>

        {error && (
          <p className="gv-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="gv-notice" role="status">
            {notice}
          </p>
        )}

        <form
          className="gv-card-subtle gv-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setGraphics(
                await window.electronAPI.saveGameGraphics!(gameId, graphics),
              );
              setNotice("Đã lưu cấu hình cho các phiên đo tiếp theo.");
            });
          }}
        >
          <GraphicsFields value={graphics} onChange={setGraphics} />
          <div>
            <button className="gv-primary" disabled={busy}>
              <Save size={14} />
              Lưu cấu hình phiên tiếp theo
            </button>
          </div>
        </form>

        <div className="gv-card-subtle gv-stack">
          <div className="gv-top">
            <div>
              <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <FileCode2 size={16} className="gv-text-amber" />
                File cấu hình (INI / CFG / JSON / XML)
              </h3>
              <p className="gv-muted">
                Tự phát hiện hoặc chọn thủ công để đọc độ phân giải / xuất ZIP tại máy.
              </p>
            </div>
            <div className="gv-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const candidates =
                      await window.electronAPI.chooseGameConfig!(gameId);
                    if (preview) setPreview({ ...preview, candidates });
                    setSelected([]);
                  })
                }
              >
                <FolderOpen size={15} />
                Chọn file thủ công
              </button>
              <button
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() =>
                  void run(async () => {
                    const result =
                      await window.electronAPI.exportGameSettings!(
                        gameId,
                        selected,
                      );
                    if (result)
                      setNotice(
                        `Đã xuất ${result.files} file đến ${result.destination}`,
                      );
                  })
                }
              >
                <Download size={15} />
                Xuất ZIP ({selected.length})
              </button>
            </div>
          </div>

          {preview?.candidates.length ? (
            <div className="gv-stack-sm">
              {preview.candidates.map((c: ConfigCandidate) => (
                <div className="gv-card-subtle" key={c.path} style={{ padding: "10px 12px" }}>
                  <div className="gv-top">
                    <label className="gv-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.path)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, c.path]
                              : selected.filter((p) => p !== c.path),
                          )
                        }
                      />
                      <strong>{c.name}</strong>
                      <span className="gv-pill">{c.adapter}</span>
                      <span className="gv-muted">{(c.size / 1024).toFixed(1)} KB</span>
                    </label>
                    {c.graphics.width && (
                      <button
                        type="button"
                        className="gv-link"
                        onClick={() =>
                          setGraphics({ ...graphics, ...c.graphics })
                        }
                      >
                        Áp dụng {c.graphics.width}×{c.graphics.height}
                      </button>
                    )}
                  </div>
                  <p className="gv-muted" style={{ fontSize: 11, marginTop: 4, overflowWrap: "anywhere" }}>
                    {c.path}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="gv-muted">
              Chưa tự phát hiện file setting hỗ trợ. Bạn có thể bấm "Chọn file thủ công".
            </p>
          )}
        </div>

        <div className="gv-card-subtle gv-stack">
          <h3>Chia sẻ FPS & cấu hình lên cộng đồng</h3>
          {status !== "completed" ? (
            <p className="gv-muted">
              Đánh dấu game đã hoàn thành để chia sẻ kết quả chơi thực tế của bạn lên cộng đồng.
            </p>
          ) : (
            <>
              {preview && preview.reports.length === 0 && (
                <p className="gv-muted">
                  Chưa có phiên PresentMon cho game này — bạn vẫn có thể chia sẻ kết quả tự khai báo (CPU/GPU/RAM đã điền sẵn từ máy bạn).
                </p>
              )}
              <div className="gv-actions">
                <select
                  style={{ maxWidth: 360 }}
                  value={session}
                  onChange={(e) => setSession(e.target.value)}
                >
                  <option value="">Chọn phiên FPS đã đo</option>
                  {preview?.reports.map((r) => (
                    <option key={r.sessionId} value={r.sessionId}>
                      {new Date(r.measuredAt).toLocaleDateString("vi-VN")} ·{" "}
                      {r.fpsAverage.toFixed(1)} FPS ·{" "}
                      {r.snapshotAvailable && r.graphics.width && r.graphics.preset
                        ? "Có snapshot"
                        : "Thiếu snapshot/cấu hình"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !session}
                  onClick={() =>
                    void run(async () => {
                      setMeasured(
                        await window.electronAPI.prepareMeasuredReport!(
                          gameId,
                          Number(session),
                        ),
                      );
                      setShare(true);
                    })
                  }
                >
                  Dùng phiên đo này
                </button>
                <button
                  type="button"
                  className="gv-btn-cyan"
                  disabled={busy}
                  onClick={() => {
                    setMeasured(undefined);
                    setShare(true);
                  }}
                >
                  Nhập kết quả tự khai báo
                </button>
                <button type="button" disabled={busy} onClick={() => void load()}>
                  <RefreshCw size={14} />
                </button>
              </div>

              {share && preview && base && (
                <PerformanceShareForm
                  key={measured ? String(session) : "manual"}
                  api={api}
                  game={preview.game}
                  measured={measured}
                  defaults={{ ...hardware, graphics }}
                  onShared={onShared}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
