import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Columns3,
  ExternalLink,
} from 'lucide-react';
import type { Game } from '../../shared/types.js';
import { GameCard } from './GameCard.js';

export interface GameRowSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  badgeLabel?: string;
  badgeColorClass?: string;
  games: Game[];
  activeGameTitle?: string | null;
  onSelectGame: (gameId: number) => void;
  onDeleteGame?: (gameId: number, gameTitle: string) => void;
  onFilterToThisStatus?: () => void;
}

export const GameRowSection: React.FC<GameRowSectionProps> = ({
  id,
  title,
  subtitle,
  icon,
  badgeLabel,
  badgeColorClass = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  games,
  activeGameTitle,
  onSelectGame,
  onDeleteGame,
  onFilterToThisStatus,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(false);
  const [isGridMode, setIsGridMode] = useState<boolean>(false);

  // Check if scroll buttons should be enabled/visible
  const updateScrollState = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 8);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 8);
  }, []);

  useEffect(() => {
    if (isGridMode) return;
    updateScrollState();
    const el = scrollContainerRef.current;
    if (!el) return;

    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);

    // Initial check after layout render
    const t = setTimeout(updateScrollState, 150);

    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [games, isGridMode, updateScrollState]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    // Scroll approximately 3 cards width or 75% of view
    const scrollAmount = Math.max(container.clientWidth * 0.75, 320);
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (!games || games.length === 0) {
    return null;
  }

  const isGameActive = (game: Game) => {
    if (!activeGameTitle) return false;
    return game.title.toLowerCase() === activeGameTitle.toLowerCase();
  };

  return (
    <section className="mb-8" aria-label={title}>
      {/* Section Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* Left: Icon, Title, Badge & Subtitle */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2a2e3d] bg-[#161821]">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-white tracking-wide truncate">
                {title}
              </h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeColorClass}`}
              >
                {games.length} game
              </span>
              {badgeLabel && (
                <span className="hidden sm:inline-block text-[11px] text-[#8e95a5]">
                  • {badgeLabel}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-[11px] text-[#8e95a5] truncate">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Right: Controls (Scroll Left/Right, Grid Mode Toggle, Filter Jump) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Filter Shortcut */}
          {onFilterToThisStatus && (
            <button
              onClick={onFilterToThisStatus}
              className="hidden md:flex items-center gap-1 rounded-lg border border-[#2a2e3d] bg-[#161821] px-2.5 py-1 text-[11px] font-medium text-[#8e95a5] hover:border-[#ff2a44] hover:text-white transition-colors"
              title="Lọc chỉ riêng mục này"
            >
              <span>Xem bộ lọc</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          )}

          {/* Grid Mode Toggle (Lưới vs 1 Hàng) */}
          <button
            onClick={() => setIsGridMode(!isGridMode)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              isGridMode
                ? 'border-[#ff2a44] bg-[#ff2a44]/15 text-[#ff2a44]'
                : 'border-[#2a2e3d] bg-[#161821] text-[#8e95a5] hover:border-[#ff2a44] hover:text-white'
            }`}
            title={isGridMode ? 'Thu gọn về 1 hàng ngang' : 'Mở rộng hiển thị dạng lưới'}
          >
            {isGridMode ? (
              <>
                <Columns3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">1 hàng</span>
              </>
            ) : (
              <>
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Lưới</span>
              </>
            )}
          </button>

          {/* Left / Right Carousel Navigation (only in 1-row mode) */}
          {!isGridMode && games.length > 2 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleScroll('left')}
                disabled={!canScrollLeft}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#2a2e3d] bg-[#161821] text-[#f1f3f7] transition-all hover:border-[#ff2a44] hover:bg-[#1f2230] disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                title="Lướt sang trái"
                aria-label="Lướt sang trái"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleScroll('right')}
                disabled={!canScrollRight}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#2a2e3d] bg-[#161821] text-[#f1f3f7] transition-all hover:border-[#ff2a44] hover:bg-[#1f2230] disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                title="Lướt sang phải"
                aria-label="Lướt sang phải"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Row / Grid Content */}
      {isGridMode ? (
        /* Expanded Multi-row Grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              isActive={isGameActive(game)}
              onSelect={onSelectGame}
              onDelete={onDeleteGame}
            />
          ))}
        </div>
      ) : (
        /* Single Scrollable Horizontal Row */
        <div className="relative group/carousel">
          <div
            ref={scrollContainerRef}
            className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-3 pt-1 px-1 scroll-smooth"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#2a2e3d transparent',
            }}
          >
            {games.map((game) => (
              <div
                key={game.id}
                className="w-[150px] sm:w-[170px] md:w-[190px] shrink-0"
              >
                <GameCard
                  game={game}
                  isActive={isGameActive(game)}
                  onSelect={onSelectGame}
                  onDelete={onDeleteGame}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
