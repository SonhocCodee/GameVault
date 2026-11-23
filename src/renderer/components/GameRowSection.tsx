import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import type { Game } from '../../shared/types.js';
import { GameCard } from './GameCard.js';

export type RowExpansionStage = 'carousel' | 3 | 5 | 10 | 'all';

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

const getColumnCountFromWidth = (width: number): number => {
  if (width >= 1280) return 6; // xl:grid-cols-6
  if (width >= 1024) return 5; // lg:grid-cols-5
  if (width >= 768) return 4;  // md:grid-cols-4
  if (width >= 640) return 3;  // sm:grid-cols-3
  return 2;                    // grid-cols-2
};

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
  const sectionRef = useRef<HTMLElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(false);
  const [expansionStage, setExpansionStage] = useState<RowExpansionStage>('carousel');
  const [columnsCount, setColumnsCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return getColumnCountFromWidth(window.innerWidth);
    }
    return 5;
  });

  // Calculate actual column count from rendered grid or window width
  const updateColumnsCount = useCallback(() => {
    if (gridRef.current) {
      const computed = window.getComputedStyle(gridRef.current);
      const cols = computed
        .getPropertyValue('grid-template-columns')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      if (cols > 0) {
        setColumnsCount(cols);
        return;
      }
    }
    if (typeof window !== 'undefined') {
      setColumnsCount(getColumnCountFromWidth(window.innerWidth));
    }
  }, []);

  useEffect(() => {
    updateColumnsCount();
    window.addEventListener('resize', updateColumnsCount);
    return () => window.removeEventListener('resize', updateColumnsCount);
  }, [updateColumnsCount]);

  useEffect(() => {
    if (expansionStage !== 'carousel') {
      const t = setTimeout(updateColumnsCount, 50);
      return () => clearTimeout(t);
    }
  }, [expansionStage, updateColumnsCount]);

  // Check if horizontal scroll buttons should be enabled/visible in carousel mode
  const updateScrollState = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 8);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 8);
  }, []);

  useEffect(() => {
    if (expansionStage !== 'carousel') return;
    updateScrollState();
    const el = scrollContainerRef.current;
    if (!el) return;

    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);

    const t = setTimeout(updateScrollState, 150);

    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [games, expansionStage, updateScrollState]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const scrollAmount = Math.max(container.clientWidth * 0.75, 320);
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  // Determine maximum games visible for current stage
  const maxVisibleGames = useMemo(() => {
    if (expansionStage === 'carousel' || expansionStage === 'all') {
      return games.length;
    }
    return expansionStage * columnsCount;
  }, [expansionStage, columnsCount, games.length]);

  // Sliced games list when in expanded grid mode
  const displayedGames = useMemo(() => {
    if (expansionStage === 'carousel' || expansionStage === 'all') {
      return games;
    }
    return games.slice(0, maxVisibleGames);
  }, [expansionStage, games, maxVisibleGames]);

  // Progression: 3 -> 5 -> 10 -> 'all'
  const { nextStage, hasMoreToExpand } = useMemo(() => {
    if (expansionStage === 'carousel') {
      return { nextStage: 3 as const, hasMoreToExpand: true };
    }
    if (expansionStage === 3) {
      if (games.length > 3 * columnsCount) {
        return { nextStage: 5 as const, hasMoreToExpand: true };
      }
      return { nextStage: 'carousel' as const, hasMoreToExpand: false };
    }
    if (expansionStage === 5) {
      if (games.length > 5 * columnsCount) {
        return { nextStage: 10 as const, hasMoreToExpand: true };
      }
      return { nextStage: 'carousel' as const, hasMoreToExpand: false };
    }
    if (expansionStage === 10) {
      if (games.length > 10 * columnsCount) {
        return { nextStage: 'all' as const, hasMoreToExpand: true };
      }
      return { nextStage: 'carousel' as const, hasMoreToExpand: false };
    }
    // 'all'
    return { nextStage: 'carousel' as const, hasMoreToExpand: false };
  }, [expansionStage, games.length, columnsCount]);

  const remainingGamesCount = Math.max(0, games.length - displayedGames.length);

  const nextStageLabel = useMemo(() => {
    if (nextStage === 3) return '3 hàng';
    if (nextStage === 5) return '5 hàng';
    if (nextStage === 10) return '10 hàng';
    if (nextStage === 'all') return 'Tất cả';
    return '1 hàng';
  }, [nextStage]);

  // Action: Expand to next stage (3 -> 5 -> 10 -> all -> carousel)
  const handleExpandNext = () => {
    if (expansionStage === 'carousel') {
      setExpansionStage(3);
    } else if (expansionStage === 3) {
      if (games.length > 3 * columnsCount) {
        setExpansionStage(5);
      } else {
        handleCollapse();
      }
    } else if (expansionStage === 5) {
      if (games.length > 5 * columnsCount) {
        setExpansionStage(10);
      } else {
        handleCollapse();
      }
    } else if (expansionStage === 10) {
      if (games.length > 10 * columnsCount) {
        setExpansionStage('all');
      } else {
        handleCollapse();
      }
    } else {
      handleCollapse();
    }
  };

  // Action: Direct collapse to 1 horizontal row
  const handleCollapse = () => {
    setExpansionStage('carousel');
    if (sectionRef.current) {
      const rect = sectionRef.current.getBoundingClientRect();
      if (rect.top < 0) {
        sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  if (!games || games.length === 0) {
    return null;
  }

  const isGameActive = (game: Game) => {
    if (!activeGameTitle) return false;
    return game.title.toLowerCase() === activeGameTitle.toLowerCase();
  };

  return (
    <section ref={sectionRef} className="mb-8" aria-label={title} id={id}>
      {/* Section Header */}
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
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

              {/* Expansion Status Badge */}
              {expansionStage !== 'carousel' && (
                <span className="rounded-full border border-[#ff2a44]/30 bg-[#ff2a44]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ff4d63]">
                  {expansionStage === 'all'
                    ? 'Lưới: Tất cả'
                    : `Lưới: ${expansionStage} hàng (${displayedGames.length}/${games.length})`}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-[11px] text-[#8e95a5] truncate">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Right: Controls (Expand/Collapse, Quick Pills, Carousel Nav, Filter Jump) */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
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

          {/* Quick Stage Pills when expanded */}
          {expansionStage !== 'carousel' && (
            <div className="hidden sm:flex items-center rounded-lg border border-[#2a2e3d] bg-[#161821] p-0.5">
              {([3, 5, 10, 'all'] as const).map((stage) => {
                const isActive = expansionStage === stage;
                const label = stage === 'all' ? 'Tất cả' : `${stage}h`;
                const titleText = stage === 'all' ? 'Mở tất cả' : `Mở ${stage} hàng`;
                return (
                  <button
                    key={stage}
                    onClick={() => setExpansionStage(stage)}
                    title={titleText}
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-all ${
                      isActive
                        ? 'bg-[#ff2a44] text-white shadow-sm'
                        : 'text-[#8e95a5] hover:text-white hover:bg-[#202433]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Main Expand Button */}
          {expansionStage === 'carousel' ? (
            <button
              onClick={handleExpandNext}
              className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-2.5 py-1 text-[11px] font-medium text-[#8e95a5] hover:border-[#ff2a44] hover:bg-[#ff2a44]/10 hover:text-white transition-all active:scale-95 shadow-sm"
              title="Mở rộng danh sách xuống dưới (3 hàng)"
            >
              <ChevronDown className="h-3.5 w-3.5 text-[#ff2a44]" />
              <span>Mở rộng</span>
              <span className="rounded bg-[#ff2a44]/15 px-1.5 py-0.2 text-[9px] font-bold text-[#ff4d63]">
                3 hàng
              </span>
            </button>
          ) : (
            <>
              {hasMoreToExpand && (
                <button
                  onClick={handleExpandNext}
                  className="flex items-center gap-1.5 rounded-lg border border-[#ff2a44]/50 bg-[#ff2a44]/15 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#ff2a44]/25 hover:border-[#ff2a44] transition-all active:scale-95 shadow-sm"
                  title={`Mở thêm ${nextStageLabel}`}
                >
                  <ChevronDown className="h-3.5 w-3.5 text-[#ff2a44]" />
                  <span>Mở thêm</span>
                  <span className="rounded bg-[#ff2a44]/30 px-1.5 py-0.2 text-[9px] font-bold text-white">
                    {nextStageLabel}
                  </span>
                </button>
              )}

              {/* Collapse Button */}
              <button
                onClick={handleCollapse}
                className="flex items-center gap-1 rounded-lg border border-[#2a2e3d] bg-[#161821] px-2.5 py-1 text-[11px] font-medium text-[#8e95a5] hover:border-[#ff2a44] hover:text-white transition-all active:scale-95 shadow-sm"
                title="Thu gọn về 1 hàng ngang (lướt ngang)"
              >
                <ChevronUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Thu gọn</span>
              </button>
            </>
          )}

          {/* Left / Right Carousel Navigation (only in carousel mode) */}
          {expansionStage === 'carousel' && games.length > 2 && (
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
      {expansionStage !== 'carousel' ? (
        /* Expanded Multi-row Grid */
        <div>
          <div
            ref={gridRef}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4 transition-all"
          >
            {displayedGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                isActive={isGameActive(game)}
                onSelect={onSelectGame}
                onDelete={onDeleteGame}
              />
            ))}
          </div>

          {/* Bottom Expand / Collapse Footer Bar */}
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-[#2a2e3d]/80 bg-[#161821]/70 px-4 py-2.5 backdrop-blur-sm">
            <div className="text-[12px] text-[#8e95a5] flex items-center gap-2">
              <span>
                Đang hiển thị{' '}
                <strong className="text-white font-semibold">
                  {displayedGames.length}
                </strong>{' '}
                / <strong className="text-white font-semibold">{games.length}</strong> game
              </span>
              {expansionStage !== 'all' && (
                <span className="text-[11px] text-[#8e95a5]/70">
                  • Chế độ {expansionStage} hàng
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Stage selector pills */}
              <div className="flex items-center rounded-lg border border-[#2a2e3d] bg-[#12141c] p-0.5">
                {([3, 5, 10, 'all'] as const).map((stage) => {
                  const isActive = expansionStage === stage;
                  const label = stage === 'all' ? 'Tất cả' : `${stage} hàng`;
                  return (
                    <button
                      key={stage}
                      onClick={() => setExpansionStage(stage)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-all ${
                        isActive
                          ? 'bg-[#ff2a44] text-white shadow-sm'
                          : 'text-[#8e95a5] hover:text-white hover:bg-[#202433]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Bottom Expand Button */}
              {hasMoreToExpand ? (
                <button
                  onClick={handleExpandNext}
                  className="flex items-center gap-1.5 rounded-lg border border-[#ff2a44] bg-[#ff2a44]/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#ff2a44]/25 hover:border-[#ff4d63] transition-all shadow-sm active:scale-95"
                >
                  <ChevronDown className="h-4 w-4 text-[#ff2a44]" />
                  <span>
                    Mở thêm {nextStageLabel}
                  </span>
                  <span className="text-[10px] text-[#ff8090]">
                    (+{remainingGamesCount} game)
                  </span>
                </button>
              ) : (
                <span className="text-xs text-emerald-400 font-medium px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  ✓ Đã hiển thị tất cả
                </span>
              )}

              {/* Bottom Collapse Button */}
              <button
                onClick={handleCollapse}
                className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#1a1d29] px-3 py-1.5 text-xs font-medium text-[#8e95a5] hover:border-[#ff2a44] hover:text-white transition-all active:scale-95"
                title="Thu gọn về 1 hàng ngang"
              >
                <ChevronUp className="h-4 w-4" />
                <span>Thu gọn về 1 hàng</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Single Scrollable Horizontal Row (Carousel) */
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
