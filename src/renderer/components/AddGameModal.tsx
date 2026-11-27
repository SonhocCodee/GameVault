import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  CheckCircle2,
  FolderOpen,
  Gamepad2,
  Loader2,
  PauseCircle,
  Plus,
  Search,
  Sparkles,
  Star,
  Trophy,
  X,
  XCircle,
} from 'lucide-react';
import type { Game, GameStatus, WishlistSearchResult } from '../../shared/types.js';

export interface AddGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (game: Game) => void;
}

const STEAM_HEADER_CDN_BASE = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps';

const steamImgFallbacks = (appId: number): string[] => [
  `${STEAM_HEADER_CDN_BASE}/${appId}/header.jpg`,
  `${STEAM_HEADER_CDN_BASE}/${appId}/capsule_231x87.jpg`,
  `${STEAM_HEADER_CDN_BASE}/${appId}/capsule_sm_120.jpg`,
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
 * Modal thêm game vào thư viện ('Đang chơi'):
 * - Tìm kiếm trực tiếp qua Steam API khi gõ tên game để lấy đúng tên, AppID và ảnh bìa/banner.
 * - Hỗ trợ chọn file .exe trên máy để tự động đọc PE VersionInfo / steam_appid và nhận diện đúng game.
 * - Vẫn hỗ trợ thêm thủ công (game ngoài Steam) nếu không chọn kết quả từ Steam.
 */
export const AddGameModal: React.FC<AddGameModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [exeName, setExeName] = useState('');
  const [exePath, setExePath] = useState<string | null>(null);
  const [exeDetectedNote, setExeDetectedNote] = useState<string | null>(null);
  const [status, setStatus] = useState<GameStatus>('playing');
  const [userRating, setUserRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [selectedSteam, setSelectedSteam] = useState<WishlistSearchResult | null>(null);
  const [steamResults, setSteamResults] = useState<WishlistSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [browsingExe, setBrowsingExe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestRef = useRef(0);

  // Reset all state cleanly whenever modal opens/closes
  useEffect(() => {
    ++searchRequestRef.current;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (isOpen) {
      setTitle('');
      setExeName('');
      setExePath(null);
      setExeDetectedNote(null);
      setStatus('playing');
      setUserRating(null);
      setNotes('');
      setSelectedSteam(null);
      setSteamResults([]);
      setSearching(false);
      setSearched(false);
      setBrowsingExe(false);
      setSubmitting(false);
      setError(null);

      // Defer focus slightly to avoid Chromium Windows modal focus lock
      const focusTimer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 20);
      return () => clearTimeout(focusTimer);
    }
  }, [isOpen]);

  // Debounced live Steam search as user types
  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!isOpen) return;

    // Skip search while a Steam entry is already locked in
    if (selectedSteam) {
      setSearching(false);
      return;
    }

    const clean = title.trim();
    if (clean.length < 2) {
      setSteamResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }

    if (!window.electronAPI?.searchWishlistGames) {
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await window.electronAPI.searchWishlistGames!(clean);
        if (requestId !== searchRequestRef.current) return;
        setSteamResults(found || []);
        setSearched(true);
      } catch {
        if (requestId !== searchRequestRef.current) return;
        setSteamResults([]);
        setSearched(true);
      } finally {
        if (requestId === searchRequestRef.current) {
          setSearching(false);
        }
      }
    }, 150);

    return () => {
      ++searchRequestRef.current;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [title, isOpen, selectedSteam]);

  if (!isOpen) return null;

  const handlePickSteam = (item: WishlistSearchResult) => {
    setSelectedSteam(item);
    setTitle(item.name);
    setSteamResults([]);
    setSearched(false);
    setError(null);
  };

  const handleClearSteam = () => {
    setSelectedSteam(null);
    setSteamResults([]);
    setSearched(false);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const handleBrowseExe = async () => {
    if (!window.electronAPI?.browseGameExe || browsingExe || submitting) return;
    setBrowsingExe(true);
    setError(null);
    try {
      const res = await window.electronAPI.browseGameExe();
      if (!res) return;

      setExeName(res.exeName);
      setExePath(res.exePath);

      const hasDetectedTitle =
        Boolean(res.detectedTitle) && res.detectedTitle !== 'Unknown Game';

      if (res.detectedSteamId && res.detectedSteamId > 0) {
        const displayName = hasDetectedTitle
          ? res.detectedTitle
          : res.exeName.replace(/\.exe$/i, '');
        setSelectedSteam({
          appId: res.detectedSteamId,
          name: displayName,
          headerUrl: `${STEAM_HEADER_CDN_BASE}/${res.detectedSteamId}/header.jpg`,
        });
        setTitle(displayName);
        setSteamResults([]);
        setSearched(false);
        setExeDetectedNote(`Đã nhận diện từ .exe (Steam AppID ${res.detectedSteamId})`);
      } else if (hasDetectedTitle) {
        setSelectedSteam(null);
        setTitle(res.detectedTitle);
        setExeDetectedNote(`Đã nhận diện tên game từ .exe: "${res.detectedTitle}" — hãy chọn kết quả Steam bên dưới nếu có`);
      } else {
        setExeDetectedNote(`Đã chọn ${res.exeName}`);
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể đọc thông tin file .exe');
    } finally {
      setBrowsingExe(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Vui lòng nhập tên hoặc chọn game từ Steam / file .exe');
      return;
    }

    if (!window.electronAPI?.createGame) return;

    setSubmitting(true);
    setError(null);

    try {
      let coverUrl: string | null = null;
      let bannerUrl: string | null = null;
      let resolvedSteamId: number = selectedSteam?.appId ?? -1;

      if (window.electronAPI.searchSteamCovers) {
        try {
          const covers = await window.electronAPI.searchSteamCovers(
            cleanTitle,
            selectedSteam?.appId
          );
          coverUrl = covers.posterUrl || covers.poster || null;
          bannerUrl = covers.bannerUrl || covers.banner || null;
          if (resolvedSteamId <= 0 && covers.appId && covers.appId > 0) {
            resolvedSteamId = covers.appId;
          }
        } catch {
          // Offline / lookup timeout — still allow creating the game
        }
      }

      const created = await window.electronAPI.createGame({
        title: cleanTitle,
        exe_name: exeName.trim() || null,
        exe_path: exePath || null,
        steam_id: resolvedSteamId,
        cover_url: coverUrl,
        banner_url: bannerUrl,
        status,
        user_rating: status === 'completed' ? userRating : null,
        notes: status === 'completed' && notes.trim() ? notes.trim() : null,
        playtime_minutes: 0,
      });

      onCreated(created);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (/UNIQUE constraint/i.test(msg)) {
        setError(`"${cleanTitle}" đã có trong thư viện của bạn.`);
      } else {
        setError(msg || 'Lỗi khi tạo trò chơi');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-[#2a2e3d] pb-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-white">
            <Plus className="h-5 w-5 text-[#ff2a44]" />
            <span>Thêm trò chơi mới</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-[#8e95a5] hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4 text-xs">
          {/* File .exe picker (auto-detects game name & Steam AppID) */}
          <div>
            <label className="mb-1 block font-semibold text-[#8e95a5]">
              File thực thi .exe (chọn để tự nhận diện game & theo dõi giờ chơi):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={exeName}
                onChange={(e) => {
                  setExeName(e.target.value);
                  setExePath(null);
                  setExeDetectedNote(null);
                }}
                placeholder="Ví dụ: Cyberpunk2077.exe, eldenring.exe"
                className="min-w-0 flex-1 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 font-mono text-white outline-none focus:border-[#ff2a44]"
              />
              <button
                type="button"
                onClick={handleBrowseExe}
                disabled={browsingExe || submitting}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#1e2230] px-3 py-2 font-semibold text-white transition-colors hover:border-[#ff2a44] hover:bg-[#262b3d] disabled:opacity-50"
              >
                {browsingExe ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5 text-[#ff2a44]" />
                )}
                <span>Chọn file .exe</span>
              </button>
            </div>
            {exeDetectedNote && (
              <p className="mt-1.5 text-[11px] text-emerald-400">{exeDetectedNote}</p>
            )}
          </div>

          {/* Selected Steam Game Preview */}
          {selectedSteam ? (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-24 shrink-0 overflow-hidden rounded-lg border border-[#2a2e3d] bg-[#0e1015]">
                  <img
                    src={selectedSteam.headerUrl}
                    alt={selectedSteam.name}
                    onError={(e) => handleSteamImgError(e, selectedSteam.appId)}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Đã liên kết Steam (AppID: {selectedSteam.appId})</span>
                  </div>
                  <p className="truncate text-sm font-bold text-white">{selectedSteam.name}</p>
                </div>
                <button
                  type="button"
                  onClick={handleClearSteam}
                  disabled={submitting}
                  className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-1 text-[11px] font-semibold text-[#8e95a5] hover:text-white"
                >
                  Đổi
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 flex items-center justify-between font-semibold text-[#8e95a5]">
                <span>Tìm trên Steam hoặc nhập tên game (*):</span>
                {searching && (
                  <span className="flex items-center gap-1 text-[11px] text-[#ff2a44]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Đang tìm Steam...</span>
                  </span>
                )}
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#8e95a5]" />
                <input
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Gõ tên game để tìm từ Steam (vd: Cyberpunk 2077, Elden Ring)..."
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] py-2 pl-9 pr-3 text-white outline-none focus:border-[#ff2a44]"
                />
              </div>

              {/* Steam Search Results Dropdown */}
              {steamResults.length > 0 && (
                <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-1.5">
                  {steamResults.map((item) => (
                    <button
                      key={item.appId}
                      type="button"
                      onClick={() => handlePickSteam(item)}
                      className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-[#1e2230]"
                    >
                      <div className="h-9 w-16 shrink-0 overflow-hidden rounded border border-[#2a2e3d] bg-[#161821]">
                        <img
                          src={item.headerUrl}
                          alt={item.name}
                          onError={(e) => handleSteamImgError(e, item.appId)}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-white">{item.name}</p>
                        <p className="text-[10px] text-[#8e95a5]">Steam AppID: {item.appId}</p>
                      </div>
                      <span className="shrink-0 rounded-md bg-[#ff2a44]/15 px-2 py-0.5 text-[10px] font-bold text-[#ff2a44]">
                        Chọn
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {searched && !searching && steamResults.length === 0 && title.trim().length >= 2 && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#8e95a5]">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span>Không thấy trên Steam — bạn vẫn có thể bấm "Thêm vào Thư viện" để thêm thủ công.</span>
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1.5 block font-semibold text-[#8e95a5]">Trạng thái ban đầu:</label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {[
                {
                  value: 'playing' as GameStatus,
                  label: 'Đang chơi',
                  icon: Gamepad2,
                  activeClass: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-400',
                },
                {
                  value: 'backlog' as GameStatus,
                  label: 'Wishlist (Chờ chơi)',
                  icon: BookmarkPlus,
                  activeClass: 'border-purple-500/60 bg-purple-500/15 text-purple-400',
                },
                {
                  value: 'completed' as GameStatus,
                  label: 'Đã phá đảo',
                  icon: Trophy,
                  activeClass: 'border-amber-500/60 bg-amber-500/15 text-amber-400',
                },
                {
                  value: 'paused' as GameStatus,
                  label: 'Tạm dừng',
                  icon: PauseCircle,
                  activeClass: 'border-sky-500/60 bg-sky-500/15 text-sky-400',
                },
                {
                  value: 'dropped' as GameStatus,
                  label: 'Bỏ dở',
                  icon: XCircle,
                  activeClass: 'border-rose-500/60 bg-rose-500/15 text-rose-400',
                },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = status === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value)}
                    disabled={submitting}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors ${
                      active
                        ? opt.activeClass
                        : 'border-[#2a2e3d] bg-[#0e1015] text-[#8e95a5] hover:border-[#3b4156] hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {status === 'completed' && (
            <div className="space-y-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-semibold text-amber-400">
                  <Star className="h-3.5 w-3.5" />
                  <span>Điểm đánh giá (tuỳ chọn):</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={0.5}
                    value={userRating ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        setUserRating(null);
                      } else {
                        const num = Math.max(1, Math.min(10, Number(v)));
                        setUserRating(Number.isFinite(num) ? num : null);
                      }
                    }}
                    placeholder="1-10"
                    className="w-16 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2 py-1 text-center text-white outline-none focus:border-amber-400"
                  />
                  <span className="text-[11px] text-[#8e95a5]">/ 10</span>
                </div>
              </div>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ghi chú / cảm nhận về game (không bắt buộc)..."
                className="w-full resize-none rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-1.5 text-white outline-none focus:border-amber-400"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[#2a2e3d] pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 font-semibold text-[#8e95a5] hover:text-white disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-4 py-1.5 font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>{submitting ? 'Đang lấy thông tin & thêm...' : 'Thêm vào Thư viện'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
