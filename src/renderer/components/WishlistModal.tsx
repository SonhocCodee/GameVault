import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, BookmarkPlus, AlertCircle, Gamepad2, CheckCircle2, Trophy } from 'lucide-react';
import type { WishlistSearchResult } from '../../shared/types.js';
import { AddGameDetailsModal, type PendingAddGame } from './AddGameDetailsModal.js';

export interface WishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a game was successfully added so the library can refresh. */
  onAdded?: (gameTitle: string) => void;
  /** Optional: open the newly added game's detail view. */
  onOpenGame?: (gameId: number) => void;
}

type AddStatus = 'backlog' | 'completed';

// Steam CDN asset fallbacks — walk down the capsule chain before hiding
// (all on the verified-working Fastly CDN)
const steamImgFallbacks = (appId: number): string[] => [
  `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
  `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`,
  `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_sm_120.jpg`,
];

const handleSteamImgError = (e: React.SyntheticEvent<HTMLImageElement>, appId: number) => {
  const img = e.currentTarget;
  const step = Number(img.dataset.fbStep || '0');
  const fallbacks = steamImgFallbacks(appId);
  if (step + 1 < fallbacks.length) {
    img.dataset.fbStep = String(step + 1);
    img.src = fallbacks[step + 1];
  } else {
    img.style.visibility = 'hidden';
  }
};

/**
 * Search the live Steam catalogue and add the picked game as a wishlist
 * or self-declared completed entry. Wishlist games carry only cover &
 * banner URLs — no E:\Game media folder is created until the game actually
 * runs and GameVault auto-promotes it to 'Đang chơi'.
 */
export const WishlistModal: React.FC<WishlistModalProps> = ({ isOpen, onClose, onAdded, onOpenGame }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WishlistSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Record<number, AddStatus>>({});
  const [lastAdded, setLastAdded] = useState<{ title: string; status: AddStatus } | null>(null);
  const [pendingAdd, setPendingAdd] = useState<PendingAddGame | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);

  const runSearch = async (q: string, requestId: number) => {
    const clean = q.trim();
    try {
      if (window.electronAPI?.searchWishlistGames) {
        const found = await window.electronAPI.searchWishlistGames(clean);
        if (requestId !== searchRequestRef.current) return;
        setResults(found || []);
        setSearched(true);
      }
    } catch (err) {
      if (requestId !== searchRequestRef.current) return;
      console.error('Wishlist search failed:', err);
      setResults([]);
      setSearched(true);
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false);
    }
  };

  // Debounced live search while typing
  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    if (!isOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResults([]);
    setSearched(false);
    setAddError(null);
    if (query.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      runSearch(query, requestId);
    }, 450);
    return () => {
      ++searchRequestRef.current;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen]);

  // Reset state when the modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSearched(false);
      setAddError(null);
      setAddingId(null);
      setAddedIds({});
      setLastAdded(null);
      setPendingAdd(null);
      setPendingError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Clicking an add button first opens the rating/review prompt; the actual
  // add happens when the user confirms in AddGameDetailsModal.
  const handlePick = (result: WishlistSearchResult, status: AddStatus) => {
    setPendingAdd({ appId: result.appId, name: result.name, status });
    setPendingError(null);
  };

  const handleConfirmAdd = async (rating: number | null, notes: string) => {
    if (!pendingAdd || !window.electronAPI?.addWishlistGame) return;
    const result = results.find((r) => r.appId === pendingAdd.appId) || {
      appId: pendingAdd.appId,
      name: pendingAdd.name,
      headerUrl: '',
    };
    setAddingId(pendingAdd.appId);
    setPendingError(null);
    try {
      const created = await window.electronAPI.addWishlistGame({
        title: pendingAdd.name,
        steamId: pendingAdd.appId,
        status: pendingAdd.status,
        user_rating: rating,
        notes,
      });
      setAddedIds((prev) => ({ ...prev, [pendingAdd.appId]: pendingAdd.status }));
      setLastAdded({ title: pendingAdd.name, status: pendingAdd.status });
      setPendingAdd(null);
      onAdded?.(result.name);
      // Briefly show success on the row, then close and jump to the new game
      setTimeout(() => {
        onOpenGame?.(created.id);
      }, 700);
    } catch (err: any) {
      setPendingError(err?.message || 'Không thể thêm game vào thư viện');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[#2a2e3d] bg-[#161821] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] px-6 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-white">
            <BookmarkPlus className="h-5 w-5 text-purple-400" />
            <span>Thêm game từ Steam</span>
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#8e95a5] hover:text-white"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="space-y-3 border-b border-[#2a2e3d] px-6 py-4">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#8e95a5]">
              <Search className="h-4 w-4" />
            </div>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm game trên Steam... (VD: Elden Ring, Hades II)"
              className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] py-2.5 pl-10 pr-9 text-sm text-white placeholder-[#8e95a5] outline-none transition-all focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
            />
            {searching && (
              <Loader2 className="absolute inset-y-0 right-3 my-auto h-4 w-4 animate-spin text-purple-400" />
            )}
          </div>
          <p className="text-[10px] text-[#8e95a5]">
            Thêm game muốn chơi hoặc đã phá đảo trước khi dùng GameVault. Game chưa cài vẫn thêm được vào thư viện.
          </p>
        </div>

        {/* Results */}
        <div className="min-h-[200px] flex-1 overflow-y-auto px-6 py-4">
          {addError && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{addError}</span>
            </div>
          )}

          {lastAdded && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Đã thêm "{lastAdded.title}"
                {lastAdded.status === 'completed'
                  ? ' với trạng thái Đã phá đảo 🏆'
                  : ' vào Chờ chơi (Wishlist) — ảnh bìa & banner đã được tải'}
                .
              </span>
            </div>
          )}

          {query.trim().length < 2 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-purple-400/30 bg-purple-400/10">
                <BookmarkPlus className="h-7 w-7 text-purple-400" />
              </div>
              <p className="text-sm font-bold text-white">Tìm game chờ chơi hoặc đã phá đảo</p>
              <p className="mt-1 max-w-sm text-xs text-[#8e95a5]">
                Nhập ít nhất 2 ký tự — kết quả lấy trực tiếp từ Steam.
              </p>
            </div>
          ) : searching && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-purple-400" />
              <p className="mt-2 text-xs text-[#8e95a5]">Đang tìm kiếm trên Steam...</p>
            </div>
          ) : searched && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2a2e3d] bg-[#0e1015]">
                <Gamepad2 className="h-7 w-7 text-[#8e95a5]" />
              </div>
              <p className="text-sm font-bold text-white">Không tìm thấy game nào</p>
              <p className="mt-1 text-xs text-[#8e95a5]">Thử từ khóa khác hoặc kiểm tra chính tả.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((r) => {
                const added = addedIds[r.appId];
                const isAdding = addingId === r.appId;
                return (
                  <div
                    key={r.appId}
                    className="flex items-center gap-3 rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-2.5 transition-all hover:border-purple-400/50"
                  >
                    <img
                      src={r.headerUrl}
                      alt={r.name}
                      loading="lazy"
                      className="h-[52px] w-[93px] shrink-0 rounded-md border border-[#2a2e3d] object-cover"
                      onError={(e) => handleSteamImgError(e, r.appId)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white" title={r.name}>
                        {r.name}
                      </p>
                      <p className="text-[10px] text-[#8e95a5]">Steam AppID: {r.appId}</p>
                    </div>
                    {added ? (
                      <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-3 py-2 text-xs font-bold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{added === 'completed' ? 'Đã phá đảo' : 'Đã thêm'}</span>
                      </span>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => handlePick(r, 'completed')}
                          disabled={isAdding}
                          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff2a44] to-[#e02424] px-3 py-2 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-60"
                          title="Đã chơi game này (máy khác) — thêm vào thư viện với trạng thái Đã phá đảo"
                        >
                          <Trophy className="h-3.5 w-3.5" />
                          <span>Đã phá đảo</span>
                        </button>
                        <button
                          onClick={() => handlePick(r, 'backlog')}
                          disabled={isAdding}
                          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-60"
                        >
                          {isAdding ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <BookmarkPlus className="h-3.5 w-3.5" />
                          )}
                          <span>Chờ chơi</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

        {/* Rating/review prompt before the actual add */}
        <AddGameDetailsModal
          pending={pendingAdd}
          busy={addingId !== null}
          error={pendingError}
          onClose={() => setPendingAdd(null)}
          onConfirm={handleConfirmAdd}
        />
    </div>
  );
};
