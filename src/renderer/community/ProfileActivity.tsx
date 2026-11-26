import React, { useEffect, useRef, useState } from "react";
import type { CommentHistory, CommunityAdapter, CommunityPost, Page, PublicGame, PublicProfile } from "../../shared/community.ts";
import { communityError } from "./client.ts";
import { PostCard } from "./PostCard.tsx";

const empty = <T,>(): Page<T> => ({ items: [], hasMore: false, nextOffset: 0 });

export function ProfileActivity({ api, me, onGame, onProfile, onPost }: {
  api: CommunityAdapter;
  me: PublicProfile;
  onGame: (game: PublicGame) => void;
  onProfile: (uid: string) => void;
  onPost: (id: string) => void;
}) {
  const [kind, setKind] = useState<"posts" | "comments">("posts");
  const [posts, setPosts] = useState<Page<CommunityPost>>(empty);
  const [comments, setComments] = useState<Page<CommentHistory>>(empty);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = async (more = false) => {
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      if (kind === "posts") {
        const next = await api.request<Page<CommunityPost>>(`/posts?uid=${encodeURIComponent(me.uid)}&offset=${more ? posts.nextOffset : 0}`);
        if (ticket !== sequence.current) return;
        setPosts(previous => more ? { ...next, items: [...previous.items, ...next.items] } : next);
      } else {
        const next = await api.request<Page<CommentHistory>>(`/me/comments?offset=${more ? comments.nextOffset : 0}`);
        if (ticket !== sequence.current) return;
        setComments(previous => more ? { ...next, items: [...previous.items, ...next.items] } : next);
      }
    } catch (e) {
      if (ticket === sequence.current) setError(communityError(e));
    } finally {
      if (ticket === sequence.current) setBusy(false);
    }
  };
  useEffect(() => {
    setPosts(empty());
    setComments(empty());
    void load();
    return () => { sequence.current++; };
  }, [api, me.uid, kind]);
  const current = kind === "posts" ? posts : comments;
  return (
    <section aria-label="Lịch sử hoạt động" className="gv-activity">
      <div className="gv-top">
        <h2>Lịch sử hoạt động</h2>
        <button disabled={busy} onClick={() => void load()}>Làm mới lịch sử</button>
      </div>
      <div className="gv-actions" aria-label="Loại hoạt động">
        <button aria-pressed={kind === "posts"} onClick={() => setKind("posts")}>Bài đã đăng</button>
        <button aria-pressed={kind === "comments"} onClick={() => setKind("comments")}>Bình luận của tôi</button>
      </div>
      {error && <p className="gv-error" role="alert">{error} <button disabled={busy} onClick={() => void load()}>Thử lại</button></p>}
      {busy && <p className="gv-muted" role="status">Đang tải lịch sử…</p>}
      {!busy && !error && !current.items.length && <p className="gv-empty">{kind === "posts" ? "Bạn chưa đăng bài viết nào." : "Bạn chưa có bình luận nào."}</p>}
      {kind === "posts" ? posts.items.map(post => (
        <PostCard key={post.id} post={post} api={api} me={me} onChanged={() => void load()} onGame={onGame} onProfile={onProfile} />
      )) : comments.items.map(comment => (
        <article key={comment.id} className="gv-activity-comment">
          <div className="gv-post-meta">
            <strong>{comment.gameTitle}</strong>
            <time className="gv-muted" dateTime={comment.createdAt.replace(" ", "T") + "Z"}>{new Date(comment.createdAt.replace(" ", "T") + "Z").toLocaleString("vi-VN")}</time>
          </div>
          {comment.spoiler ? <details><summary>Bình luận trong bài có spoiler — xem nội dung</summary><p className="gv-activity-body">{comment.body}</p></details> : <p className="gv-activity-body">{comment.body}</p>}
          <button className="gv-link" onClick={() => onPost(comment.postId)}>Xem bài viết gốc</button>
        </article>
      ))}
      {current.hasMore && <button className="gv-pager" disabled={busy} onClick={() => void load(true)}>Xem thêm {kind === "posts" ? "bài viết" : "bình luận"}</button>}
    </section>
  );
}
