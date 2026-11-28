import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Cpu, FileCode2, Gauge, Monitor, RefreshCw } from "lucide-react";
import type {
  ConfigCandidate,
  PerformancePreview,
} from "../../shared/community.ts";
import type { FpsStatus, HardwareInfo } from "../../shared/types.js";
import { communityError } from "./client.ts";
import "./community.css";

function pickBestReportSessionId(preview: PerformancePreview | null): number | null {
  const reports = (preview?.reports || []).filter(
    (r) => Number.isFinite(r.fpsAverage) && r.fpsAverage > 0 && (r.samples || 0) >= 10,
  );
  if (reports.length === 0) return null;
  const full = reports.find(
    (r) => r.snapshotAvailable && r.cpu && r.gpu && r.ramGb > 0 && r.graphics.width && r.graphics.height,
  );
  if (full) return full.sessionId;
  const snap = reports.find((r) => r.snapshotAvailable && r.cpu && r.gpu && r.ramGb > 0);
  if (snap) return snap.sessionId;
  return reports[0].sessionId;
}

export function PerformancePanel({
  gameId,
  onShared,
}: {
  gameId: number;
  status?: string;
  onShared?: () => void;
}) {
  const [preview, setPreview] = useState<PerformancePreview | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [fpsStatus, setFpsStatus] = useState<FpsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (triggerSync = false) => {
    if (!window.electronAPI?.getPerformancePreview) return;
    setBusy(true);
    setError("");
    try {
      if (triggerSync) {
        await window.electronAPI.discoverGameConfigs?.(gameId, false).catch(() => null);
        if (window.electronAPI.syncGamePerformance) {
          const res = await window.electronAPI.syncGamePerformance(gameId).catch(() => null);
          if (res?.synced) {
            setSyncNotice("Đã tự động chọn phiên FPS đo được và đồng bộ lên Cộng đồng.");
            onShared?.();
          }
        }
      }
      const [p, hw, status] = await Promise.all([
        window.electronAPI.getPerformancePreview(gameId),
        window.electronAPI.getHardwareInfo?.().catch(() => null) ?? Promise.resolve(null),
        window.electronAPI.getFpsStatus?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      setPreview(p);
      if (hw) setHardware(hw);
      if (status) setFpsStatus(status);
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  }, [gameId, onShared]);

  useEffect(() => {
    setSyncNotice("");
    void load(true);
  }, [load]);

  const bestSessionId = useMemo(() => pickBestReportSessionId(preview), [preview]);
  const gpuLabel = hardware?.gpus?.map((g) => g.name).filter(Boolean).join(" / ") || "";

  return (
    <section className="gv-community" style={{ padding: "12px 0" }}>
      <div className="gv-card gv-stack">
        <div className="gv-top">
          <div>
            <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Gauge size={18} className="gv-text-cyan" />
              Phần cứng, Đồ họa &amp; FPS tự động quét
            </h3>
            <p className="gv-muted">
              App tự động quét phần cứng máy, file cấu hình game và dữ liệu đo FPS (PresentMon / AMD GameReport) rồi đồng bộ lên Cộng đồng — không cần nhập thủ công.
            </p>
          </div>
          <div className="gv-actions" style={{ gap: 8 }}>
            {fpsStatus && (
              <span className={`gv-pill ${fpsStatus.ready ? "gv-pill-emerald" : "gv-pill-amber"}`}>
                {fpsStatus.ready ? "PresentMon sẵn sàng" : "Chưa bật PresentMon"}
              </span>
            )}
            <button
              type="button"
              className="gv-icon-btn"
              title="Quét lại dữ liệu phần cứng & FPS"
              aria-label="Quét lại dữ liệu phần cứng & FPS"
              disabled={busy}
              onClick={() => void load(true)}
            >
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {error && (
          <p className="gv-error" role="alert">
            {error}
          </p>
        )}
        {syncNotice && (
          <p className="gv-notice" role="status">
            <CheckCircle2 size={15} />
            {syncNotice}
          </p>
        )}

        {/* Auto-scanned hardware & graphics context */}
        <div className="gv-card-subtle gv-stack-sm">
          <div className="gv-top">
            <span style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, fontSize: 13 }}>
              <Cpu size={15} className="gv-text-cyan" />
              Cấu hình hệ thống &amp; Đồ họa nhận diện được
            </span>
            <span className="gv-pill gv-pill-cyan">Tự động quét 100%</span>
          </div>

          <div className="gv-actions" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="gv-pill">
              <Monitor size={12} /> {gpuLabel || "Đang quét GPU..."}
            </span>
            <span className="gv-pill">{hardware?.cpu_name || "Đang quét CPU..."}</span>
            <span className="gv-pill">{hardware?.ram_gb ? `${hardware.ram_gb} GB RAM` : "RAM —"}</span>
            {hardware?.display?.width && hardware?.display?.height && (
              <span className="gv-pill">
                Màn hình: {hardware.display.width}×{hardware.display.height}
                {hardware.display.refresh_hz ? ` @ ${hardware.display.refresh_hz}Hz` : ""}
              </span>
            )}
          </div>

          <div className="gv-actions" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <span className="gv-pill gv-pill-cyan">
              Độ phân giải game:{" "}
              {preview?.context.width && preview?.context.height
                ? `${preview.context.width}×${preview.context.height}`
                : "Chưa phát hiện file cấu hình"}
            </span>
            <span className="gv-pill">
              Preset: {preview?.context.preset || "Tự động / Chưa nhận diện"}
            </span>
            {preview?.context.upscaling && (
              <span className="gv-pill">Upscaling: {preview.context.upscaling}</span>
            )}
            {preview?.context.frameGeneration && (
              <span className="gv-pill">FG: {preview.context.frameGeneration}</span>
            )}
            {preview?.context.rayTracing && (
              <span className="gv-pill">RT: {preview.context.rayTracing}</span>
            )}
          </div>
          {preview?.context.details && Object.keys(preview.context.details).length > 0 && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="gv-muted" style={{ fontSize: 11, marginBottom: 4 }}>
                Thiết lập chi tiết đọc được từ file setting:
              </div>
              <div className="gv-actions" style={{ gap: 6, flexWrap: "wrap" }}>
                {Object.entries(preview.context.details).map(([k, v]) => (
                  <span className="gv-pill" key={k} style={{ fontSize: 11 }}>
                    {k}: <strong>{v}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Auto-detected config files (read-only) */}
        <div className="gv-card-subtle gv-stack-sm">
          <div className="gv-top">
            <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <FileCode2 size={16} className="gv-text-amber" />
              File cấu hình tự phát hiện (INI / CFG / JSON / XML)
            </h3>
            <div className="gv-actions" style={{ gap: 8 }}>
              <span className="gv-muted" style={{ fontSize: 12 }}>
                {preview?.candidates.length ? `${preview.candidates.length} file` : "Không có"}
              </span>
              {window.electronAPI?.chooseGameConfig && (
                <button
                  type="button"
                  className="gv-btn"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  disabled={busy}
                  onClick={async () => {
                    await window.electronAPI?.chooseGameConfig?.(gameId);
                    void load(true);
                  }}
                >
                  Chọn file setting...
                </button>
              )}
            </div>
          </div>
          {preview?.candidates.length ? (
            <div className="gv-stack-sm">
              {preview.candidates.map((c: ConfigCandidate) => (
                <div className="gv-card-subtle" key={c.path} style={{ padding: "8px 12px" }}>
                  <div className="gv-top">
                    <div className="gv-actions" style={{ gap: 8 }}>
                      <strong>{c.name}</strong>
                      <span className="gv-pill">{c.adapter}</span>
                      <span className="gv-muted">{(c.size / 1024).toFixed(1)} KB</span>
                      {c.graphics.width && c.graphics.height && (
                        <span className="gv-pill gv-pill-cyan">
                          {c.graphics.width}×{c.graphics.height}
                          {c.graphics.preset ? ` · ${c.graphics.preset}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="gv-muted" style={{ fontSize: 11, marginTop: 4, overflowWrap: "anywhere" }}>
                    {c.path}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="gv-muted">
              Game này chưa có file cấu hình nằm trong danh sách tự nhận diện.
            </p>
          )}
        </div>

        {/* Measured FPS sessions (100% auto-scanned) */}
        <div className="gv-card-subtle gv-stack-sm">
          <div className="gv-top">
            <h3>Các phiên FPS đã tự động ghi nhận</h3>
            <span className="gv-muted" style={{ fontSize: 12 }}>
              Tự chọn phiên đại diện khi đồng bộ
            </span>
          </div>

          {preview && preview.reports.length === 0 ? (
            <p className="gv-muted">
              Chưa có dữ liệu FPS cho game này. Khi bạn chơi qua tracker (PresentMon) hoặc có báo cáo mới từ AMD GameReport, app sẽ tự quét và cập nhật tại đây.
            </p>
          ) : (
            <div className="gv-stack-sm" style={{ maxHeight: 320, overflowY: "auto" }}>
              {preview?.reports.map((r) => {
                const isSelected = r.sessionId === bestSessionId;
                const displayGpu = r.gpu || gpuLabel || "GPU máy hiện tại";
                const displayCpu = r.cpu || hardware?.cpu_name || "CPU máy hiện tại";
                const displayRam = r.ramGb > 0 ? r.ramGb : hardware?.ram_gb || 0;
                return (
                  <article className="gv-perf-card" key={r.sessionId}>
                    <div className="gv-stack-sm">
                      <div className="gv-actions" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span className="gv-muted" style={{ fontSize: 12 }}>
                          {new Date(r.measuredAt).toLocaleString("vi-VN")}
                        </span>
                        <span className="gv-pill gv-pill-emerald">Tự đo</span>
                        {isSelected && (
                          <span className="gv-pill gv-pill-cyan">
                            <CheckCircle2 size={11} /> Tự chọn đồng bộ Cộng đồng
                          </span>
                        )}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        <Monitor size={14} style={{ display: "inline", marginRight: 6 }} />
                        {displayGpu} · {displayCpu} · {displayRam > 0 ? `${displayRam} GB RAM` : "RAM —"}
                      </div>
                      <div className="gv-actions" style={{ gap: 6, flexWrap: "wrap" }}>
                        <span className="gv-pill gv-pill-cyan">
                          {r.graphics.width && r.graphics.height
                            ? `${r.graphics.width}×${r.graphics.height}`
                            : "Chưa nhận diện độ phân giải"}
                        </span>
                        <span className="gv-pill">
                          {r.graphics.preset || "Chưa nhận diện preset"}
                        </span>
                      </div>
                    </div>
                    <div className="gv-fps-box">
                      <div className="gv-fps-big">{r.fpsAverage.toFixed(1)}</div>
                      <div className="gv-muted" style={{ fontSize: 11 }}>AVG FPS</div>
                      <div className="gv-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        1% low: {r.fpsLow != null ? r.fpsLow.toFixed(1) : "—"}
                      </div>
                      <div className="gv-muted" style={{ fontSize: 10, marginTop: 4 }}>
                        {r.samples.toLocaleString("vi-VN")} frames
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
