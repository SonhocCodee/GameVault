import React, { useEffect, useState } from "react";
import {
  Bookmark,
  Clock,
  Eye,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  Pencil,
  Share2,
  Star,
  Trash2,
  ExternalLink,
} from "lucide-react";
import type {
  CommunityAdapter,
  CommunityComment,
  CommunityPost,
  Page,
  PublicGame,
  PublicProfile,
} from "../../shared/community.ts";
import {
  communityError,
  formatCommunityDate,
  formatRelativeTime,
  minutesLabel,
  qualifyCommunityUrl,
  shareUrl,
} from "./client.ts";
import {
  Avatar,
  ConfirmModal,
  formatScore,
  ImageLightbox,
  KindBadge,
  ReportModal,
  scoreTierClass,
} from "./CommunityWidgets.tsx";

export function PostCard({
  post,
  api,
  me,
  onChanged,
  onGame,
  onProfile,
  onToast,
  expanded = false,
  hideSave = false,
}: {
  post: CommunityPost;
  api: CommunityAdapter;
  me: PublicProfile | null;
  onChanged: () => void;
  onGame: (game: PublicGame) => void;
  onProfile: (uid: string) => void;
  onToast?: (msg: string) => void;
  expanded?: boolean;
  hideSave?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(expanded);
  const [comments, setComments] = useState<Page<CommunityComment>>({
    items: [],
    hasMore: false,
    nextOffset: 0,
  });
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [draftSpoiler, setDraftSpoiler] = useState(post.spoiler);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    type: "post" | "comment";
    id: string;
  } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

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

  useEffect(() => {
    if (commentsOpen) void loadComments();
  }, [commentsOpen, post.id]);

  useEffect(() => {
    setRevealed(false);
    setLightboxSrc(null);
  }, [post.id, post.spoiler]);

  const coverUrl = post.coverUrl
    ? qualifyCommunityUrl(api.publicBase, post.coverUrl)
    : "";

  return (
    <article className="gv-post-card">
      <header className="gv-post-header">
        <div className="gv-post-author">
          <Avatar name={post.nickname} url={post.avatarUrl} size={38} />
          <div className="gv-post-identity">
            <div className="gv-post-identity-row">
              <button
                className="gv-link"
                style={{ padding: 0, fontWeight: 700, color: "#f1f3f7" }}
                onClick={() => onProfile(post.uid)}
              >
                {post.nickname}
              </button>
              <button
                type="button"
                className="gv-game-chip gv-post-game"
                onClick={() => onGame(post)}
                title={post.title}
              >
                {coverUrl && <img src={coverUrl} alt="" loading="lazy" />}
                <span>{post.title}</span>
              </button>
              <KindBadge kind={post.kind} />
              {post.kind === "review" && post.reviewScore != null && (
                <span className={`gv-score-pill ${scoreTierClass(post.reviewScore)}`}>
                  <Star size={12} />
                  {formatScore(post.reviewScore)}/10
                </span>
              )}
              {post.reviewDropped && (
                <span className="gv-pill gv-pill-accent">Đã bỏ game</span>
              )}
            </div>
            <div className="gv-muted" style={{ fontSize: 12 }} title={formatCommunityDate(post.createdAt)}>
              {formatRelativeTime(post.createdAt)}
              {post.playtimeMinutes && post.playtimeMinutes > 0
                ? ` · Đã chơi ${minutesLabel(post.playtimeMinutes)}`
                : ""}
              {post.edited ? " · Đã chỉnh sửa" : ""}
            </div>
          </div>
        </div>
      </header>

      {post.spoiler && !revealed && !editing ? (
        <div className={`gv-spoiler-box${post.images.length ? " gv-spoiler-preview" : ""}`}>
          {post.images.length > 0 && (
            <div className="gv-spoiler-media" aria-hidden="true">
              {post.images.map((url) => {
                const src = qualifyCommunityUrl(api.publicBase, url);
                return src ? <img key={url} src={src} alt="" loading="lazy" draggable={false} /> : null;
              })}
            </div>
          )}
          <div className="gv-spoiler-warning">
            <EyeOff size={24} aria-hidden="true" />
            <strong>Cảnh báo spoiler</strong>
            <span>Bài viết tiết lộ nội dung game. Chỉ mở khi bạn sẵn sàng xem.</span>
            <button type="button" onClick={() => setRevealed(true)}>
              <Eye size={14} />
              Hiện nội dung{post.images.length ? " và ảnh" : ""}
            </button>
          </div>
        </div>
      ) : (
        <>
          {editing ? (
            <form
              className="gv-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.request(`/posts/${post.id}`, "PUT", {
                    body: draft,
                    spoiler: draftSpoiler,
                  });
                  setEditing(false);
                  onChanged();
                  onToast?.("Đã cập nhật bài viết.");
                });
              }}
            >
              <textarea
                rows={4}
                maxLength={4000}
                required
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="gv-top">
                <label className="gv-check">
                  <input
                    type="checkbox"
                    checked={draftSpoiler}
                    onChange={(e) => setDraftSpoiler(e.target.checked)}
                  />
                  Có spoiler
                </label>
                <div className="gv-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setDraft(post.body);
                    }}
                  >
                    Hủy
                  </button>
                  <button className="gv-primary" disabled={busy || !draft.trim()}>
                    Lưu thay đổi
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <p className="gv-post-body">{post.body}</p>
          )}

          {post.images.length > 0 && (
            <div className="gv-images">
              {post.images.map((url, index) => {
                const src = qualifyCommunityUrl(api.publicBase, url);
                if (!src) return null;
                return (
                  <button
                    key={url}
                    type="button"
                    className="gv-img-btn"
                    onClick={() => setLightboxSrc(src)}
                  >
                    <img
                      src={src}
                      loading="lazy"
                      alt={`${post.title} — ảnh ${index + 1} của ${post.nickname}`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="gv-error">
          {error}
        </p>
      )}

      <footer className="gv-post-footer">
        <div className="gv-actions">
          <button
            type="button"
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
            <Heart size={15} />
            {post.likes}
          </button>

          <button
            type="button"
            aria-expanded={commentsOpen}
            onClick={() => setCommentsOpen(!commentsOpen)}
          >
            <MessageCircle size={15} />
            {post.comments} bình luận
          </button>

          {!hideSave && (
            <button
              type="button"
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
              <Bookmark size={15} />
              {post.saved ? "Đã lưu" : "Lưu"}
            </button>
          )}
        </div>

        <div className="gv-actions">
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(shareUrl(api.publicBase, "post", post.id))
                .then(() => onToast?.("Đã sao chép liên kết bài viết."))
                .catch(() => setError("Không sao chép được liên kết."))
            }
          >
            <Share2 size={14} />
            Chia sẻ
          </button>

          <a
            className="gv-button"
            href={shareUrl(api.publicBase, "post", post.id)}
            target="_blank"
            rel="noreferrer"
            title="Mở liên kết công khai"
          >
            <ExternalLink size={14} />
          </a>

          {me?.uid === post.uid ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  post.kind === "review" ? onGame(post) : setEditing(!editing)
                }
              >
                <Pencil size={14} />
                Sửa
              </button>
              <button
                type="button"
                className="gv-btn-danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                Xóa
              </button>
            </>
          ) : (
            <button
              type="button"
              className="gv-icon-btn"
              title="Báo cáo bài viết"
              onClick={() =>
                me
                  ? setReportTarget({ type: "post", id: post.id })
                  : void api.signIn().catch((e) => setError(communityError(e)))
              }
            >
              <Flag size={14} />
            </button>
          )}
        </div>
      </footer>

      {commentsOpen && (
        <section className="gv-comments" aria-label="Bình luận">
          {comments.items.length === 0 ? (
            <p className="gv-muted">Chưa có bình luận nào. Hãy là người đầu tiên!</p>
          ) : (
            comments.items.map((c) => (
              <div className="gv-comment" key={c.id}>
                <div className="gv-top">
                  <div className="gv-actions" style={{ gap: 8 }}>
                    <Avatar name={c.nickname} url={c.avatarUrl} size={26} />
                    <button className="gv-link" onClick={() => onProfile(c.uid)}>
                      {c.nickname}
                    </button>
                    <span className="gv-muted" style={{ fontSize: 11 }}>
                      <Clock size={11} style={{ display: "inline", marginRight: 3 }} />
                      {formatRelativeTime(c.createdAt)}
                    </span>
                  </div>
                  <div className="gv-actions">
                    {me?.uid === c.uid && (
                      <button
                        type="button"
                        className="gv-link"
                        style={{ color: "#fda4af" }}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api.request(`/comments/${c.id}`, "DELETE");
                            await loadComments();
                            onChanged();
                          })
                        }
                      >
                        Xóa
                      </button>
                    )}
                    {me?.uid !== c.uid && (
                      <button
                        type="button"
                        className="gv-link"
                        disabled={busy}
                        onClick={() =>
                          me
                            ? setReportTarget({ type: "comment", id: c.id })
                            : void api.signIn().catch((e) => setError(communityError(e)))
                        }
                      >
                        Báo cáo
                      </button>
                    )}
                  </div>
                </div>
                <p className="gv-post-body" style={{ paddingLeft: 34 }}>
                  {c.body}
                </p>
              </div>
            ))
          )}

          {comments.hasMore && (
            <button type="button" onClick={() => void loadComments(true)}>
              Xem thêm bình luận
            </button>
          )}

          {me ? (
            <form
              className="gv-comment-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
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
              <input
                required
                maxLength={1500}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Viết bình luận của bạn..."
              />
              <button className="gv-primary" disabled={busy || !text.trim()}>
                Gửi
              </button>
            </form>
          ) : (
            <div>
              <button
                type="button"
                onClick={() =>
                  void api.signIn().catch((e) => setError(communityError(e)))
                }
              >
                Đăng nhập để bình luận
              </button>
            </div>
          )}
        </section>
      )}

      <ConfirmModal
        open={confirmDelete}
        title="Xóa bài viết"
        message="Bài viết và các ảnh đính kèm sẽ bị xóa vĩnh viễn khỏi cộng đồng."
        confirmLabel="Xóa bài"
        danger
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          void run(async () => {
            await api.request(`/posts/${post.id}`, "DELETE");
            setConfirmDelete(false);
            onChanged();
            onToast?.("Đã xóa bài viết.");
          })
        }
      />

      <ReportModal
        open={!!reportTarget}
        title={
          reportTarget?.type === "comment"
            ? "Báo cáo bình luận"
            : "Báo cáo bài viết"
        }
        busy={busy}
        onCancel={() => setReportTarget(null)}
        onSubmit={(reason) => {
          if (!reportTarget) return;
          void run(async () => {
            await api.request("/reports", "POST", {
              targetType: reportTarget.type,
              targetId: reportTarget.id,
              reason,
            });
            setReportTarget(null);
            onToast?.("Đã gửi báo cáo cho quản trị viên.");
          });
        }}
      />

      <ImageLightbox
        src={lightboxSrc}
        alt={post.title}
        onClose={() => setLightboxSrc(null)}
      />
    </article>
  );
}
