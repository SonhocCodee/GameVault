import React, { useState } from "react";
import {
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  Flag,
  Trash2,
  Pencil,
} from "lucide-react";
import type {
  CommunityAdapter,
  CommunityPost,
  CommunityComment,
  Page,
  PublicProfile,
  PublicGame,
} from "../../shared/community.ts";
import { communityError, qualifyCommunityUrl, shareUrl } from "./client.ts";
export function PostCard({
  post,
  api,
  me,
  onChanged,
  onGame,
  onProfile,
  expanded = false,
}: {
  post: CommunityPost;
  api: CommunityAdapter;
  me: PublicProfile | null;
  onChanged: () => void;
  onGame: (game: PublicGame) => void;
  onProfile: (uid: string) => void;
  expanded?: boolean;
}) {
  const [revealed, setRevealed] = useState(false),
    [commentsOpen, setCommentsOpen] = useState(expanded),
    [comments, setComments] = useState<Page<CommunityComment>>({
      items: [],
      hasMore: false,
      nextOffset: 0,
    }),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(post.body),
    [reason, setReason] = useState(""),
    [reported, setReported] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      if (!me) {
        await api.signIn();
        return;
      }
      await work();
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };
  const loadComments = async (more = false) => {
    try {
      const next = await api.request<Page<CommunityComment>>(
        `/posts/${post.id}/comments?offset=${more ? comments.nextOffset : 0}`,
      );
      setComments(
        more
          ? {
              ...next,
              items: [...comments.items, ...next.items],
            }
          : next,
      );
    } catch (e) {
      setError(communityError(e));
    }
  };
  React.useEffect(() => {
    if (commentsOpen) void loadComments();
  }, [commentsOpen, post.id]);
  return (
    <article className="gv-post">
      <div className="gv-post-meta">
        <button className="gv-link" onClick={() => onProfile(post.uid)}>
          {post.nickname}
        </button>
        <span className="gv-muted">
          {new Date(post.createdAt.replace(" ", "T") + "Z").toLocaleString(
            "vi-VN",
          )}
        </span>
        {post.edited && <span className="gv-muted">Đã chỉnh sửa</span>}
      </div>
      <button className="gv-link" onClick={() => onGame(post)}>
        {post.title}
      </button>
      {post.spoiler && !revealed ? (
        <div className="gv-empty">
          <p>Bài này có tiết lộ nội dung game.</p>
          <button onClick={() => setRevealed(true)}>Xem nội dung</button>
        </div>
      ) : (
        <>
          {editing ? (
            <form
              className="gv-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.request(`/posts/${post.id}`, "PUT", {
                    body: draft,
                    spoiler: post.spoiler,
                  });
                  setEditing(false);
                  onChanged();
                });
              }}
            >
              <label>
                Sửa nội dung
                <textarea
                  rows={4}
                  maxLength={4000}
                  required
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              <div className="gv-actions">
                <button disabled={busy}>Lưu</button>
                <button type="button" onClick={() => setEditing(false)}>
                  Hủy
                </button>
              </div>
            </form>
          ) : (
            <p className="gv-post-body">{post.body}</p>
          )}
          <div className="gv-images">
            {post.images.map((url, index) => (
              <a
                key={url}
                href={qualifyCommunityUrl(api.publicBase, url)}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={qualifyCommunityUrl(api.publicBase, url)}
                  loading="lazy"
                  alt={`${post.title} — ảnh ${index + 1} của ${post.nickname}`}
                />
              </a>
            ))}
          </div>
        </>
      )}
      <div className="gv-actions">
        <button
          disabled={busy}
          aria-pressed={post.liked}
          aria-label={post.liked ? "Bỏ tim" : "Thả tim"}
          onClick={() =>
            void run(async () => {
              await api.request(
                `/posts/${post.id}/like`,
                post.liked ? "DELETE" : "PUT",
              );
              onChanged();
            })
          }
        >
          <Heart size={16} />
          {post.likes}
        </button>
        <button
          aria-expanded={commentsOpen}
          onClick={() => setCommentsOpen(!commentsOpen)}
        >
          <MessageCircle size={16} />
          {post.comments} bình luận
        </button>
        <button
          disabled={busy}
          aria-pressed={post.saved}
          onClick={() =>
            void run(async () => {
              await api.request(
                `/posts/${post.id}/save`,
                post.saved ? "DELETE" : "PUT",
              );
              onChanged();
            })
          }
        >
          <Bookmark size={16} />
          {post.saved ? "Đã lưu" : "Lưu"}
        </button>
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(shareUrl(api.publicBase, "post", post.id))
              .then(() => setError("Đã sao chép liên kết."))
              .catch(() =>
                setError(
                  "Không sao chép được. Mở liên kết bài viết để chia sẻ.",
                ),
              )
          }
        >
          <Share2 size={16} />
          Chia sẻ
        </button>
        <a
          href={shareUrl(api.publicBase, "post", post.id)}
          target="_blank"
          rel="noreferrer"
        >
          Mở bài
        </a>
        {me?.uid === post.uid && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                post.kind === "review" ? onGame(post) : setEditing(!editing)
              }
            >
              <Pencil size={16} />
              Sửa
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!window.confirm("Xóa bài và ảnh đã đăng?")) return;
                  await api.request(`/posts/${post.id}`, "DELETE");
                  onChanged();
                })
              }
            >
              <Trash2 size={16} />
              Xóa
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="status" className="gv-notice">
          {error}
        </p>
      )}
      <details className="gv-report-panel">
        <summary className="gv-muted">
          <Flag
            size={14}
            style={{
              display: "inline",
              marginRight: 6,
            }}
          />
          Báo cáo bài viết
        </summary>
        {reported ? (
          <p>Đã gửi báo cáo cho quản trị.</p>
        ) : (
          <form
            className="gv-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.request("/reports", "POST", {
                  targetType: "post",
                  targetId: post.id,
                  reason,
                });
                setReported(true);
              });
            }}
          >
            <label>
              Lý do
              <input
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Spam, công kích hoặc spoiler chưa được đánh dấu..."
              />
            </label>
            <div>
              <button disabled={busy}>Gửi báo cáo</button>
            </div>
          </form>
        )}
      </details>
      {commentsOpen && (
        <section className="gv-comments" aria-label="Bình luận">
          {comments.items.map((c) => (
            <div className="gv-comment" key={c.id}>
              <button className="gv-link" onClick={() => onProfile(c.uid)}>
                {c.nickname}
              </button>
              <p className="gv-post-body">{c.body}</p>
              <div className="gv-actions">
                {me?.uid === c.uid && (
                  <button
                    className="gv-link"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.request(`/comments/${c.id}`, "DELETE");
                        await loadComments();
                        onChanged();
                      })
                    }
                  >
                    Xóa bình luận
                  </button>
                )}
                <button
                  className="gv-link"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const note = window.prompt(
                        "Lý do báo cáo bình luận (tối đa 500 ký tự):",
                      );
                      if (note?.trim()) {
                        await api.request("/reports", "POST", {
                          targetType: "comment",
                          targetId: c.id,
                          reason: note.slice(0, 500),
                        });
                        setError("Đã gửi báo cáo.");
                      }
                    })
                  }
                >
                  Báo cáo
                </button>
              </div>
            </div>
          ))}
          {comments.hasMore && (
            <button onClick={() => void loadComments(true)}>
              Xem thêm bình luận
            </button>
          )}
          {me ? (
            <form
              className="gv-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.request(`/posts/${post.id}/comments`, "POST", {
                    body: text,
                  });
                  setText("");
                  await loadComments();
                  onChanged();
                });
              }}
            >
              <label>
                Viết bình luận
                <textarea
                  required
                  rows={2}
                  maxLength={1500}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <div>
                <button disabled={busy || !text.trim()}>Gửi bình luận</button>
              </div>
            </form>
          ) : (
            <button
              onClick={() =>
                void api.signIn().catch((e) => setError(communityError(e)))
              }
            >
              Đăng nhập để bình luận
            </button>
          )}
        </section>
      )}
    </article>
  );
}
