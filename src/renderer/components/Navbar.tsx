import React, { useState, useRef, useEffect } from 'react';
import {
  Gamepad2,
  Search,
  SlidersHorizontal,
  Zap,
  Plus,
  Trophy,
  Clock,
  Library,
  X,
  ArrowLeft,
  BookmarkPlus,
  Users,
  ChevronDown,
  LayoutGrid,
  GitCommitVertical,
  RefreshCw,
  Loader2,
  Sparkles,
  FolderSync,
  Bug,
} from 'lucide-react';
import type { AuthStatus, GameStatus, TrackerStatus } from '../../shared/types.js';
import { AuthBadge } from './AuthBadge.js';
import { CommunitySearch } from '../community/CommunitySearch.tsx';
import type { CommunitySearchRequest } from '../../shared/community.ts';

export interface NavbarProps {
  onCommunitySearch?: (request: CommunitySearchRequest) => void;
  onAuthChanged?: (status: AuthStatus) => void;
  currentView?: 'library' | 'detail' | 'community';
  isDetailView?: boolean;
  selectedGameTitle?: string;
  onBackToLibrary?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  totalGames: number;
  totalPlaytimeMinutes: number;
  completedGamesCount: number;
  trackerStatus?: TrackerStatus | null;
  onOpenSyncModal: (tab?: 'library' | 'drive_media' | 'local_f6') => void;
  onOpenAddGameModal: () => void;
  onOpenWishlistModal?: () => void;
  onOpenSettingsModal?: () => void;
  onOpenAdminModal?: () => void;
  onOpenBugAndUpdateModal?: (tab?: 'bugs' | 'updates') => void;
  hasUpdateBadge?: boolean;
  onOpenCommunity?: () => void;
  onOpenProfile?: () => void;
  onEnrichCovers?: () => void | Promise<void>;
  onScanLocalGames?: () => void | Promise<void>;
  scanningLocalGames?: boolean;
  libraryLayout?: 'grid' | 'timeline';
  onLibraryLayoutChange?: (layout: 'grid' | 'timeline') => void;
}

const STATUS_TABS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'playing', label: 'Đang chơi' },
  { id: 'completed', label: 'Đã phá đảo' },
  { id: 'backlog', label: 'Chờ chơi' },
  { id: 'paused', label: 'Tạm dừng' },
  { id: 'dropped', label: 'Bỏ dở' },
];

const SORT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'playtime_desc', label: 'Thời gian chơi nhiều nhất' },
  { id: 'rating_desc', label: 'Điểm đánh giá cao nhất' },
  { id: 'recent_played', label: 'Mới chơi gần đây' },
  { id: 'title_asc', label: 'Tên game (A - Z)' },
];

