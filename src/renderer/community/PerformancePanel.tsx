import React, { useEffect, useMemo, useState } from "react";
import { Download, Gauge, FolderOpen } from "lucide-react";
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
  const [preview, setPreview] = useState<PerformancePreview | null>(null),
    [graphics, setGraphics] = useState(blank),
    [selected, setSelected] = useState<string[]>([]),
    [base, setBase] = useState(""),
    [session, setSession] = useState(""),
    [measured, setMeasured] = useState<PerformanceReport | undefined>(),
    [share, setShare] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
        if (h) setHardware({ cpu: h.cpu_name, gpu: h.gpus.map(g => g.name).join(" / "), ramGb: h.ram_gb });
      } catch { /* Manual entry remains available when hardware detection fails. */ }
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
    <section
      className="gv-community"
      style={{
        padding: "28px 0",
      }}
    >
      <h2
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <Gauge size={20} />
        Cấu hình và hiệu năng của game
      </h2>
      <p className="gv-muted">
        Xác nhận độ phân giải trong game và mức đồ họa để các phiên FPS tiếp
        theo có bối cảnh. Đây không phải độ phân giải màn hình.
      </p>
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
        className="gv-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            setGraphics(
              await window.electronAPI.saveGameGraphics!(gameId, graphics),
            );
            setNotice(
              "Đã lưu cấu hình cho các phiên đo tiếp theo. Phiên cũ không bị đổi thông tin.",
            );
          });
        }}
      >
        <GraphicsFields value={graphics} onChange={setGraphics} />
        <div>
          <button className="gv-primary" disabled={busy}>
            Lưu cấu hình phiên tiếp theo
          </button>
        </div>
      </form>
      <h3>File setting</h3>
      <p className="gv-muted">
        Tự nhận diện hiện hỗ trợ The Witcher 3, Cyberpunk 2077 và một số game
        Unreal có đường dẫn phù hợp. Bạn có thể chọn file
        INI/CFG/JSON/XML/SETTINGS thủ công, tối đa 2 MB/file.
      </p>
      {preview?.candidates.length ? (
        preview.candidates.map((c: ConfigCandidate) => (
          <div
            key={c.path}
            style={{
              margin: "12px 0",
            }}
          >
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
              {c.name} · {c.adapter} · {(c.size / 1024).toFixed(1)} KB
            </label>
            <p
              className="gv-muted"
              style={{
                overflowWrap: "anywhere",
              }}
            >
              {c.path}
            </p>
            {c.graphics.width && (
              <button
                className="gv-link"
                onClick={() =>
                  setGraphics({
                    ...graphics,
                    ...c.graphics,
                  })
                }
              >
                Dùng độ phân giải đọc từ file rồi xác nhận
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="gv-muted">
          Chưa phát hiện file được hỗ trợ. Không quét toàn bộ thư mục máy.
        </p>
      )}
      <p className="gv-muted">
        Gói ZIP chỉ xuất tại máy. File thô có thể chứa thông tin riêng; hãy kiểm
        tra trước khi gửi cho người khác. Setting gốc không bị sửa và gói không
        được tự đăng lên cộng đồng.
      </p>
      <div className="gv-actions">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const candidates =
                await window.electronAPI.chooseGameConfig!(gameId);
              if (preview)
                setPreview({
                  ...preview,
                  candidates,
                });
              setSelected([]);
            })
          }
        >
          <FolderOpen size={16} />
          Chọn file thủ công
        </button>
        <button
          disabled={busy || selected.length === 0}
          onClick={() =>
            void run(async () => {
              const result = await window.electronAPI.exportGameSettings!(
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
          <Download size={16} />
          Xuất setting thành ZIP
        </button>
      </div>
      <h3
        style={{
          marginTop: 28,
        }}
      >
        Chia sẻ kết quả sau khi hoàn thành
      </h3>
      {status !== "completed" ? (
        <p className="gv-muted">
          Đánh dấu game đã hoàn thành để chia sẻ kết quả chơi thực tế.
        </p>
      ) : (
        <>
          <p className="gv-muted">
            Chọn một phiên đo. Phiên cũ thiếu snapshot hoặc cấu hình không thể
            được gắn nhãn là kết quả đo đầy đủ.
          </p>
          {preview && preview.reports.length === 0 && <p className="gv-notice">Game này chưa có phiên FPS đã đo. Bạn vẫn có thể nhập kết quả tự khai báo; CPU, GPU và RAM được điền từ máy hiện tại để bạn kiểm tra lại.</p>}
          <div className="gv-form">
            <label>
              Phiên FPS đã đo
              <select
                value={session}
                onChange={(e) => setSession(e.target.value)}
              >
                <option value="">Chọn phiên</option>
                {preview?.reports.map((r) => (
                  <option key={r.sessionId} value={r.sessionId}>
                    {new Date(r.measuredAt).toLocaleDateString("vi-VN")} ·{" "}
                    {r.fpsAverage.toFixed(1)} FPS ·{" "}
                    {r.snapshotAvailable &&
                    r.graphics.width &&
                    r.graphics.preset
                      ? "Có snapshot"
                      : "Thiếu snapshot/cấu hình"}
                  </option>
                ))}
              </select>
            </label>
            <div className="gv-actions">
              <button
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
                Xem trước phiên đo
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setMeasured(undefined);
                  setShare(true);
                }}
              >
                Nhập kết quả tự khai báo
              </button>
              <button disabled={busy} onClick={() => void load()}>
                Làm mới phiên đo
              </button>
            </div>
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
    </section>
  );
}
