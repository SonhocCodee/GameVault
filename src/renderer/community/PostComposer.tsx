import React, { useState } from "react";
import { ImagePlus, Send } from "lucide-react";
import type {
  CommunityAdapter,
  PostKind,
  PublicGame,
} from "../../shared/community.ts";
import { communityError, uploadPostImages } from "./client.ts";
export function PostComposer({
  api,
  game,
  games = [],
  initialFiles = [],
  onPosted,
}: {
  api: CommunityAdapter;
  game?: PublicGame;
  games?: PublicGame[];
  initialFiles?: File[];
  onPosted: () => void;
}) {
  const [selected, setSelected] = useState<PublicGame | undefined>(game),
    [body, setBody] = useState(""),
    [kind, setKind] = useState<PostKind>(
      initialFiles.length ? "photo" : "thought",
    ),
    [spoiler, setSpoiler] = useState(false),
    [files, setFiles] = useState<File[]>(initialFiles),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !body.trim()) return;
    setBusy(true);
    setError("");
    let keys: string[] = [];
    try {
      keys = await uploadPostImages(api, files);
      await api.request("/posts", "POST", {
        ...selected,
        kind,
        body,
        spoiler,
        imageKeys: keys,
      });
      setBody("");
      setFiles([]);
      onPosted();
    } catch (err) {
      await Promise.allSettled(
        keys.map((k) => api.request(`/uploads/${k}`, "DELETE")),
      );
      setError(communityError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="gv-form" onSubmit={submit}>
      <h3>Chia sẻ trải nghiệm của bạn</h3>
      {error && (
        <p role="alert" className="gv-error">
          {error}
        </p>
      )}
      {!game && (
        <label>
          Game
          <select
            required
            value={selected?.gameKey || ""}
            onChange={(e) =>
              setSelected(games.find((g) => g.gameKey === e.target.value))
            }
          >
            <option value="">
              Chọn game trong thư viện hoặc tìm ở Khám phá
            </option>
            {games.map((g) => (
              <option key={g.gameKey} value={g.gameKey}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {game && <p>{game.title}</p>}
      <label>
        Loại bài
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PostKind)}
        >
          <option value="thought">Cảm nhận</option>
          <option value="photo">Ảnh game</option>
          <option value="question">Hỏi cộng đồng</option>
          <option value="completed">Vừa hoàn thành</option>
        </select>
      </label>
      <label>
        Nội dung
        <textarea
          required
          maxLength={4000}
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Một khoảnh khắc, cảm nhận hoặc câu hỏi về game..."
        />
      </label>
      <label className="gv-check">
        <input
          type="checkbox"
          checked={spoiler}
          onChange={(e) => setSpoiler(e.target.checked)}
        />
        Có tiết lộ nội dung game
      </label>
      <label>
        <span className="gv-actions">
          <ImagePlus size={16} />
          Chọn tối đa 3 ảnh; app nén ảnh trước khi đăng
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => {
            const incoming = Array.from(e.target.files || []);
            if (incoming.length > 3) {
              setError("Bạn chỉ có thể chọn tối đa 3 ảnh.");
              return;
            }
            setFiles(incoming);
            setError("");
          }}
        />
      </label>
      {files.length > 0 && (
        <p className="gv-muted">
          Đã chọn: {files.map((f) => f.name).join(", ")}{" "}
          <button
            type="button"
            className="gv-link"
            onClick={() => setFiles([])}
          >
            Bỏ ảnh
          </button>
        </p>
      )}
      <p className="gv-muted">
        Bài và những ảnh được chọn sẽ công khai. Ảnh khác, save và ghi chú riêng
        không được đăng.
      </p>
      <div>
        <button
          className="gv-primary"
          disabled={busy || !selected || !body.trim()}
        >
          <Send size={16} />
          {busy ? "Đang đăng…" : "Đăng công khai"}
        </button>
      </div>
    </form>
  );
}
