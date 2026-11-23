import React, { useState } from 'react';
import { Star, Clock, Trophy, PlayCircle, PauseCircle, XCircle, BookmarkCheck, Gamepad2, FolderOpen, Trash2 } from 'lucide-react';
import type { Game, GameStatus } from '../../shared/types.js';

export interface GameCardProps {
  game: Game;
  onSelect: (gameId: number) => void;
  onDelete?: (gameId: number, gameTitle: string) => void;
  isActive?: boolean;
}

export const formatPlaytime = (minutes: number): string => {
  if (!minutes || minutes <= 0) return '0 phút';
  const hours = Math.floor(minutes / 60);
  const remainingMins = Math.round(minutes % 60);
  if (hours === 0) return `${remainingMins}m`;
  if (remainingMins === 0) return `${hours}h`;
  return `${hours}h ${remainingMins}m`;
};

export const getStatusMeta = (status: GameStatus): { label: string; colorClass: string; icon: React.ReactNode } => {
  switch (status) {
    case 'playing':
      return {
        label: 'Đang chơi',
        colorClass: 'bg-emerald-600/95 text-white border-emerald-400/60 shadow-emerald-950/70',
        icon: <PlayCircle className="h-3 w-3 fill-white/20 text-white shrink-0" />,
      };
    case 'completed':
      return {
        label: 'Đã phá đảo',
        colorClass: 'bg-amber-600/95 text-white border-amber-300/60 shadow-amber-950/70',
        icon: <Trophy className="h-3 w-3 fill-white/20 text-white shrink-0" />,
      };
    case 'backlog':
      return {
        label: 'Chờ chơi',
        colorClass: 'bg-purple-600/95 text-white border-purple-300/60 shadow-purple-950/70',
        icon: <BookmarkCheck className="h-3 w-3 fill-white/20 text-white shrink-0" />,
      };
    case 'paused':
      return {
        label: 'Tạm dừng',
        colorClass: 'bg-blue-600/95 text-white border-blue-300/60 shadow-blue-950/70',
        icon: <PauseCircle className="h-3 w-3 fill-white/20 text-white shrink-0" />,
      };
    case 'dropped':
      return {
        label: 'Bỏ dở',
        colorClass: 'bg-rose-600/95 text-white border-rose-300/60 shadow-rose-950/70',
        icon: <XCircle className="h-3 w-3 fill-white/20 text-white shrink-0" />,
      };
    default:
      return {
        label: 'Chưa chơi',
        colorClass: 'bg-slate-700/95 text-white border-slate-500/60 shadow-slate-950/70',
        icon: <Clock className="h-3 w-3 text-white shrink-0" />,
      };
  }
};

export const formatDisplayUrl = (
  url?: string | null,
  options?: { thumb?: boolean; width?: number }
): string | undefined => {
  if (!url) return undefined;
  let finalUrl = url;
  if (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('game-media://') &&
    !url.startsWith('data:')
  ) {
    const normalized = url.replace(/\\/g, '/');
    finalUrl = `game-media://local/${encodeURIComponent(normalized)}`;
  }

  if (options?.thumb && finalUrl.startsWith('game-media://')) {
    const w = options.width || 400;
    const separator = finalUrl.includes('?') ? '&' : '?';
    return `${finalUrl}${separator}thumb=1&w=${w}`;
  }

  return finalUrl;
};

