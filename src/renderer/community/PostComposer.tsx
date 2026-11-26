import React, { useEffect, useMemo, useState } from "react";
import {
  Camera,
  EyeOff,
  HelpCircle,
  ImagePlus,
  MessageSquareText,
  Search,
  Send,
  Trophy,
  X,
} from "lucide-react";
import type {
  CommunityAdapter,
  PostKind,
  PublicGame,
} from "../../shared/community.ts";
import {
  communityError,
  qualifyCommunityUrl,
  uploadPostImages,
} from "./client.ts";

const COMPOSER_KINDS: Array<{
  id: PostKind;
  label: string;
  Icon: React.FC<{ size?: number }>;
}> = [
  { id: "thought", label: "Cảm nhận", Icon: MessageSquareText },
  { id: "photo", label: "Ảnh game", Icon: Camera },
  { id: "question", label: "Hỏi đáp", Icon: HelpCircle },
  { id: "completed", label: "Vừa phá đảo", Icon: Trophy },
];

export function PostComposer({
  api,
  game,
  games = [],
  initialFiles = [],
  initialKind,
  onPosted,
  onCancel,
}: {
  api: CommunityAdapter;
  game?: PublicGame;
  games?: PublicGame[];
  initialFiles?: File[];
  initialKind?: PostKind;
  onPosted: () => void;
  onCancel?: () => void;
}) {
  const [selected, setSelected] = useState<PublicGame | undefined>(game);
  const [gameFilter, setGameFilter] = useState("");
  const [remoteGames, setRemoteGames] = useState<PublicGame[]>([]);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<PostKind>(
    initialKind || (initialFiles.length ? "photo" : "thought"),
  );
  const [spoiler, setSpoiler] = useState(false);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (game) {
      setSelected(game);
      return;
    }
    const q = gameFilter.trim();
    if (q.length < 2) {
      setRemoteGames([]);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .request<{ items: PublicGame[] }>(`/search?q=${encodeURIComponent(q)}`)
        .then((res) => setRemoteGames(res.items || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [api, game, gameFilter]);

  const pickerGames = useMemo(() => {
    const q = gameFilter.trim().toLowerCase();
    const localFiltered = q
      ? games.filter((g) => g.title.toLowerCase().includes(q))
      : games;
    const seen = new Set(localFiltered.map((g) => g.gameKey));
    const merged = [...localFiltered];
    for (const rg of remoteGames) {
      if (!seen.has(rg.gameKey)) {
        seen.add(rg.gameKey);
        merged.push(rg);
      }
    }
    return merged.slice(0, 24);
  }, [games, remoteGames, gameFilter]);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );
  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const addFiles = (incoming: File[]) => {
    const valid = incoming.filter((f) =>
      ["image/jpeg", "image/png", "image/webp"].includes(f.type),
    );
    if (valid.length !== incoming.length) {
      setError("Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.");
    }
    const next = [...files, ...valid].slice(0, 3);
    if (files.length + valid.length > 3) {
      setError("Chỉ chọn tối đa 3 ảnh cho mỗi bài viết.");
    } else if (valid.length === incoming.length) {
      setError("");
    }
    setFiles(next);
    if (next.length > 0 && kind === "thought" && !body.trim()) {
      setKind("photo");
    }
  };

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
    <form className="gv-card gv-stack" onSubmit={submit}>
      <div className="gv-top">
        <h3>Chia sẻ trải nghiệm game</h3>
        {onCancel && (
          <button type="button" className="gv-icon-btn" onClick={onCancel} aria-label="Đóng">
            <X size={16} />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="gv-error">
          {error}
        </p>
      )}

      {!game ? (
        <div className="gv-stack-sm">
          <label>
            Gắn game cho bài viết
            <div style={{ position: "relative" }}>
              <input
                value={gameFilter}
                onChange={(e) => setGameFilter(e.target.value)}
                placeholder="Tìm game trong thư viện hoặc trên Steam..."
              />
            </div>
          </label>
          {selected && (
            <div className="gv-actions">
              <span className="gv-pill gv-pill-cyan">
                Đã chọn: {selected.title}
              </span>
              <button
                type="button"
                className="gv-link"
                onClick={() => setSelected(undefined)}
              >
                Đổi game
              </button>
            </div>
          )}
          {!selected && (
            <div className="gv-game-picker-list">
              {pickerGames.map((g) => {
                const thumb = g.coverUrl
                  ? qualifyCommunityUrl(api.publicBase, g.coverUrl)
                  : "";
                return (
                  <button
                    key={g.gameKey}
                    type="button"
                    className="gv-game-pick-item"
                    onClick={() => setSelected(g)}
                  >
                    {thumb && <img src={thumb} alt="" loading="lazy" />}
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {g.title}
                    </span>
                  </button>
                );
              })}
              {pickerGames.length === 0 && (
                <p className="gv-muted">
                  Nhập ít nhất 2 ký tự để tìm game từ cơ sở dữ liệu / Steam.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="gv-actions">
          <span className="gv-game-chip">
            {game.coverUrl &&
              qualifyCommunityUrl(api.publicBase, game.coverUrl) && (
                <img
                  src={qualifyCommunityUrl(api.publicBase, game.coverUrl)}
                  alt=""
                />
              )}
            <strong>{game.title}</strong>
          </span>
        </div>
      )}

      <div className="gv-stack-sm">
        <span className="gv-muted" style={{ fontSize: 12, fontWeight: 600 }}>
          Chủ đề bài viết
        </span>
        <div className="gv-chip-row">
          {COMPOSER_KINDS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`gv-chip ${kind === id ? "active" : ""}`}
              onClick={() => setKind(id)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <label>
        Nội dung
        <textarea
          required
          maxLength={4000}
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Kể về khoảnh khắc ấn tượng, cảm nhận sau khi phá đảo hoặc hỏi cộng đồng..."
        />
      </label>

      <div className="gv-stack-sm">
        <label className="gv-dropzone">
          <ImagePlus size={20} />
          <span>
            Chọn hoặc kéo thả tối đa 3 ảnh (tự động nén gọn trước khi đăng)
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              e.currentTarget.value = "";
            }}
          />
        </label>

        {previews.length > 0 && (
          <div className="gv-thumb-grid">
            {previews.map((p, idx) => (
              <div className="gv-thumb-card" key={`${p.file.name}-${idx}`}>
                <img src={p.url} alt={p.file.name} />
                <button
                  type="button"
                  className="gv-thumb-remove"
                  aria-label="Xóa ảnh"
                  onClick={() =>
                    setFiles(files.filter((_, i) => i !== idx))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="gv-top">
        <label className="gv-check">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(e) => setSpoiler(e.target.checked)}
          />
          <EyeOff size={14} />
          Cảnh báo tiết lộ nội dung (Spoiler)
        </label>

        <div className="gv-actions">
          {onCancel && (
            <button type="button" disabled={busy} onClick={onCancel}>
              Hủy
            </button>
          )}
          <button
            className="gv-primary"
            disabled={busy || !selected || !body.trim()}
          >
            <Send size={15} />
            {busy ? "Đang đăng…" : "Đăng công khai"}
          </button>
        </div>
      </div>
    </form>
  );
}
