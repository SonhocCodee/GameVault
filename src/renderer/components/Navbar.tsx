import React, { useState, useRef, useEffect } from 'react';
import {
  Gamepad2,
  Search,
  SlidersHorizontal,
  Download,
  Zap,
  Plus,
  Trophy,
  Clock,
  Library,
  Activity,
  X,
  ArrowLeft,
  BookmarkPlus,
  Settings,
  Users,
  ChevronDown,
} from 'lucide-react';
import type { GameStatus, TrackerStatus } from '../../shared/types.js';
import { AuthBadge } from './AuthBadge.js';

export interface NavbarProps {
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
  onOpenImportModal: () => void;
  onOpenSyncModal: () => void;
  onOpenAddGameModal: () => void;
  onOpenWishlistModal?: () => void;
  onOpenSettingsModal?: () => void;
  onOpenCommunity?: () => void;
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
  onOpenImportModal,
  onOpenSyncModal,
  onOpenAddGameModal,
  onOpenWishlistModal,
  onOpenSettingsModal,
  onOpenCommunity,
}) => {
  const [toolsOpen, setToolsOpen] = useState<boolean>(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  const totalHours = Math.round(totalPlaytimeMinutes / 60);

  // View state resolution
  const isLibrary = currentView ? currentView === 'library' : !isDetailView;
  const isCommunity = currentView === 'community';
  const isDetail = currentView ? currentView === 'detail' : isDetailView;

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
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
        {/* Left: Brand Logo + Primary View Switcher (Thư viện vs Cộng đồng) */}
        <div className="flex items-center gap-5">
          <button
            onClick={onBackToLibrary}
            className="flex items-center gap-3 text-left group cursor-pointer"
            title="Về trang Thư viện Game"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#ff2a44] to-[#990018] shadow-md shadow-[#ff2a44]/30 transition-transform group-hover:scale-105">
              <Gamepad2 className="h-5 w-5 text-white" />
            </div>
            <div>
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
          <nav className="flex items-center rounded-lg border border-[#2a2e3d] bg-[#161821] p-1">
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
            <div className="flex items-center gap-1.5 text-xs text-[#8e95a5]">
              <span>/</span>
              <span className="font-semibold text-sky-400">Cộng đồng game thủ</span>
            </div>
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

        {/* Right Section: Compact Tools Dropdown, Add Game, Settings, Auth */}
        <div className="flex items-center gap-2">
          {/* Quick Tools Dropdown (F6 Sync, AMD Import, Steam Wishlist) */}
          <div className="relative" ref={toolsRef}>
            <button
              onClick={() => setToolsOpen(!toolsOpen)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                toolsOpen
                  ? 'border-[#ff2a44] bg-[#202433] text-white ring-1 ring-[#ff2a44]/40'
                  : 'border-[#2a2e3d] bg-[#161821] text-[#f1f3f7] hover:border-[#ff2a44] hover:bg-[#1f2230] hover:text-[#ff2a44]'
              }`}
              title="Công cụ đồng bộ ảnh F6, Import AMD và tìm game Steam"
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
                  Đồng bộ &amp; Nhập dữ liệu
                </div>

                <button
                  onClick={() => {
                    setToolsOpen(false);
                    onOpenSyncModal();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 group-hover:bg-amber-500 group-hover:text-black transition-colors">
                    <Zap className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="font-semibold text-white group-hover:text-amber-400">Đồng bộ ảnh F6</div>
                    <div className="text-[10px] text-[#8e95a5]">Quét &amp; chuyển ảnh F6 vào E:\Game</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setToolsOpen(false);
                    onOpenImportModal();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#202433] group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/10 text-rose-400 group-hover:bg-rose-500 group-hover:text-white transition-colors">
                    <Download className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="font-semibold text-white group-hover:text-rose-400">1-Click Import AMD</div>
                    <div className="text-[10px] text-[#8e95a5]">Nhập giờ chơi từ RGStats.db</div>
                  </div>
                </button>

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
                      <div className="font-semibold text-white group-hover:text-purple-400">Tìm game (Wishlist)</div>
                      <div className="text-[10px] text-[#8e95a5]">Tìm Steam &amp; thêm vào Chờ chơi</div>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Primary Action Button: Thêm game */}
          <button
            onClick={onOpenAddGameModal}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff2a44] to-[#e02424] px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-[#ff2a44]/25 transition-all hover:brightness-110 active:scale-95"
            title="Thêm trò chơi mới thủ công"
          >
            <Plus className="h-4 w-4" />
            <span>Thêm game</span>
          </button>

          {/* Settings Icon Button */}
          {onOpenSettingsModal && (
            <button
              onClick={onOpenSettingsModal}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2a2e3d] bg-[#161821] text-[#8e95a5] hover:border-[#ff2a44] hover:bg-[#1f2230] hover:text-white transition-all"
              title="Cài đặt hệ thống, phím tắt chụp màn hình và thư mục lưu trữ"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}

          {/* Google login / avatar */}
          <AuthBadge />
        </div>
      </div>

      {/* Secondary Bar: Filter Tabs, Sorter & Statistics - ONLY IN LIBRARY VIEW */}
      {isLibrary && (
        <div className="mx-auto flex max-w-7xl items-center justify-between border-t border-[#2a2e3d]/60 px-6 py-2 animate-in fade-in duration-150">
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1">
            {STATUS_TABS.map((tab) => {
              const isActive = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onStatusFilterChange(tab.id)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
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
          <div className="flex items-center gap-5 text-xs text-[#8e95a5]">
            {/* Active Process / Tracker Status */}
            <div className="hidden lg:flex items-center gap-2 border-r border-[#2a2e3d] pr-4">
              {trackerStatus?.activeGameTitle ? (
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                  </span>
                  <span>Đang chơi: <strong className="text-white">{trackerStatus.activeGameTitle}</strong></span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[#8e95a5]">
                  <Activity className="h-3.5 w-3.5 text-[#8e95a5]" />
                  <span>Zero-Impact Tracker: Sẵn sàng</span>
                </div>
              )}
            </div>

            {/* Sorter */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#8e95a5]" />
              <select
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value)}
                className="cursor-pointer rounded-md border border-[#2a2e3d] bg-[#161821] px-2.5 py-1 text-xs text-[#f1f3f7] outline-none transition-colors hover:border-[#ff2a44] focus:border-[#ff2a44]"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id} className="bg-[#161821] text-[#f1f3f7]">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Library Stats */}
            <div className="flex items-center gap-4 pl-2 font-medium">
              <div className="flex items-center gap-1.5" title="Tổng số trò chơi">
                <Library className="h-3.5 w-3.5 text-[#8e95a5]" />
                <span className="text-[#f1f3f7] font-bold">{totalGames}</span> game
              </div>
              <div className="flex items-center gap-1.5" title="Tổng thời gian chơi tích lũy">
                <Clock className="h-3.5 w-3.5 text-[#ff2a44]" />
                <span className="text-[#f1f3f7] font-bold">{totalHours}</span> giờ
              </div>
              <div className="flex items-center gap-1.5" title="Số game đã phá đảo">
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[#f1f3f7] font-bold">{completedGamesCount}</span> phá đảo
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
