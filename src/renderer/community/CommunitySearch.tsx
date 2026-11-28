import React, { useState } from "react";
import { Search, X } from "lucide-react";
import type { CommunitySearchRequest } from "../../shared/community.ts";

export function CommunitySearch({ onSearch }: { onSearch: (request: CommunitySearchRequest) => void }) {
  const [scope, setScope] = useState<"posts" | "players">("posts");
  const [query, setQuery] = useState("");
  return (
    <form className="community-search" role="search" onSubmit={(event) => {
      event.preventDefault();
      onSearch({ scope, query: query.trim(), sequence: Date.now() });
    }}>
      <select aria-label="Loại tìm kiếm cộng đồng" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
        <option value="posts">Bài viết theo game</option>
        <option value="players">Người chơi</option>
      </select>
      <input aria-label={scope === "posts" ? "Tìm bài viết theo tên game" : "Tìm người chơi"} value={query} maxLength={100}
        onChange={(event) => setQuery(event.target.value)} placeholder={scope === "posts" ? "Nhập tên game…" : "Nhập biệt danh…"} />
      {query && (
        <button
          type="button"
          className="community-search-clear"
          aria-label="Xóa từ khóa tìm kiếm"
          onClick={() => {
            setQuery("");
            onSearch({ scope, query: "", sequence: Date.now() });
          }}
        >
          <X size={14} />
        </button>
      )}
      <button type="submit" className="community-search-submit" aria-label="Tìm kiếm cộng đồng">
        <Search size={15} />
      </button>
    </form>
  );
}
