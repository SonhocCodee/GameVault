import React, { useState } from "react";
import { Search } from "lucide-react";
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
      <button type="submit" aria-label="Tìm kiếm cộng đồng"><Search size={16} /></button>
    </form>
  );
}
