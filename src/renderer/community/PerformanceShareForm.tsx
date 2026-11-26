import React, { useState } from "react";
import { CheckCircle2, Cpu, Gauge } from "lucide-react";
import type {
  CommunityAdapter,
  GraphicsContext,
  PerformanceReport,
  PublicGame,
} from "../../shared/community.ts";
import { communityError } from "./client.ts";

const PRESETS = ["Low", "Medium", "High", "Ultra", "Custom"];
const RESOLUTIONS: Array<[string, number, number]> = [
  ["720p", 1280, 720],
  ["1080p", 1920, 1080],
  ["1440p", 2560, 1440],
  ["4K", 3840, 2160],
];

export function GraphicsFields({
  value,
  onChange,
  disabled = false,
}: {
  value: GraphicsContext;
  onChange: (v: GraphicsContext) => void;
  disabled?: boolean;
}) {
  const set = (key: keyof GraphicsContext, v: unknown) =>
    onChange({
      ...value,
      [key]: v,
      source: "manual",
    });

  return (
    <div className="gv-stack">
      {!disabled && (
        <div className="gv-actions" style={{ gap: 6 }}>
          <span className="gv-muted" style={{ fontSize: 12 }}>
            Chọn nhanh:
          </span>
          {RESOLUTIONS.map(([label, w, h]) => (
            <button
              key={label}
              type="button"
              className={`gv-chip ${value.width === w && value.height === h ? "active" : ""}`}
              onClick={() =>
                onChange({ ...value, width: w, height: h, source: "manual" })
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="gv-spec-form">
        <label>
          Chiều ngang game (px)
          <input
            type="number"
            min={320}
            max={16384}
            disabled={disabled}
            value={value.width ?? ""}
            placeholder="1920"
            onChange={(e) =>
              set("width", e.target.value ? Number(e.target.value) : null)
            }
          />
        </label>
        <label>
          Chiều cao game (px)
          <input
            type="number"
            min={200}
            max={16384}
            disabled={disabled}
            value={value.height ?? ""}
            placeholder="1080"
            onChange={(e) =>
              set("height", e.target.value ? Number(e.target.value) : null)
            }
          />
        </label>
        <label>
          Mức đồ họa
          <select
            disabled={disabled}
            value={value.preset}
            onChange={(e) => set("preset", e.target.value)}
          >
            <option value="">Chưa xác nhận</option>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nâng độ phân giải
          <input
            disabled={disabled}
            maxLength={80}
            value={value.upscaling}
            placeholder="Off / DLSS Quality / FSR..."
            onChange={(e) => set("upscaling", e.target.value)}
          />
        </label>
        <label>
          Tạo khung hình
          <input
            disabled={disabled}
            maxLength={80}
            value={value.frameGeneration}
            placeholder="Off / DLSS FG / FSR FG..."
            onChange={(e) => set("frameGeneration", e.target.value)}
          />
        </label>
        <label>
          Ray Tracing
          <input
            disabled={disabled}
            maxLength={80}
            value={value.rayTracing}
            placeholder="Off / Low / High..."
            onChange={(e) => set("rayTracing", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

const blank: GraphicsContext = {
  width: null,
  height: null,
  preset: "",
  upscaling: "",
  frameGeneration: "",
  rayTracing: "",
  source: "manual",
};

export function PerformanceShareForm({
  api,
  game,
  measured,
  onShared,
  defaults,
}: {
  api: CommunityAdapter;
  game: PublicGame;
  measured?: PerformanceReport;
  onShared?: () => void;
  defaults?: Partial<PerformanceReport>;
}) {
  const [cpu, setCpu] = useState(measured?.cpu || defaults?.cpu || "");
  const [gpu, setGpu] = useState(measured?.gpu || defaults?.gpu || "");
  const [ram, setRam] = useState(
    measured?.ramGb
      ? String(measured.ramGb)
      : defaults?.ramGb
        ? String(defaults.ramGb)
        : "",
  );
  const [fps, setFps] = useState(measured ? String(measured.fpsAverage) : "");
  const [graphics, setGraphics] = useState<GraphicsContext>(
    measured?.graphics || defaults?.graphics || blank,
  );
  const [notes, setNotes] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const report: PerformanceReport = measured
        ? {
            ...measured,
            notes,
          }
        : {
            ...game,
            completionStatus: "completed",
            cpu,
            gpu,
            ramGb: Number(ram),
            fpsAverage: Number(fps),
            fpsLow: null,
            samples: 0,
            graphics,
            source: "manual",
            measuredAt: new Date().toISOString(),
            notes,
          };
      await api.request(
        `/games/${encodeURIComponent(game.gameKey)}/performance`,
        "POST",
        report,
      );
      setSuccess(true);
      onShared?.();
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gv-card-subtle gv-stack" onSubmit={submit}>
      <div className="gv-top">
        <div className="gv-actions">
          {measured ? (
            <Gauge size={17} className="gv-text-emerald" />
          ) : (
            <Cpu size={17} className="gv-text-accent" />
          )}
          <h3>
            {measured
              ? "Chia sẻ phiên đo PresentMon"
              : "Chia sẻ cấu hình & FPS tự khai báo"}
          </h3>
        </div>
        <span
          className={`gv-pill ${measured ? "gv-pill-emerald" : "gv-pill-amber"}`}
        >
          {measured ? "Đo bằng PresentMon" : "Tự khai báo"}
        </span>
      </div>

      {error && (
        <p className="gv-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="gv-notice" role="status">
          <CheckCircle2 size={15} />
          Đã chia sẻ kết quả lên trang cộng đồng của game.
        </p>
      )}

      <div className="gv-spec-form">
        <label>
          CPU
          <input
            required
            maxLength={160}
            value={cpu}
            disabled={!!measured}
            onChange={(e) => setCpu(e.target.value)}
          />
        </label>
        <label>
          GPU của hệ thống
          <input
            required
            maxLength={160}
            value={gpu}
            disabled={!!measured}
            onChange={(e) => setGpu(e.target.value)}
          />
        </label>
        <label>
          RAM (GB)
          <input
            required
            type="number"
            min={0.1}
            max={4096}
            step="any"
            disabled={!!measured}
            value={ram}
            onChange={(e) => setRam(e.target.value)}
          />
        </label>
        <label>
          FPS trung bình
          <input
            required
            type="number"
            min={0.1}
            max={2000}
            step="any"
            value={fps}
            disabled={!!measured}
            onChange={(e) => setFps(e.target.value)}
          />
        </label>
      </div>

      <GraphicsFields
        value={graphics}
        onChange={setGraphics}
        disabled={!!measured}
      />

      <label>
        Ghi chú điều kiện chơi
        <textarea
          rows={2}
          maxLength={800}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Phiên bản game, khu vực đo, VSync, giới hạn FPS..."
        />
      </label>

      <label className="gv-check">
        <input
          required
          type="checkbox"
          checked={complete}
          onChange={(e) => setComplete(e.target.checked)}
        />
        Tôi xác nhận đã hoàn thành game và đồng ý công khai cấu hình/FPS này.
      </label>

      <div>
        <button
          className="gv-primary"
          disabled={
            busy ||
            !complete ||
            !graphics.width ||
            !graphics.height ||
            !graphics.preset
          }
        >
          {busy ? "Đang chia sẻ…" : "Chia sẻ công khai"}
        </button>
      </div>
    </form>
  );
}
