import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar,
  Clock,
  Trophy,
  Star,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Gamepad2,
  Camera,
  PlayCircle,
  ExternalLink,
  Flame,
  Filter,
  Layers,
  History,
} from 'lucide-react';
import type { Game, Session, MediaItem, TrackerStatus } from '../../shared/types.js';
import { formatPlaytime, getStatusMeta, formatDisplayUrl } from './GameCard.js';

export interface TimelineViewProps {
  games: Game[];
  onSelectGame: (gameId: number) => void;
  trackerStatus?: TrackerStatus | null;
  searchQuery?: string;
  statusFilter?: string;
}

export interface TimelineGameItem {
  game: Game;
  monthPlaytimeMinutes: number;
  sessionCount: number;
  lastSessionDate?: string;
  isCompletedInMonth: boolean;
}

export interface TimelineMonthGroup {
  key: string; // 'YYYY-MM'
  year: number;
  month: number; // 1-12
  monthLabel: string;
  totalMinutes: number;
  games: TimelineGameItem[];
}

export interface TimelineYearGroup {
  year: number;
  totalMinutes: number;
  uniqueGamesCount: number;
  months: TimelineMonthGroup[];
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  games,
  onSelectGame,
  trackerStatus,
  searchQuery = '',
  statusFilter = 'all',
}) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);
  const [collapsedYears, setCollapsedYears] = useState<Record<number, boolean>>({});

  // Hover Popover State
  const [hoveredData, setHoveredData] = useState<{
    item: TimelineGameItem;
    monthLabel: string;
    targetRect: DOMRect;
  } | null>(null);

  // In-memory screenshots cache: gameTitle -> MediaItem[]
  const mediaCache = useRef<Map<string, MediaItem[]>>(new Map());
  const [hoveredMedia, setHoveredMedia] = useState<MediaItem[]>([]);
  const [hoveredMediaLoading, setHoveredMediaLoading] = useState<boolean>(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch all sessions from SQLite backend
  useEffect(() => {
    let isMounted = true;
    const fetchAllSessions = async () => {
      setLoadingSessions(true);
      try {
        if (window.electronAPI?.getSessions) {
          const res = await window.electronAPI.getSessions();
          if (isMounted) {
            setSessions(res || []);
          }
        }
      } catch (err) {
        console.error('Failed to load sessions for timeline:', err);
      } finally {
        if (isMounted) {
          setLoadingSessions(false);
        }
      }
    };
    fetchAllSessions();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter games based on search and statusFilter
  const filteredGamesMap = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map<number, Game>();

    for (const game of games) {
      if (statusFilter !== 'all' && game.status !== statusFilter) {
        continue;
      }
      if (q) {
        const titleMatch = game.title.toLowerCase().includes(q);
        const notesMatch = game.notes?.toLowerCase().includes(q);
        if (!titleMatch && !notesMatch) continue;
      }
      map.set(game.id, game);
    }
    return map;
  }, [games, searchQuery, statusFilter]);

  // Aggregate Sessions & Games into Timeline Tree (Year -> Month -> Games)
  const timelineData = useMemo<TimelineYearGroup[]>(() => {
    if (filteredGamesMap.size === 0) return [];

    // Map: 'YYYY-MM' -> Map<gameId, { playtime: number, count: number, lastDate: string }>
    const monthStats = new Map<
      string,
      Map<number, { playtime: number; count: number; lastDate?: string }>
    >();

    // Set of gameIds that have at least one session recorded
    const gamesWithSessions = new Set<number>();

    // 1. Process all sessions
    for (const session of sessions) {
      if (!session.start_time) continue;
      const game = filteredGamesMap.get(session.game_id);
      if (!game) continue; // Not matching current filter

      gamesWithSessions.add(game.id);

      // Extract YYYY-MM safely
      const datePart = session.start_time.slice(0, 7); // e.g. "2026-11"
      if (!datePart || datePart.length !== 7 || !datePart.includes('-')) continue;

      if (!monthStats.has(datePart)) {
        monthStats.set(datePart, new Map());
      }
      const gMap = monthStats.get(datePart)!;
      const current = gMap.get(game.id) || { playtime: 0, count: 0 };
      current.playtime += session.duration_minutes || 0;
      current.count += 1;
      if (!current.lastDate || session.start_time > current.lastDate) {
        current.lastDate = session.start_time;
      }
      gMap.set(game.id, current);
    }

    // 2. Fallback for games without sessions (imported from AMD or added manually)
    // Place them in the month of their last_played_at, completed_at, or created_at
    for (const game of filteredGamesMap.values()) {
      if (!gamesWithSessions.has(game.id)) {
        const refDate = game.last_played_at || game.completed_at || game.created_at;
        if (!refDate) continue;
        const datePart = refDate.slice(0, 7);
        if (!datePart || datePart.length !== 7 || !datePart.includes('-')) continue;

        if (!monthStats.has(datePart)) {
          monthStats.set(datePart, new Map());
        }
        const gMap = monthStats.get(datePart)!;
        if (!gMap.has(game.id)) {
          gMap.set(game.id, {
            playtime: game.playtime_minutes || 0,
            count: 1,
            lastDate: refDate,
          });
        }
      }
    }

    // 3. Assemble Month Groups
    const monthsArray: TimelineMonthGroup[] = [];

    monthStats.forEach((gMap, monthKey) => {
      const [yearStr, monthStr] = monthKey.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);

      if (isNaN(year) || isNaN(month)) return;

      let monthTotalMinutes = 0;
      const gameItems: TimelineGameItem[] = [];

      gMap.forEach((stats, gameId) => {
        const game = filteredGamesMap.get(gameId);
        if (!game) return;

        monthTotalMinutes += stats.playtime;

        // Check if completed in this month
        let isCompletedInMonth = false;
        if (game.status === 'completed') {
          if (game.completed_at && game.completed_at.startsWith(monthKey)) {
            isCompletedInMonth = true;
          } else if (game.last_played_at && game.last_played_at.startsWith(monthKey)) {
            isCompletedInMonth = true;
          }
        }

        gameItems.push({
          game,
          monthPlaytimeMinutes: stats.playtime,
          sessionCount: stats.count,
          lastSessionDate: stats.lastDate,
          isCompletedInMonth,
        });
      });

      // Sort games within this month: Highest playtime first
      gameItems.sort((a, b) => {
        if (b.monthPlaytimeMinutes !== a.monthPlaytimeMinutes) {
          return b.monthPlaytimeMinutes - a.monthPlaytimeMinutes;
        }
        return b.game.playtime_minutes - a.game.playtime_minutes;
      });

      if (gameItems.length > 0) {
        monthsArray.push({
          key: monthKey,
          year,
          month,
          monthLabel: `Tháng ${month.toString().padStart(2, '0')}`,
          totalMinutes: monthTotalMinutes,
          games: gameItems,
        });
      }
    });

    // 4. Assemble Year Groups
    const yearMap = new Map<number, TimelineMonthGroup[]>();
    for (const m of monthsArray) {
      if (!yearMap.has(m.year)) {
        yearMap.set(m.year, []);
      }
      yearMap.get(m.year)!.push(m);
    }

    const yearGroups: TimelineYearGroup[] = [];
    yearMap.forEach((months, year) => {
      // Sort months descending: Tháng 12 -> Tháng 1
      months.sort((a, b) => b.month - a.month);

      const totalMinutes = months.reduce((acc, m) => acc + m.totalMinutes, 0);
      const uniqueGameIds = new Set(months.flatMap((m) => m.games.map((g) => g.game.id)));

      yearGroups.push({
        year,
        totalMinutes,
        uniqueGamesCount: uniqueGameIds.size,
        months,
      });
    });

    // Sort years descending: 2026 -> 2025 -> 2024...
    yearGroups.sort((a, b) => b.year - a.year);

    return yearGroups;
  }, [filteredGamesMap, sessions]);

  // Load screenshots for hovered game
  const handleMouseEnterCard = (
    e: React.MouseEvent<HTMLDivElement>,
    item: TimelineGameItem,
    monthLabel: string
  ) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    const targetRect = e.currentTarget.getBoundingClientRect();
    setHoveredData({ item, monthLabel, targetRect });

    // Check media cache
    const gameTitle = item.game.title;
    if (mediaCache.current.has(gameTitle)) {
      setHoveredMedia(mediaCache.current.get(gameTitle)!);
      setHoveredMediaLoading(false);
    } else {
      setHoveredMedia([]);
      setHoveredMediaLoading(true);
      if (window.electronAPI?.getGameMedia) {
        window.electronAPI
          .getGameMedia(gameTitle)
          .then((items) => {
            const images = (items || []).filter((i) => i.type === 'image');
            mediaCache.current.set(gameTitle, images);
            setHoveredMedia(images);
          })
          .catch(() => {
            mediaCache.current.set(gameTitle, []);
            setHoveredMedia([]);
          })
          .finally(() => {
            setHoveredMediaLoading(false);
          });
      } else {
        setHoveredMediaLoading(false);
      }
    }
  };

  const handleMouseLeaveCard = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredData(null);
    }, 120);
  };

  const toggleYearCollapse = (year: number) => {
    setCollapsedYears((prev) => ({
      ...prev,
      [year]: !prev[year],
    }));
  };

  return (
    <div className="relative pb-24 animate-in fade-in duration-200">
      {/* Timeline Header Info */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#2a2e3d] bg-gradient-to-r from-[#161821] via-[#1a1e2c] to-[#161821] p-5 shadow-lg">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#990018] shadow-md shadow-[#ff2a44]/25">
            <History className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Dòng thời gian chơi game</h2>
              <span className="rounded-full border border-[#ff2a44]/40 bg-[#ff2a44]/15 px-2.5 py-0.5 text-[10px] font-bold text-[#ff2a44]">
                Timeline Tree
              </span>
            </div>
            <p className="text-xs text-[#8e95a5]">
              Hành trình trải nghiệm các tựa game qua từng tháng của từng năm
            </p>
          </div>
        </div>

        {/* Quick Year Jump Bar */}
        {timelineData.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[#8e95a5] mr-1">Nhảy đến năm:</span>
            {timelineData.map((yg) => (
              <a
                key={yg.year}
                href={`#year-${yg.year}`}
                className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-1 text-xs font-bold text-[#f1f3f7] hover:border-[#ff2a44] hover:bg-[#ff2a44]/15 hover:text-[#ff2a44] transition-all"
              >
                {yg.year}
              </a>
            ))}
          </div>
        )}
      </div>

      {loadingSessions ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#ff2a44] border-t-transparent" />
          <p className="text-xs text-[#8e95a5]">Đang tập hợp dữ liệu thời gian chơi...</p>
        </div>
      ) : timelineData.length === 0 ? (
        /* Empty State */
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-3xl border border-dashed border-[#2a2e3d] bg-[#161821]/40 p-12 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2a2e3d] bg-[#161821] text-[#8e95a5]">
            <Gamepad2 className="h-7 w-7 text-[#ff2a44]" />
          </div>
          <h3 className="text-base font-bold text-white">Chưa có dữ liệu dòng thời gian</h3>
          <p className="mt-1.5 max-w-md text-xs text-[#8e95a5]">
            Không tìm thấy dữ liệu phiên chơi nào phù hợp với bộ lọc hiện tại. Hãy chơi game hoặc nhập lịch sử từ AMD để hiển thị mốc thời gian.
          </p>
        </div>
      ) : (
        /* The Vertical Tree / Column Spine */
        <div className="relative pl-6 md:pl-10 space-y-12">
          {/* Vertical Glowing Line (The Spine) */}
          <div className="pointer-events-none absolute left-3 md:left-5 top-4 bottom-4 w-0.5 bg-gradient-to-b from-[#ff2a44] via-[#ff2a44]/50 to-[#2a2e3d]" />

          {timelineData.map((yearGroup) => {
            const isCollapsed = !!collapsedYears[yearGroup.year];
            const yearHours = Math.round(yearGroup.totalMinutes / 60);

            return (
              <section
                key={yearGroup.year}
                id={`year-${yearGroup.year}`}
                className="relative scroll-mt-28"
              >
                {/* Year Header Node (Pinned on the Spine) */}
                <div className="relative flex items-center gap-3">
                  {/* Spine Node Dot for Year */}
                  <div className="absolute -left-6 md:-left-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#ff2a44] bg-[#0e1015] shadow-[0_0_15px_rgba(255,42,68,0.6)] z-10">
                    <div className="h-2 w-2 rounded-full bg-[#ff2a44]" />
                  </div>

                  {/* Year Title & Stats Button */}
                  <button
                    onClick={() => toggleYearCollapse(yearGroup.year)}
                    className="group flex items-center gap-3.5 rounded-2xl border border-[#2a2e3d] bg-[#161821] px-4 py-2.5 text-left transition-all hover:border-[#ff2a44] hover:bg-[#1a1e2c]"
                  >
                    <span className="text-xl font-black tracking-wide text-white group-hover:text-[#ff2a44] transition-colors">
                      NĂM {yearGroup.year}
                    </span>
                    <div className="flex items-center gap-2 border-l border-[#2a2e3d] pl-3 text-xs text-[#8e95a5]">
                      <span className="font-semibold text-[#f1f3f7]">
                        {yearGroup.uniqueGamesCount} game
                      </span>
                      <span>•</span>
                      <span className="font-bold text-amber-400">
                        {yearHours} giờ chơi
                      </span>
                    </div>
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-[#8e95a5] transition-transform group-hover:text-white" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-[#8e95a5] transition-transform group-hover:text-white" />
                    )}
                  </button>
                </div>

                {/* Months under this year */}
                {!isCollapsed && (
                  <div className="mt-8 space-y-9 pl-2 md:pl-4">
                    {yearGroup.months.map((monthGroup) => {
                      const monthHours = Math.round((monthGroup.totalMinutes / 60) * 10) / 10;

                      return (
                        <div key={monthGroup.key} className="relative">
                          {/* Branch Connector from spine to month node */}
                          <div className="absolute -left-8 md:-left-12 top-4 w-6 md:w-10 h-0.5 bg-gradient-to-r from-[#ff2a44]/70 to-[#2a2e3d]" />

                          {/* Month Node Dot on spine */}
                          <div className="absolute -left-9 md:-left-13 top-2.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#ff2a44] bg-[#0e1015] shadow-sm z-10">
                            <div className="h-1.5 w-1.5 rounded-full bg-[#ff2a44]" />
                          </div>

                          {/* Month Header Banner */}
                          <div className="mb-4 flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2 rounded-xl border border-[#2a2e3d] bg-[#161821]/80 px-3 py-1.5 backdrop-blur-sm">
                              <Calendar className="h-3.5 w-3.5 text-[#ff2a44]" />
                              <h3 className="text-sm font-bold text-white">
                                {monthGroup.monthLabel} / {monthGroup.year}
                              </h3>
                            </div>

                            <div className="flex items-center gap-2 text-xs text-[#8e95a5]">
                              <span className="rounded-md bg-[#202433] px-2 py-0.5 font-medium text-[#f1f3f7]">
                                {monthGroup.games.length} trò chơi
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1 font-bold text-emerald-400">
                                <Clock className="h-3 w-3" />
                                {formatPlaytime(monthGroup.totalMinutes)}
                              </span>
                            </div>
                          </div>

                          {/* Games Grid in this Month */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-3.5">
                            {monthGroup.games.map((item) => {
                              const isActive = trackerStatus?.activeGameTitle
                                ? item.game.title.toLowerCase() ===
                                  trackerStatus.activeGameTitle.toLowerCase()
                                : false;

                              const coverUrl = formatDisplayUrl(item.game.cover_url, {
                                thumb: true,
                                width: 280,
                              });

                              return (
                                <div
                                  key={`${monthGroup.key}-${item.game.id}`}
                                  onClick={() => onSelectGame(item.game.id)}
                                  onMouseEnter={(e) =>
                                    handleMouseEnterCard(e, item, monthGroup.monthLabel)
                                  }
                                  onMouseLeave={handleMouseLeaveCard}
                                  className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-[#161821] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/60 ${
                                    isActive
                                      ? 'border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.35)] ring-2 ring-emerald-500/70'
                                      : 'border-[#2a2e3d] hover:border-[#ff2a44]'
                                  }`}
                                >
                                  {/* 2:3 Vertical Thumbnail Poster */}
                                  <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#0e1015]">
                                    {coverUrl ? (
                                      <img
                                        src={coverUrl}
                                        alt={item.game.title}
                                        loading="lazy"
                                        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full flex-col items-center justify-center p-3 text-center bg-gradient-to-br from-[#161821] to-[#0e1015]">
                                        <Gamepad2 className="h-7 w-7 text-[#ff2a44]/50 mb-1" />
                                        <p className="line-clamp-2 text-[11px] font-bold text-[#f1f3f7]">
                                          {item.game.title}
                                        </p>
                                      </div>
                                    )}

                                    {/* Monthly Playtime Badge (Top-left) */}
                                    <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 shadow-sm backdrop-blur-md">
                                      <Clock className="h-2.5 w-2.5" />
                                      <span>{formatPlaytime(item.monthPlaytimeMinutes)}</span>
                                    </div>

                                    {/* Completed Badge (Top-right) */}
                                    {item.isCompletedInMonth && (
                                      <div
                                        className="absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border border-amber-400/50 bg-amber-950/80 text-amber-300 shadow-sm backdrop-blur-md"
                                        title="Đã phá đảo trong tháng này"
                                      >
                                        <Trophy className="h-3 w-3" />
                                      </div>
                                    )}

                                    {/* Gradient overlay at bottom */}
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#161821] via-[#161821]/70 to-transparent" />
                                  </div>

                                  {/* Title below cover */}
                                  <div className="p-2">
                                    <p
                                      className="truncate text-xs font-semibold text-white group-hover:text-[#ff2a44] transition-colors"
                                      title={item.game.title}
                                    >
                                      {item.game.title}
                                    </p>
                                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-[#8e95a5]">
                                      <span>
                                        {item.sessionCount > 0
                                          ? `${item.sessionCount} phiên`
                                          : 'Tổng cộng'}
                                      </span>
                                      {item.game.user_rating && (
                                        <span className="flex items-center gap-0.5 font-bold text-amber-400">
                                          <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                                          {item.game.user_rating}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Floating Hover Preview Card (Portal-style with Fixed Position) */}
      {hoveredData && (
        <div
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          }}
          onMouseLeave={handleMouseLeaveCard}
          style={{
            position: 'fixed',
            zIndex: 60,
            width: '340px',
            ...getSmartPopoverPosition(hoveredData.targetRect),
          }}
          className="pointer-events-auto rounded-2xl border border-[#2a2e3d] bg-[#161822]/95 p-4 shadow-2xl shadow-black/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header Banner */}
          <div className="relative -mx-4 -mt-4 mb-3 h-28 overflow-hidden rounded-t-2xl bg-[#0e1015]">
            {hoveredData.item.game.banner_url || hoveredData.item.game.cover_url ? (
              <img
                src={formatDisplayUrl(
                  hoveredData.item.game.banner_url || hoveredData.item.game.cover_url,
                  { thumb: true, width: 450 }
                )}
                alt={hoveredData.item.game.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#161821] to-[#ff2a44]/20">
                <Gamepad2 className="h-10 w-10 text-white/30" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#161822] via-[#161822]/40 to-transparent" />

            {/* Status pill on header */}
            <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  getStatusMeta(hoveredData.item.game.status).colorClass
                }`}
              >
                {getStatusMeta(hoveredData.item.game.status).label}
              </span>
              {hoveredData.item.game.user_rating && (
                <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-black/60 px-2 py-0.5 text-[10px] font-bold text-amber-400 backdrop-blur-sm">
                  <Star className="h-3 w-3 fill-amber-400" />
                  {hoveredData.item.game.user_rating}/10
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <h4 className="text-sm font-bold text-white line-clamp-1" title={hoveredData.item.game.title}>
            {hoveredData.item.game.title}
          </h4>

          {/* Playtime Metrics */}
          <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-xl border border-[#2a2e3d]/80 bg-[#12141c] p-2.5">
            <div>
              <p className="text-[10px] font-medium text-[#8e95a5]">
                Trong {hoveredData.monthLabel}
              </p>
              <p className="flex items-center gap-1 text-xs font-bold text-emerald-400 mt-0.5">
                <Clock className="h-3 w-3" />
                {formatPlaytime(hoveredData.item.monthPlaytimeMinutes)}
              </p>
            </div>
            <div className="border-l border-[#2a2e3d] pl-2.5">
              <p className="text-[10px] font-medium text-[#8e95a5]">Tổng tích lũy</p>
              <p className="flex items-center gap-1 text-xs font-bold text-white mt-0.5">
                <Sparkles className="h-3 w-3 text-amber-400" />
                {formatPlaytime(hoveredData.item.game.playtime_minutes)}
              </p>
            </div>
          </div>

          {/* Screenshots Gallery Strip (1 vài ảnh game) */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8e95a5]">
                <Camera className="h-3 w-3 text-[#ff2a44]" />
                Ảnh chụp trong game (F6)
              </span>
              {hoveredMedia.length > 0 && (
                <span className="text-[10px] text-[#8e95a5]">{hoveredMedia.length} ảnh</span>
              )}
            </div>

            {hoveredMediaLoading ? (
              <div className="flex h-16 items-center justify-center rounded-lg border border-[#2a2e3d] bg-[#0e1015]/60">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#ff2a44] border-t-transparent" />
              </div>
            ) : hoveredMedia.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5">
                {hoveredMedia.slice(0, 3).map((media, idx) => (
                  <div
                    key={media.path || idx}
                    className="relative aspect-video overflow-hidden rounded-lg border border-[#2a2e3d] bg-[#0e1015]"
                  >
                    <img
                      src={formatDisplayUrl(media.url, { thumb: true, width: 200 })}
                      alt={`screenshot ${idx}`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 hover:scale-110"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#2a2e3d] bg-[#0e1015]/40 py-2.5 px-3 text-center">
                <p className="text-[10px] text-[#8e95a5]">
                  Chưa có ảnh chụp F6 nào cho game này
                </p>
              </div>
            )}
          </div>

          {/* Action Button */}
          <button
            onClick={() => onSelectGame(hoveredData.item.game.id)}
            className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ff2a44] to-[#e02424] py-2 text-xs font-bold text-white shadow-md shadow-[#ff2a44]/20 hover:brightness-110 transition-all cursor-pointer"
          >
            <span>Mở trang chi tiết game</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Calculates smart fixed coordinates for hover popover to avoid overflowing viewport.
 */
function getSmartPopoverPosition(rect: DOMRect): React.CSSProperties {
  const POPOVER_WIDTH = 340;
  const POPOVER_HEIGHT = 380;
  const PADDING = 12;

  let left = rect.right + PADDING;
  // If overflows right side of viewport, show on the left
  if (left + POPOVER_WIDTH > window.innerWidth - PADDING) {
    left = rect.left - POPOVER_WIDTH - PADDING;
  }
  // Clamp left
  left = Math.max(PADDING, Math.min(left, window.innerWidth - POPOVER_WIDTH - PADDING));

  // Align vertically near the card top, clamped within window bounds
  let top = rect.top - 20;
  if (top + POPOVER_HEIGHT > window.innerHeight - PADDING) {
    top = window.innerHeight - POPOVER_HEIGHT - PADDING;
  }
  top = Math.max(PADDING + 60, top); // Leave room for navbar

  return {
    top: `${top}px`,
    left: `${left}px`,
  };
}
