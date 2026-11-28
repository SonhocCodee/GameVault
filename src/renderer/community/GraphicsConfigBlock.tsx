import React, { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Download, FolderOpen, SlidersHorizontal, Upload } from "lucide-react";
import type { GraphicsContext, SharedConfigFile } from "../../shared/community.ts";

function downloadConfigFile(file: SharedConfigFile) {
  const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function GraphicsConfigBlock({
  graphics,
  localGameId,
}: {
  graphics: GraphicsContext;
  localGameId?: number | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const detailEntries = graphics.details ? Object.entries(graphics.details) : [];
  const configFiles = graphics.configFiles || [];

  if (!graphics.gameVersion && detailEntries.length === 0 && configFiles.length === 0) {
    return null;
  }

  return (
    <div className="gv-stack-sm" style={{ marginTop: 6 }}>
      {(graphics.gameVersion || detailEntries.length > 0) && (
        <div className="gv-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          {graphics.gameVersion && (
            <span className="gv-pill gv-pill-amber" style={{ fontSize: 11 }}>
              Phiên bản game: {graphics.gameVersion}
            </span>
          )}
          {detailEntries.length > 0 && (
            <button
              type="button"
              className="gv-btn"
              style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => setShowDetails((v) => !v)}
            >
              <SlidersHorizontal size={11} />{" "}
              {showDetails ? "Ẩn thông số chi tiết" : `Xem thông số (${detailEntries.length})`}
              {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
      )}

      {showDetails && detailEntries.length > 0 && (
        <div
          className="gv-card-subtle"
          style={{
            padding: "8px 10px",
            maxHeight: 240,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "6px 14px",
          }}
        >
          {detailEntries.map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 11,
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                paddingBottom: 3,
              }}
            >
              <span className="gv-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {k}
              </span>
              <strong style={{ flexShrink: 0 }}>{v}</strong>
            </div>
          ))}
        </div>
      )}

      {configFiles.length > 0 && (
        <div
          className="gv-card-subtle gv-stack-sm"
          style={{ padding: "8px 10px" }}
        >
          {configFiles.map((file) => (
            <div key={`${file.fileName}-${file.folderHint}`} className="gv-stack-sm">
              <div className="gv-actions" style={{ gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 12 }}>{file.fileName}</strong>
                <span className="gv-muted" style={{ fontSize: 11 }}>
                  {(file.size / 1024).toFixed(1)} KB
                </span>
                {graphics.gameVersion && (
                  <span className="gv-pill" style={{ fontSize: 10 }}>
                    v{graphics.gameVersion}
                  </span>
                )}
              </div>
              <div className="gv-muted" style={{ fontSize: 11, overflowWrap: "anywhere" }}>
                Thư mục chép vào: <code>{file.folderHint}</code>
              </div>
              <div className="gv-actions" style={{ gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="gv-btn"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => downloadConfigFile(file)}
                >
                  <Download size={11} /> Tải file
                </button>
                <button
                  type="button"
                  className="gv-btn"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  onClick={() => {
                    void navigator.clipboard?.writeText(file.folderHint);
                    setErrorMsg("");
                    setStatusMsg(`Đã copy đường dẫn: ${file.folderHint}`);
                  }}
                >
                  <Copy size={11} /> Copy đường dẫn
                </button>
                {window.electronAPI?.openConfigFolder && (
                  <button
                    type="button"
                    className="gv-btn"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={async () => {
                      setErrorMsg("");
                      setStatusMsg("");
                      const res = await window.electronAPI!.openConfigFolder!(
                        file.folderHint,
                        localGameId ?? undefined,
                      );
                      if (!res.opened) {
                        setErrorMsg(`Không tìm thấy thư mục trên máy: ${res.resolvedPath}`);
                      }
                    }}
                  >
                    <FolderOpen size={11} /> Mở thư mục
                  </button>
                )}
                {window.electronAPI?.importSharedConfig && (
                  <button
                    type="button"
                    className="gv-btn gv-btn-primary"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={async () => {
                      setErrorMsg("");
                      setStatusMsg("");
                      try {
                        const res = await window.electronAPI!.importSharedConfig!(
                          file.folderHint,
                          file.fileName,
                          file.content,
                          localGameId ?? undefined,
                        );
                        setStatusMsg(
                          res.backupPath
                            ? `Đã áp dụng vào ${res.importedPath} (đã backup file cũ).`
                            : `Đã áp dụng vào ${res.importedPath}.`,
                        );
                      } catch (err: any) {
                        setErrorMsg(err?.message || "Không thể áp dụng file setting.");
                      }
                    }}
                  >
                    <Upload size={11} /> Áp dụng vào máy
                  </button>
                )}
              </div>
            </div>
          ))}
          {statusMsg && (
            <p className="gv-muted" style={{ fontSize: 11, color: "#34d399" }}>
              {statusMsg}
            </p>
          )}
          {errorMsg && (
            <p className="gv-error" style={{ fontSize: 11 }}>
              {errorMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