export const GameCard: React.FC<GameCardProps> = ({ game, onSelect, onDelete, isActive }) => {
  const [imageError, setImageError] = useState(false);
  const statusMeta = getStatusMeta(game.status);
  const coverSrc = formatDisplayUrl(game.cover_url, { thumb: true, width: 400 });

  return (
    <div
      onClick={() => onSelect(game.id)}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-[#161821] transition-all duration-300 hover:-translate-y-1.5 ${
        isActive
          ? 'border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.4)] ring-2 ring-emerald-500/70'
          : 'border-[#2a2e3d] hover:border-[#ff2a44] hover:shadow-[0_10px_30px_rgba(255,42,68,0.25)]'
      }`}
    >
      {/* 2:3 Vertical Poster Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#0e1015]">
        {coverSrc && !imageError ? (
          <img
            src={coverSrc}
            alt={game.title}
            loading="lazy"
            decoding="async"
            onError={() => setImageError(true)}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          /* Stylish Fallback Placeholder */
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#161821] via-[#1a1e2c] to-[#0e1015] p-6 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff2a44]/10 border border-[#ff2a44]/30 shadow-inner">
              <Gamepad2 className="h-8 w-8 text-[#ff2a44]" />
            </div>
            <p className="line-clamp-3 text-sm font-bold text-[#f1f3f7]">{game.title}</p>
          </div>
        )}

        {/* Top Dark Gradient Vignette for Maximum Badge Readability */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/80 via-black/35 to-transparent z-10" />

        {/* Top Floating Badges: Status & Score */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-1 p-2">
          {/* Status Badge */}
          <div className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shadow-md backdrop-blur-md whitespace-nowrap shrink-0 ${statusMeta.colorClass}`}
            >
              {statusMeta.icon}
              <span className="tracking-wide drop-shadow-sm whitespace-nowrap">{statusMeta.label}</span>
            </div>

            {isActive && (
              <div className="flex items-center gap-1 rounded-full border border-emerald-400/80 bg-emerald-500/95 px-1.5 py-0.5 text-[9px] font-black text-white shadow-md shadow-emerald-950/70 backdrop-blur-md animate-pulse whitespace-nowrap shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-white"></span>
                <span>CHẠY</span>
              </div>
            )}
          </div>

          {/* Score Badge (only show when actually rated > 0) */}
          {game.user_rating !== null && game.user_rating !== undefined && Number(game.user_rating) > 0 && (
            <div className="flex items-center gap-0.5 rounded-full border border-amber-400/60 bg-[#0e1015]/95 px-1.5 py-0.5 text-[10px] font-black text-amber-300 shadow-md shadow-black/80 backdrop-blur-md whitespace-nowrap shrink-0">
              <Star className="h-2.5 w-2.5 fill-amber-300 text-amber-300 shrink-0" />
              <span className="whitespace-nowrap">{Number(game.user_rating).toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Bottom Gradient Overlay & Info */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0e1015] via-[#0e1015]/90 via-50% to-transparent p-2.5 pt-10 transition-all">
          <h3
            className="line-clamp-2 text-xs sm:text-[13px] font-bold leading-tight text-[#f1f3f7] transition-colors group-hover:text-[#ff2a44] min-h-[2rem]"
            title={game.title}
          >
            {game.title}
          </h3>

          <div className="mt-1.5 flex items-center justify-between gap-1 text-[11px]">
            {/* Playtime */}
            <div className="flex items-center gap-1 font-mono text-[11px] font-semibold text-[#f1f3f7] whitespace-nowrap shrink-0">
              <Clock className="h-3 w-3 text-[#ff2a44] shrink-0" />
              <span className="whitespace-nowrap">{formatPlaytime(game.playtime_minutes)}</span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Quick Open Media Folder Button — wishlist games have no folder yet */}
              {game.status !== 'backlog' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.electronAPI?.openMediaFolder) {
                      window.electronAPI.openMediaFolder(game.title);
                    }
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0e1015]/90 text-[#8e95a5] border border-[#2a2e3d] transition-all hover:border-[#ff2a44] hover:bg-[#ff2a44]/20 hover:text-white"
                  title={`Mở thư mục ảnh: E:\\Game\\${game.title}`}
                >
                  <FolderOpen className="h-3 w-3" />
                </button>
              )}

              {/* Quick Delete Button */}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(game.id, game.title);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0e1015]/90 text-[#8e95a5] border border-[#2a2e3d] transition-all hover:border-rose-500 hover:bg-rose-500/20 hover:text-rose-400"
                  title={`Xóa game: ${game.title}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
