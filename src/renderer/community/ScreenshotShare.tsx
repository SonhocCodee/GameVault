import React, { useEffect, useMemo, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import type { Game, MediaItem } from "../../shared/types.ts";
import { createDesktopAdapter, gameToPublic } from "./DesktopCommunity.tsx";
import { PostComposer } from "./PostComposer.tsx";
import { communityError } from "./client.ts";
import "./community.css";

export function ScreenshotShare({
  game,
  media,
}: {
  game: Game;
  media: MediaItem[];
}) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState("");
  const [selected, setSelected] = useState<MediaItem[]>([]);
  const [files, setFiles] = useState<File[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void window.electronAPI
      .getCommunityBaseUrl!()
      .then(setBase)
      .catch(() => {});
  }, []);

  const api = useMemo(() => createDesktopAdapter(base), [base]);
  const images = useMemo(
    () => media.filter((m) => m.type === "image").slice(0, 36),
    [media],
  );

  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      const picked: File[] = [];
      for (const image of selected) {
        const response = await fetch(image.url);
        if (!response.ok) throw new Error("Cannot read screenshot");
        const blob = await response.blob();
        picked.push(
          new File([blob], image.name, {
            type: blob.type || "image/png",
          }),
        );
      }
      setFiles(picked);
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };

  if (images.length === 0) return null;

  return (
    <div className="gv-community" style={{ padding: "12px 0" }}>
      <div className="gv-card gv-stack">
        <div className="gv-top">
          <div>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Camera size={17} className="gv-text-accent" />
              Chia sẻ ảnh chụp game lên Cộng đồng
            </h3>
            <p className="gv-muted">
              Chọn tối đa 3 ảnh; chỉ những ảnh bạn chọn mới được tải lên công khai.
            </p>
          </div>
          <button
            type="button"
            className={open ? "" : "gv-primary"}
            onClick={() => {
              setOpen(!open);
              setNotice("");
            }}
          >
            {open ? (
              <>
                <X size={14} /> Đóng
              </>
            ) : (
              "Chọn ảnh để đăng"
            )}
          </button>
        </div>

        {notice && <p className="gv-notice">{notice}</p>}

        {open && (
          <div className="gv-stack">
            {error && <p className="gv-error">{error}</p>}
            <div className="gv-ss-grid">
              {images.map((m) => {
                const idx = selected.findIndex((s) => s.path === m.path);
                const isSelected = idx !== -1;
                return (
                  <button
                    type="button"
                    key={m.path}
                    className={`gv-ss-item ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      if (isSelected) {
                        setSelected(selected.filter((s) => s.path !== m.path));
                      } else if (selected.length < 3) {
                        setSelected([...selected, m]);
                      }
                      setFiles(null);
                    }}
                  >
                    <img src={m.url} alt={m.name} loading="lazy" />
                    <span className="gv-ss-badge">
                      {isSelected ? idx + 1 : <Check size={11} style={{ opacity: 0.3 }} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="gv-actions">
              <button
                type="button"
                className="gv-primary"
                disabled={busy || !selected.length || !base}
                onClick={() => void prepare()}
              >
                {busy
                  ? "Đang chuẩn bị ảnh…"
                  : `Viết bài với ${selected.length} ảnh đã chọn`}
              </button>
            </div>

            {files && (
              <PostComposer
                key={selected.map((m) => m.path).join("|")}
                api={api}
                game={gameToPublic(game)}
                initialFiles={files}
                onPosted={() => {
                  setFiles(null);
                  setSelected([]);
                  setOpen(false);
                  setNotice("Đã đăng ảnh công khai lên cộng đồng.");
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
