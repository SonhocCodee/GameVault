import React, { useMemo, useState, useEffect } from "react";
import type { Game, MediaItem } from "../../shared/types.ts";
import { createDesktopAdapter, gameToPublic } from "./DesktopCommunity.tsx";
import { PostComposer } from "./PostComposer.tsx";
import { communityError } from "./client.ts";
export function ScreenshotShare({
  game,
  media,
}: {
  game: Game;
  media: MediaItem[];
}) {
  const [base, setBase] = useState(""),
    [selected, setSelected] = useState<MediaItem[]>([]),
    [files, setFiles] = useState<File[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void window.electronAPI.getCommunityBaseUrl!()
      .then(setBase)
      .catch(() => {});
  }, []);
  const api = useMemo(() => createDesktopAdapter(base), [base]);
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
  return (
    <div
      className="gv-community"
      style={{
        padding: "24px 0",
      }}
    >
      <details>
        <summary>Chia sẻ ảnh game lên cộng đồng</summary>
        <p className="gv-muted">
          Chọn tối đa 3 ảnh. Chỉ ảnh bạn chọn mới được công khai sau khi bấm
          đăng.
        </p>
        {error && <p className="gv-error">{error}</p>}
        {notice && <p className="gv-notice">{notice}</p>}
        <div className="gv-images">
          {media
            .filter((m) => m.type === "image")
            .slice(0, 36)
            .map((m) => (
              <label key={m.path} className="gv-check">
                <input
                  type="checkbox"
                  checked={selected.some((s) => s.path === m.path)}
                  disabled={
                    !selected.some((s) => s.path === m.path) &&
                    selected.length >= 3
                  }
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? [...selected, m]
                        : selected.filter((s) => s.path !== m.path),
                    );
                    setFiles(null);
                  }}
                />
                <img
                  className="gv-thumb"
                  src={m.url}
                  alt={m.name}
                  loading="lazy"
                />
                <span className="gv-muted">{m.name}</span>
              </label>
            ))}
        </div>
        <button
          disabled={busy || !selected.length || !base}
          onClick={() => void prepare()}
        >
          {busy ? "Đang chuẩn bị ảnh…" : "Viết bài với ảnh đã chọn"}
        </button>
        {files && (
          <PostComposer
            key={selected.map((m) => m.path).join("|")}
            api={api}
            game={gameToPublic(game)}
            initialFiles={files}
            onPosted={() => {
              setFiles(null);
              setSelected([]);
              setNotice("Đã đăng ảnh công khai lên cộng đồng.");
            }}
          />
        )}
      </details>
    </div>
  );
}