export const Navbar: React.FC<NavbarProps> = ({
  onCommunitySearch,
  onAuthChanged,
  currentView,
  isDetailView = false,
  selectedGameTitle,
  onBackToLibrary,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortChange,
  totalGames,
  totalPlaytimeMinutes,
  completedGamesCount,
  trackerStatus,
  onOpenSyncModal,
  onOpenAddGameModal,
  onOpenWishlistModal,
  onOpenSettingsModal,
  onOpenAdminModal,
  onOpenBugAndUpdateModal,
  hasUpdateBadge = false,
  onOpenCommunity,
  onOpenProfile,
  onEnrichCovers,
  onScanLocalGames,
  scanningLocalGames = false,
  libraryLayout = 'grid',
  onLibraryLayoutChange,
}) => {
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  const totalHours = Math.round(totalPlaytimeMinutes / 60);

  // View state resolution
  const isLibrary = currentView ? currentView === 'library' : !isDetailView;
  const isCommunity = currentView === 'community';
  const isDetail = currentView ? currentView === 'detail' : isDetailView;

  const [isSyncingMedia, setIsSyncingMedia] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const checkSyncStatus = () => {
      window.electronAPI?.getActiveMediaSyncStatus?.().then((status) => {
        if (isMounted) {
          setIsSyncingMedia(!!status?.isRunning);
        }
      }).catch(() => {});
    };

    checkSyncStatus();
    const interval = setInterval(checkSyncStatus, 2500);

    const unsub = window.electronAPI?.onDriveMediaProgress?.((p) => {
      if (isMounted) {
        setIsSyncingMedia(p.percent < 100);
      }
    });

    return () => {
      isMounted = false;
      clearInterval(interval);
      unsub?.();
    };
  }, []);

  // Click outside listener for Tools dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    if (toolsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [toolsOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-[#2a2e3d] bg-[#0e1015]/95 backdrop-blur-md">
      {/* Top Main Navigation Row */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
        {/* Left: Brand Logo + Primary View Switcher (Thư viện vs Cộng đồng) */}
          <div className="flex shrink-0 items-center gap-5">
          <button
            onClick={onBackToLibrary}
            className="flex items-center gap-3 text-left group cursor-pointer"
            title="Về trang Thư viện Game"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#990018] shadow-md shadow-[#ff2a44]/30 transition-transform group-hover:scale-105">
              <Gamepad2 className="h-5 w-5 text-white" />
            </div>
              <div className="hidden xl:block">
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-black tracking-wider text-white">GAMEVAULT</span>
                <span className="rounded bg-[#ff2a44]/20 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-[#ff2a44] border border-[#ff2a44]/30">
                  PRO
                </span>
              </div>
              <p className="text-[10px] font-medium text-[#8e95a5]">
                Permanent Playtime &amp; Media
              </p>
            </div>
          </button>

          {/* Primary View Switcher Tabs: Thư viện vs Cộng đồng */}
            <nav className="flex items-center whitespace-nowrap rounded-lg border border-[#2a2e3d] bg-[#161821] p-1">
            <button
              onClick={onBackToLibrary}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                isLibrary
                  ? 'bg-[#ff2a44] text-white shadow-sm shadow-[#ff2a44]/30'
                  : 'text-[#8e95a5] hover:bg-[#202433] hover:text-[#f1f3f7]'
              }`}
            >
              <Library className="h-3.5 w-3.5" />
              <span>Thư viện</span>
            </button>

            {onOpenCommunity && (
              <button
                onClick={onOpenCommunity}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                  isCommunity
                    ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                    : 'text-[#8e95a5] hover:bg-[#202433] hover:text-[#f1f3f7]'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Cộng đồng</span>
              </button>
            )}
          </nav>
        </div>

        {/* Center: Search Bar OR Detail/Community Breadcrumb */}
        {isDetail ? (
          <div className="flex items-center gap-3 flex-1 max-w-md">
            {onBackToLibrary && (
              <button
                onClick={onBackToLibrary}
                className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs font-bold text-white transition-all hover:border-[#ff2a44] hover:bg-[#ff2a44]/15 hover:text-[#ff2a44]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Quay lại Thư viện</span>
              </button>
            )}
            {selectedGameTitle && (
              <div className="flex items-center gap-1.5 text-xs text-[#8e95a5] truncate">
                <span>/</span>
                <span className="font-semibold text-white truncate">{selectedGameTitle}</span>
              </div>
            )}
          </div>
        ) : isCommunity ? (
            <div className="min-w-0 flex-1 basis-72">
              <CommunitySearch onSearch={(request) => onCommunitySearch?.(request)} />
          </div>
        ) : (
          <div className="relative flex-1 max-w-md">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#8e95a5]">
              <Search className="h-4 w-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm game trong thư viện hoặc trên Steam..."
              className="w-full rounded-lg border border-[#2a2e3d] bg-[#161821] py-2 pl-10 pr-9 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none transition-all focus:border-[#ff2a44] focus:ring-1 focus:ring-[#ff2a44]"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#8e95a5] hover:text-white"
                title="Xóa tìm kiếm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Right Section: Prominent Sync Button, Compact Tools Dropdown, Add Game, Settings, Auth */}
        <div className="flex items-center gap-2 shrink-0">
            {!isCommunity && <>
          {/* Direct Prominent Sync Button */}
          <button
            onClick={() => onOpenSyncModal('library')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all shadow-sm active:scale-95 shrink-0 whitespace-nowrap ${
              isSyncingMedia
                ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300 animate-pulse'
                : 'border-sky-500/40 bg-sky-500/10 text-sky-400 hover:border-sky-400 hover:bg-sky-500/20 hover:text-white'
            }`}
            title="Mở Trung tâm Đồng bộ (Cloud D1 & Google Drive)"
          >
            {isSyncingMedia ? (
              <>
                <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
                <span>Đang đồng bộ...</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
                <span>Đồng bộ</span>
              </>
            )}
          </button>

          {/* Quick Tools Dropdown (F6 Sync, Steam Wishlist) */}
          <div className="relative shrink-0" ref={toolsRef}>
            <button
              onClick={() => setToolsOpen(!toolsOpen)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all shrink-0 whitespace-nowrap ${
                toolsOpen
                  ? 'border-[#ff2a44] bg-[#202433] text-white ring-1 ring-[#ff2a44]/40'
                  : 'border-[#2a2e3d] bg-[#161821] text-[#f1f3f7] hover:border-[#ff2a44] hover:bg-[#1f2230] hover:text-[#ff2a44]'
              }`}
              title="Công cụ đồng bộ ảnh F6 và tìm game Steam"
            >
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span>Công cụ</span>
              <ChevronDown
                className={`h-3 w-3 text-[#8e95a5] transition-transform duration-150 ${
                  toolsOpen ? 'rotate-180 text-white' : ''
                }`}
              />
            </button>

            {/* Dropdown Menu */}
            {toolsOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[#2a2e3d] bg-[#161822] p-1.5 shadow-2xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8e95a5] border-b border-[#2a2e3d]/60 mb-1">
                  Đồng bộ &amp; Tiện ích
                </div>

                <button
                  onClick={() => {
                    setToolsOpen(false);
                    onOpenSyncModal('library');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/10 text-sky-400 group-hover:bg-sky-500 group-hover:text-black transition-colors">
                    <Zap className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="font-semibold text-white group-hover:text-sky-400">Trung tâm Đồng bộ</div>
                    <div className="text-[10px] text-[#8e95a5]">Đồng bộ Thư viện Cloud, Drive Media &amp; F6</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setToolsOpen(false);
                    onOpenSyncModal('local_f6');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 group-hover:bg-amber-500 group-hover:text-black transition-colors">
                    <FolderSync className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="font-semibold text-white group-hover:text-amber-400">Gom ảnh (C: ➔ E: &amp; G:)</div>
                    <div className="text-[10px] text-[#8e95a5]">Cut ảnh sang HDD E &amp; đẩy lên Google Drive</div>
                  </div>
                </button>

                {onScanLocalGames && (
                  <button
                    disabled={scanningLocalGames}
                    onClick={async () => {
                      setToolsOpen(false);
                      await onScanLocalGames();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] disabled:opacity-50 group"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/10 text-[#ff2a44] group-hover:bg-[#ff2a44] group-hover:text-white transition-colors">
                      {scanningLocalGames ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Gamepad2 className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-white group-hover:text-[#ff2a44]">
                        {scanningLocalGames ? 'Đang quét game trên máy...' : 'Quét game trên máy'}
                      </div>
                      <div className="text-[10px] text-[#8e95a5]">Steam, Epic, GOG, Riot, Xbox &amp; GPU</div>
                    </div>
                  </button>
                )}

                {onEnrichCovers && (
                  <button
                    onClick={async () => {
                      setToolsOpen(false);
                      await onEnrichCovers();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] group"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 group-hover:bg-amber-500 group-hover:text-black transition-colors">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="font-semibold text-white group-hover:text-amber-400">Tìm nạp ảnh bìa (Enrich)</div>
                      <div className="text-[10px] text-[#8e95a5]">Tự động tải ảnh game còn thiếu</div>
                    </div>
                  </button>
                )}

                {onOpenWishlistModal && (
                  <button
                    onClick={() => {
                      setToolsOpen(false);
                      onOpenWishlistModal();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] group"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-purple-500/10 text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                      <BookmarkPlus className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="font-semibold text-white group-hover:text-purple-400">Thêm game từ Steam</div>
                      <div className="text-[10px] text-[#8e95a5]">Thêm game chờ chơi hoặc đã phá đảo</div>
                    </div>
                  </button>
                )}

                {onOpenBugAndUpdateModal && (
                  <button
                    onClick={() => {
                      setToolsOpen(false);
                      onOpenBugAndUpdateModal('updates');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] group"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-black transition-colors">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="font-semibold text-white group-hover:text-emerald-400">Cập nhật &amp; Đã fix gì</div>
                      <div className="text-[10px] text-[#8e95a5]">Xem nhật ký bản mới &amp; kiểm tra update</div>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Bug Report & Changelog Quick Button */}
          {onOpenBugAndUpdateModal && (
            <button
              onClick={() => onOpenBugAndUpdateModal('bugs')}
              className="relative flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-2.5 py-2 text-xs font-semibold text-[#f1f3f7] transition-all hover:border-[#ff2a44] hover:bg-[#1f2230] hover:text-[#ff2a44] shrink-0 whitespace-nowrap"
              title="Báo lỗi (Bug) & Xem nhật ký cập nhật"
            >
              <Bug className="h-3.5 w-3.5 text-[#ff2a44]" />
              <span className="hidden md:inline">Báo lỗi</span>
              {hasUpdateBadge && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0e1015]" />
              )}
            </button>
          )}

          {/* Primary Action Button: Thêm game */}
          <button
            onClick={onOpenAddGameModal}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff2a44] to-[#e02424] px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-[#ff2a44]/25 transition-all hover:brightness-110 active:scale-95 shrink-0 whitespace-nowrap"
            title="Thêm trò chơi mới thủ công"
          >
            <Plus className="h-4 w-4" />
            <span>Thêm game</span>
          </button>

            </>}

          {/* Google login / avatar */}
          <div className="shrink-0">
              <AuthBadge onOpenSettingsModal={onOpenSettingsModal} onOpenAdminModal={onOpenAdminModal} onChanged={onAuthChanged} onOpenProfile={onOpenProfile} />
          </div>
        </div>
      </div>

      {/* Secondary Bar: Filter Tabs, Sorter & Statistics - ONLY IN LIBRARY VIEW */}
      {isLibrary && (
        <div className="border-t border-[#2a2e3d]/60 bg-[#0e1015]/40 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2 overflow-x-auto no-scrollbar animate-in fade-in duration-150 min-w-0">
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 shrink-0">
              {STATUS_TABS.map((tab) => {
                const isActive = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onStatusFilterChange(tab.id)}
                    className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-[#ff2a44] text-white shadow-sm shadow-[#ff2a44]/30'
                        : 'text-[#8e95a5] hover:bg-[#161821] hover:text-[#f1f3f7]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Right Section: Sort dropdown & Live Stats */}
            <div className="flex items-center gap-2.5 text-xs text-[#8e95a5] shrink-0">
              {/* Active Process / Tracker Status */}
              {trackerStatus?.activeGameTitle && (
                <div
                  className="hidden xl:flex items-center gap-1.5 border-r border-[#2a2e3d] pr-3 shrink-0 whitespace-nowrap font-medium text-emerald-400"
                  title={`Đang chơi: ${trackerStatus.activeGameTitle}`}
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                  </span>
                  <span className="truncate max-w-[120px] 2xl:max-w-[180px]">
                    Đang chơi:{' '}
                    <strong className="text-white font-semibold">
                      {trackerStatus.activeGameTitle}
                    </strong>
                  </span>
                </div>
              )}

              {/* View Mode Switcher: Grid vs Timeline Tree */}
              {onLibraryLayoutChange && (
                <div className="flex items-center rounded-lg border border-[#2a2e3d] bg-[#161821] p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onLibraryLayoutChange('grid')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all shrink-0 whitespace-nowrap ${
                      libraryLayout === 'grid'
                        ? 'bg-[#ff2a44] text-white shadow-sm shadow-[#ff2a44]/30'
                        : 'text-[#8e95a5] hover:bg-[#202433] hover:text-[#f1f3f7]'
                    }`}
                    title="Chế độ xem dạng thẻ / danh mục"
                  >
                    <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden xl:inline whitespace-nowrap">Dạng thẻ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onLibraryLayoutChange('timeline')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all shrink-0 whitespace-nowrap ${
                      libraryLayout === 'timeline'
                        ? 'bg-[#ff2a44] text-white shadow-sm shadow-[#ff2a44]/30'
                        : 'text-[#8e95a5] hover:bg-[#202433] hover:text-[#f1f3f7]'
                    }`}
                    title="Chế độ xem dòng thời gian theo từng tháng/năm"
                  >
                    <GitCommitVertical className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden xl:inline whitespace-nowrap">Dòng thời gian</span>
                  </button>
                </div>
              )}

              {/* Sorter */}
              <div className="flex items-center gap-2 shrink-0">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#8e95a5] shrink-0" />
                <div className="relative shrink-0">
                  <select
                    value={sortBy}
                    onChange={(e) => onSortChange(e.target.value)}
                    className="cursor-pointer appearance-none rounded-md border border-[#2a2e3d] bg-[#161821] py-1 pl-2.5 pr-7 text-xs text-[#f1f3f7] outline-none transition-colors hover:border-[#ff2a44] focus:border-[#ff2a44] shrink-0 whitespace-nowrap"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} className="bg-[#161821] text-[#f1f3f7]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#8e95a5]"
                  />
                </div>
              </div>

              {/* Library Stats */}
              <div className="hidden lg:flex items-center gap-3 pl-2.5 font-medium shrink-0 whitespace-nowrap border-l border-[#2a2e3d]/60">
                <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap" title={`Tổng số trò chơi: ${totalGames} game`}>
                  <Library className="h-3.5 w-3.5 text-[#8e95a5] shrink-0" />
                  <span className="text-[#f1f3f7] font-bold">{totalGames}</span>
                  <span className="hidden xl:inline text-[#8e95a5]">game</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap" title={`Tổng thời gian chơi tích lũy: ${totalHours} giờ`}>
                  <Clock className="h-3.5 w-3.5 text-[#ff2a44] shrink-0" />
                  <span className="text-[#f1f3f7] font-bold">{totalHours}</span>
                  <span className="hidden xl:inline text-[#8e95a5]">giờ</span>
                  <span className="xl:hidden text-[#8e95a5]">h</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap" title={`Số game đã phá đảo: ${completedGamesCount} game`}>
                  <Trophy className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span className="text-[#f1f3f7] font-bold">{completedGamesCount}</span>
                  <span className="hidden xl:inline text-[#8e95a5]">phá đảo</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
