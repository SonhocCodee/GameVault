import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, MessageSquareText, RefreshCw, Star } from "lucide-react";
import type {
  CommentHistory,
  CommunityAdapter,
  CommunityPost,
  Page,
  PublicGame,
  PublicProfile,
} from "../../shared/community.ts";
import { communityError, formatRelativeTime } from "./client.ts";
import { PostCard } from "./PostCard.tsx";

const empty = <T,>(): Page<T> => ({ items: [], hasMore: false, nextOffset: 0 });

export function ProfileActivity({
  api,
  me,
  onGame,
  onProfile,
  onPost,
  onToast,
}: {
  api: CommunityAdapter;
  me: PublicProfile;
  onGame: (game: PublicGame) => void;
  onProfile: (uid: string) => void;
  onPost: (id: string) => void;
  onToast?: (msg: string) => void;
}) {
  const [kind, setKind] = useState<"posts" | "reviews" | "comments">("posts");
  const [posts, setPosts] = useState<Page<CommunityPost>>(empty);
  const [reviews, setReviews] = useState<Page<CommunityPost>>(empty);
  const [comments, setComments] = useState<Page<CommentHistory>>(empty);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const loaded = useRef<Record<typeof kind, boolean>>({
    posts: false,
    reviews: false,
    comments: false,
  });
  const source = useRef({ api, uid: me.uid });

  const load = async (more = false) => {
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      if (kind === "posts") {
        const next = await api.request<Page<CommunityPost>>(
          `/posts?uid=${encodeURIComponent(me.uid)}&excludeKind=review&offset=${more ? posts.nextOffset : 0}`,
        );
        if (ticket !== sequence.current) return;
        loaded.current.posts = true;
        setPosts((previous) =>
          more ? { ...next, items: [...previous.items, ...next.items] } : next,
        );
      } else if (kind === "reviews") {
        const next = await api.request<Page<CommunityPost>>(
          `/posts?uid=${encodeURIComponent(me.uid)}&kind=review&offset=${more ? reviews.nextOffset : 0}`,
        );
        if (ticket !== sequence.current) return;
        loaded.current.reviews = true;
        setReviews((previous) =>
          more ? { ...next, items: [...previous.items, ...next.items] } : next,
        );
      } else {
        const next = await api.request<Page<CommentHistory>>(
          `/me/comments?offset=${more ? comments.nextOffset : 0}`,
        );
        if (ticket !== sequence.current) return;
        loaded.current.comments = true;
        setComments((previous) =>
          more ? { ...next, items: [...previous.items, ...next.items] } : next,
        );
      }
    } catch (e) {
      if (ticket === sequence.current) setError(communityError(e));
    } finally {
      if (ticket === sequence.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (source.current.api !== api || source.current.uid !== me.uid) {
      source.current = { api, uid: me.uid };
      loaded.current = { posts: false, reviews: false, comments: false };
      setPosts(empty());
      setReviews(empty());
      setComments(empty());
    }
    if (loaded.current[kind]) {
      setBusy(false);
      setError("");
      return () => {
        sequence.current++;
      };
    }
    void load();
    return () => {
      sequence.current++;
    };
  }, [api, me.uid, kind]);

  const current = kind === "posts" ? posts : kind === "reviews" ? reviews : comments;

  return (
    <section aria-label="Lịch sử hoạt động" className="gv-stack">
      <div className="gv-top">
        <h2>Lịch sử hoạt động</h2>
        <button type="button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} />
          Làm mới
        </button>
      </div>

      <div className="gv-chip-row" aria-label="Loại hoạt động">
        <button
          type="button"
          className={`gv-chip ${kind === "posts" ? "active" : ""}`}
          aria-pressed={kind === "posts"}
          onClick={() => setKind("posts")}
        >
          <MessageSquareText size={13} />
          Bài đã đăng
        </button>
        <button
          type="button"
          className={`gv-chip ${kind === "reviews" ? "active" : ""}`}
          aria-pressed={kind === "reviews"}
          onClick={() => setKind("reviews")}
        >
          <Star size={13} />
          Đánh giá của tôi
        </button>
        <button
          type="button"
          className={`gv-chip ${kind === "comments" ? "active" : ""}`}
          aria-pressed={kind === "comments"}
          onClick={() => setKind("comments")}
        >
          <MessageCircle size={13} />
          Bình luận của tôi
        </button>
      </div>

      <div className="gv-profile-activity-content" aria-busy={busy}>
        {error && (
          <p className="gv-error" role="alert">
            {error}{" "}
            <button disabled={busy} onClick={() => void load()}>
              Thử lại
            </button>
          </p>
        )}
        {busy && !current.items.length && (
          <div className="gv-empty">
            <p role="status">
              {kind === "reviews"
                ? "Đang tải đánh giá…"
                : kind === "comments"
                  ? "Đang tải bình luận…"
                  : "Đang tải bài viết…"}
            </p>
          </div>
        )}
        {!busy && !error && !current.items.length && (
          <div className="gv-empty">
            <p>
              {kind === "posts"
                ? "Bạn chưa đăng bài viết nào."
                : kind === "reviews"
                  ? "Bạn chưa có đánh giá nào."
                  : "Bạn chưa có bình luận nào."}
            </p>
          </div>
        )}

        {(kind === "posts" || kind === "reviews") &&
          (kind === "posts" ? posts.items : reviews.items).map((post) => (
            <PostCard
              key={post.id}
              post={post}
              api={api}
              me={me}
              hideSave
              onChanged={() => void load()}
              onGame={onGame}
              onProfile={onProfile}
              onToast={onToast}
            />
          ))}

        {kind === "comments" &&
          comments.items.map((comment) => (
            <article key={comment.id} className="gv-card-subtle gv-stack-sm">
              <div className="gv-top">
                <strong>{comment.gameTitle}</strong>
                <span className="gv-muted">
                  {formatRelativeTime(comment.createdAt)}
                </span>
              </div>
              <p className="gv-post-body">
                {comment.spoiler
                  ? "(Bình luận thuộc bài viết có spoiler) "
                  : ""}
                {comment.body}
              </p>
              <div>
                <button
                  type="button"
                  className="gv-link"
                  onClick={() => onPost(comment.postId)}
                >
                  Xem bài viết gốc
                </button>
              </div>
            </article>
          ))}

        {current.hasMore && (
          <button
            type="button"
            className="gv-pager"
            disabled={busy}
            onClick={() => void load(true)}
          >
            Xem thêm {kind === "posts" ? "bài viết" : kind === "reviews" ? "đánh giá" : "bình luận"}
          </button>
        )}
      </div>
    </section>
  );
}
