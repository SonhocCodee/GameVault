import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { AuthStatus, Game, TrackerStatus, WishlistSearchResult } from '../shared/types.js';
import type { PublicGame, CommunitySearchRequest } from '../shared/community.ts';
import { Navbar } from './components/Navbar.js';
import { GameCard } from './components/GameCard.js';
import { GameDetail } from './components/GameDetail.js';
import { SyncModal } from './components/SyncModal.js';
import { WishlistModal } from './components/WishlistModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { AdminCoversModal } from './components/AdminCoversModal.js';
import { FirstRunSetupModal } from './components/FirstRunSetupModal.js';
import { CommunityView } from './components/CommunityView.js';
import { AddGameDetailsModal, type PendingAddGame } from './components/AddGameDetailsModal.js';
import { GameRowSection } from './components/GameRowSection.js';
import { TimelineView } from './components/TimelineView.js';
import { ConfirmModal } from './components/ConfirmModal.js';
import {
  Plus,
  Gamepad2,
  Zap,
  X,
  AlertCircle,
  Loader2,
  Sparkles,
  Camera,
  Search,
  Trophy,
  BookmarkPlus,
  BookmarkCheck,
  CheckCircle2,
  Flame,
  PauseCircle,
  XCircle,
  PlayCircle,
  ArrowLeft,
  Library,
  SlidersHorizontal,
} from 'lucide-react';

// Normalizes a title for alphanumeric matching (library titles vs Steam results)
const normTitle = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Steam CDN asset fallbacks — the header can 404 for some appids, walk down
// the capsule chain before giving up (all on the verified-working Fastly CDN)
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

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [firstRunOpen, setFirstRunOpen] = useState<boolean>(false);
  const [view, setView] = useState<'library' | 'detail' | 'community'>('library');
  const [communitySearch, setCommunitySearch] = useState<CommunitySearchRequest>();
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [communityGame, setCommunityGame] = useState<PublicGame | null>(null);
  const [profileRequest, setProfileRequest] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [updateReady, setUpdateReady] = useState<{ version?: string; dismissed?: boolean } | null>(null);

  useEffect(() => {
    window.electronAPI?.getUpdateStatus?.().then((st) => {
      if (st?.state === 'downloaded') {
        setUpdateReady({ version: st.latestVersion });
      }
    }).catch(() => {});
    const unsub = window.electronAPI?.onUpdateStatus?.((st) => {
      if (st.state === 'downloaded') {
        setUpdateReady({ version: st.latestVersion });
      }
    });
    return () => {
      unsub?.();
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 4500);
  }, []);

  const handleEnrichCovers = async () => {
    try {
      showToast('🔍 Đang tìm nạp ảnh bìa cho các game còn thiếu...');
      if (window.electronAPI?.enrichCovers) {
        const count = await window.electronAPI.enrichCovers();
        await fetchGames();
        if (count > 0) {
          showToast(`✅ Đã tìm nạp thành công ảnh bìa cho ${count} game!`);
        } else {
          showToast('✨ Toàn bộ game đã có ảnh bìa đầy đủ.');
        }
      }
    } catch (err: any) {
      console.error('Enrich covers failed:', err);
      showToast(`❌ Lỗi tìm nạp ảnh bìa: ${err?.message || 'Không xác định'}`);
    }
  };

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('playtime_desc');
  const [libraryLayout, setLibraryLayout] = useState<'grid' | 'timeline'>('grid');

  // Bottom "Tất cả game" section filters (in 'all' tab)
  const [allSearchQuery, setAllSearchQuery] = useState<string>('');
  const [allStatusSubFilter, setAllStatusSubFilter] = useState<string>('all');
  const [allSortBy, setAllSortBy] = useState<string>('title_asc');

  // External (Steam) search — shown under the library grid when searching,
  // lets you add games played on other machines as 'Đã phá đảo' or Wishlist
  const [externalResults, setExternalResults] = useState<WishlistSearchResult[]>([]);
  const [externalSearching, setExternalSearching] = useState<boolean>(false);
  const [externalAdded, setExternalAdded] = useState<Record<number, 'backlog' | 'completed'>>({});
  const [externalError, setExternalError] = useState<string | null>(null);

  // Tracker status
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null);

  // Modals
  const [syncModalOpen, setSyncModalOpen] = useState<boolean>(false);
  const [syncModalTab, setSyncModalTab] = useState<'library' | 'drive_media' | 'local_f6'>('library');
  const [addGameModalOpen, setAddGameModalOpen] = useState<boolean>(false);
  const [wishlistModalOpen, setWishlistModalOpen] = useState<boolean>(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [adminCoversModalOpen, setAdminCoversModalOpen] = useState<boolean>(false);

  // Add Game form fields
  const [newTitle, setNewTitle] = useState('');
  const [newExeName, setNewExeName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addingGame, setAddingGame] = useState(false);

  // Fetch games from SQLite backend
  const fetchGames = useCallback(async () => {
    try {
      if (window.electronAPI?.getGames) {
        const fetched = await window.electronAPI.getGames({
          status: libraryLayout === 'timeline' ? undefined : (statusFilter !== 'all' ? statusFilter : undefined),
          search: searchQuery.trim() || undefined,
          sort: sortBy,
        });
        setGames(fetched || []);
      }
    } catch (err) {
      console.error('Failed to fetch games:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, sortBy, libraryLayout]);

  // Initial load & when filters change
  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const fetchGamesRef = useRef(fetchGames);
  fetchGamesRef.current = fetchGames;

  // Auto-sync library with Cloudflare D1 once on launch if logged in
  useEffect(() => {
    const autoSync = async () => {
      try {
        if (window.electronAPI?.getAuthStatus && window.electronAPI?.syncLibrary) {
          const auth = await window.electronAPI.getAuthStatus();
          if (auth.loggedIn) {
            const res = await window.electronAPI.syncLibrary();
            if (res && (res.pulled > 0 || res.updated > 0)) {
              fetchGamesRef.current();
            }
          }
        }
      } catch (err) {
        console.warn('Auto library sync skipped:', err);
      }
    };
    autoSync();
  }, []);

  // One-time setup wizard: Step 1 mandatory Google login, Step 2 storage + screenshot setup
  const [firstRunPaths, setFirstRunPaths] = useState({
    mediaBaseDir: '',
    screenshotsDir: '',
    vaultRoot: '',
    hddMode: true,
    screenshotEnabled: true,
    screenshotHotkey: 'F6',
    appStartupEnabled: true,
  });

  const refreshOnboardingState = useCallback(async () => {
    try {
      const auth = window.electronAPI?.getAuthStatus
        ? await window.electronAPI.getAuthStatus()
        : null;
      if (auth) setAuthStatus(auth);

      if (!auth?.loggedIn) {
        setFirstRunOpen(true);
        return;
      }

      if (window.electronAPI?.getSettings) {
        const s = await window.electronAPI.getSettings();
        if (!s.setupCompleted) {
          setFirstRunPaths({
            mediaBaseDir: s.mediaBaseDir || '',
            screenshotsDir: s.screenshotsDir || '',
            vaultRoot: s.vaultRoot || '',
            hddMode: s.hddMode !== undefined ? s.hddMode : true,
            screenshotEnabled: s.screenshotEnabled !== undefined ? s.screenshotEnabled : true,
            screenshotHotkey: s.screenshotHotkey || 'F6',
            appStartupEnabled: s.appStartupEnabled !== undefined ? s.appStartupEnabled : false,
          });
          setFirstRunOpen(true);
        } else {
          setFirstRunOpen(false);
        }
      }
    } catch {
      // Setup check is best-effort
    }
  }, []);

  useEffect(() => {
    void refreshOnboardingState();
  }, [refreshOnboardingState]);

  const handleFirstRunLogin = async () => {
    if (!window.electronAPI?.login) return;
    const profile = await window.electronAPI.login();
    const nextAuth: AuthStatus = {
      loggedIn: true,
      profile,
      configPresent: authStatus?.configPresent ?? true,
    };
    setAuthStatus(nextAuth);
    try {
      if (window.electronAPI?.syncLibrary) {
        await window.electronAPI.syncLibrary();
      }
    } catch {}
    await fetchGames();
    await refreshOnboardingState();
  };

  const handleFirstRunBrowse = async (field: 'media' | 'screenshots' | 'vault') => {
    if (!window.electronAPI?.browseFolder) return;
    const initial =
      field === 'media' ? firstRunPaths.mediaBaseDir : field === 'screenshots' ? firstRunPaths.screenshotsDir : firstRunPaths.vaultRoot;
    const chosen = await window.electronAPI.browseFolder(initial || undefined);
    if (!chosen) return;
    if (field === 'media') setFirstRunPaths((p) => ({ ...p, mediaBaseDir: chosen }));
    else if (field === 'screenshots') setFirstRunPaths((p) => ({ ...p, screenshotsDir: chosen }));
    else setFirstRunPaths((p) => ({ ...p, vaultRoot: chosen }));
  };

  const handleFirstRunComplete = async () => {
    if (!window.electronAPI?.saveSettings) return;
    await window.electronAPI.saveSettings({
      mediaBaseDir: firstRunPaths.mediaBaseDir.trim(),
      screenshotsDir: firstRunPaths.screenshotsDir.trim(),
      vaultRoot: firstRunPaths.vaultRoot.trim(),
      hddMode: firstRunPaths.hddMode,
      screenshotEnabled: firstRunPaths.screenshotEnabled,
      screenshotHotkey: firstRunPaths.screenshotHotkey,
      appStartupEnabled: firstRunPaths.appStartupEnabled,
      setupCompleted: true,
    });
    setFirstRunOpen(false);
    fetchGames();
  };

  // Debounced external Steam search under the library grid while typing.
  // Games already in the library (by normalized title or Steam AppID) are excluded.
  useEffect(() => {
    if (view !== 'library') return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setExternalResults([]);
      setExternalSearching(false);
      setExternalError(null);
      return;
    }

    setExternalSearching(true);
    setExternalError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [ext, allLibrary] = await Promise.all([
          window.electronAPI?.searchWishlistGames
            ? window.electronAPI.searchWishlistGames(q)
            : Promise.resolve([] as WishlistSearchResult[]),
          window.electronAPI?.getGames
            ? window.electronAPI.getGames({})
            : Promise.resolve([] as Game[]),
        ]);
        if (cancelled) return;
        const libNorm = new Set((allLibrary as Game[]).map((g) => normTitle(g.title)));
        const libSteamIds = new Set(
          (allLibrary as Game[])
            .map((g) => Number(g.steam_id))
            .filter((id) => Number.isFinite(id) && id > 0)
        );
        setExternalResults(
          (ext as WishlistSearchResult[]).filter(
            (r) => !libNorm.has(normTitle(r.name)) && !libSteamIds.has(Number(r.appId))
          )
        );
      } catch (err) {
        if (cancelled) return;
        console.error('External search failed:', err);
        setExternalResults([]);
        setExternalError('Không tìm được game trên Steam (mạng lỗi hoặc bị chặn).');
      } finally {
        if (!cancelled) setExternalSearching(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, view]);

  // Periodic Tracker status polling (every 5 seconds)
  useEffect(() => {
    const checkTracker = async () => {
      try {
        if (window.electronAPI?.getTrackerStatus) {
          const status = await window.electronAPI.getTrackerStatus();
          setTrackerStatus(status);
        }
      } catch (err) {
        // Ignore tracker poll errors
      }
    };

    checkTracker();
    const interval = setInterval(checkTracker, 5000);
    return () => clearInterval(interval);
  }, []);

  // Real-time Event Subscriptions (Auto Game Detected & F6 Screenshot Synced)
  useEffect(() => {
    const unsubGame = window.electronAPI?.onGameAdded?.((newGame) => {
      fetchGames();
      showToast(`🎮 Đã tự động thêm game: ${newGame.title} & tạo folder E:\\Game\\${newGame.media_folder || newGame.title}`);
    });

    // Cover art resolves in the background seconds after a game is added —
    // swap the fresh row in so the card shows art without any refresh
    const unsubUpdated = window.electronAPI?.onGameUpdated?.((updatedGame) => {
      setGames((prev) => prev.map((g) => (g.id === updatedGame.id ? updatedGame : g)));
    });

    const unsubShot = window.electronAPI?.onScreenshotSynced?.((info) => {
      showToast(`📸 F6 Capture: Đã đồng bộ ảnh vào "${info.gameTitle}"`);
    });

    return () => {
      if (unsubGame) unsubGame();
      if (unsubUpdated) unsubUpdated();
      if (unsubShot) unsubShot();
    };
  }, [fetchGames, showToast]);

  // Global ESC key handling for library return
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (view === 'detail' || view === 'community')) {
        setView('library');
        setSelectedGameId(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [view]);

  // Calculate statistics across all loaded games
  const totalPlaytimeMinutes = useMemo(() => {
    return games.reduce((acc, g) => acc + (g.playtime_minutes || 0), 0);
  }, [games]);

  const completedGamesCount = useMemo(() => {
    return games.filter((g) => g.status === 'completed').length;
  }, [games]);

  const selectedGame = useMemo(() => {
    return games.find((g) => g.id === selectedGameId);
  }, [games, selectedGameId]);

  // Categorize games for Home / Library View
  const categorizedGames = useMemo(() => {
    // 1. "Game chơi gần đây" (status 'playing')
    // Sắp xếp các game chơi gần đây nhất lên đầu (last_played_at DESC, updated_at DESC, playtime DESC)
    const recentTimeOf = (g: Game) => {
      if (g.last_played_at) {
        const t = new Date(g.last_played_at).getTime();
        if (!isNaN(t)) return t;
      }
      if (g.updated_at) {
        const t = new Date(g.updated_at).getTime();
        if (!isNaN(t)) return t;
      }
      if (g.created_at) {
        const t = new Date(g.created_at).getTime();
        if (!isNaN(t)) return t;
      }
      return 0;
    };

    const playingGames = games
      .filter((g) => g.status === 'playing')
      .sort((a, b) => {
        // Active running game always first
        if (trackerStatus?.activeGameTitle) {
          const aActive = a.title.toLowerCase() === trackerStatus.activeGameTitle.toLowerCase();
          const bActive = b.title.toLowerCase() === trackerStatus.activeGameTitle.toLowerCase();
          if (aActive && !bActive) return -1;
          if (!aActive && bActive) return 1;
        }
        const timeDiff = recentTimeOf(b) - recentTimeOf(a);
        if (timeDiff !== 0) return timeDiff;
        return (b.playtime_minutes || 0) - (a.playtime_minutes || 0);
      });

    // 2. "Đã phá đảo" (status 'completed')
    // Sắp xếp theo ngày phá đảo (completed_at DESC) hoặc đánh giá / playtime
    const completedGames = games
      .filter((g) => g.status === 'completed')
      .sort((a, b) => {
        const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        if (timeA && timeB) return timeB - timeA;
        if (timeA) return -1;
        if (timeB) return 1;
        return (
          (b.user_rating || 0) - (a.user_rating || 0) ||
          (b.playtime_minutes || 0) - (a.playtime_minutes || 0)
        );
      });

    // 3. "Chờ chơi" (status 'backlog')
    const backlogGames = games.filter((g) => g.status === 'backlog');

    // 4. "Tạm dừng" (status 'paused')
    const pausedGames = games.filter((g) => g.status === 'paused');

    // 5. "Bỏ dở" (status 'dropped')
    const droppedGames = games.filter((g) => g.status === 'dropped');

    // Any other statuses (if any)
    const otherGames = games.filter(
      (g) => !['playing', 'completed', 'backlog', 'paused', 'dropped'].includes(g.status)
    );

    return {
      playing: playingGames,
      completed: completedGames,
      backlog: backlogGames,
      paused: pausedGames,
      dropped: droppedGames,
      other: otherGames,
    };
  }, [games, trackerStatus?.activeGameTitle]);

  // Filtered & sorted list for the bottom "Tất cả game" section in the 'all' tab
  const filteredAllGames = useMemo(() => {
    const q = allSearchQuery.trim().toLowerCase();
    const recentTimeOf = (g: Game) => {
      const raw = g.last_played_at || g.updated_at || g.created_at;
      if (!raw) return 0;
      const t = new Date(raw).getTime();
      return isNaN(t) ? 0 : t;
    };

    const list = games.filter((g) => {
      if (allStatusSubFilter !== 'all' && g.status !== allStatusSubFilter) return false;
      if (q) {
        const titleMatch = (g.title || '').toLowerCase().includes(q);
        const exeMatch = (g.exe_name || '').toLowerCase().includes(q);
        if (!titleMatch && !exeMatch) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      switch (allSortBy) {
        case 'title_asc':
          return (a.title || '').localeCompare(b.title || '', 'vi', { sensitivity: 'base' });
        case 'title_desc':
          return (b.title || '').localeCompare(a.title || '', 'vi', { sensitivity: 'base' });
        case 'recent_played': {
          const diff = recentTimeOf(b) - recentTimeOf(a);
          return diff !== 0 ? diff : (b.playtime_minutes || 0) - (a.playtime_minutes || 0);
        }
        case 'rating_desc':
          return (
            (b.user_rating || 0) - (a.user_rating || 0) ||
            (b.playtime_minutes || 0) - (a.playtime_minutes || 0)
          );
        case 'playtime_desc':
        default:
          return (b.playtime_minutes || 0) - (a.playtime_minutes || 0);
      }
    });
  }, [games, allSearchQuery, allStatusSubFilter, allSortBy]);

  const getStatusTabInfo = (status: string) => {
    switch (status) {
      case 'playing':
        return {
          label: 'Đang chơi',
          desc: 'Danh sách các tựa game bạn đang tích cực trải nghiệm',
          colorClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
        };
      case 'completed':
        return {
          label: 'Đã phá đảo',
          desc: 'Bộ sưu tập các tựa game bạn đã hoàn thành xuất sắc',
          colorClass: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
        };
      case 'backlog':
        return {
          label: 'Chờ chơi (Wishlist)',
          desc: 'Danh sách các game trong hàng đợi chuẩn bị chơi',
          colorClass: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
        };
      case 'paused':
        return {
          label: 'Tạm dừng',
          desc: 'Các tựa game đang tạm hoãn, dự kiến tiếp tục sau',
          colorClass: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
        };
      case 'dropped':
        return {
          label: 'Bỏ dở',
          desc: 'Các tựa game bạn đã quyết định dừng chơi',
          colorClass: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
        };
      default:
        return {
          label: 'Bộ lọc trò chơi',
          desc: 'Danh sách trò chơi theo bộ lọc hiện tại',
          colorClass: 'border-[#2a2e3d] bg-[#161821] text-white',
        };
    }
  };

  // Navigation handlers
  const handleSelectGame = (id: number) => {
    setSelectedGameId(id);
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToLibrary = () => {
    setView('library');
    setSelectedGameId(null);
    fetchGames();
  };

  const [pendingDeleteCard, setPendingDeleteCard] = useState<{ id: number; title: string } | null>(null);

  const openAddGameModal = () => {
    setAddError(null);
    setAddingGame(false);
    setAddGameModalOpen(true);
  };

  const closeAddGameModal = () => {
    setAddError(null);
    setAddingGame(false);
    setAddGameModalOpen(false);
  };

  const handleDeleteGameCard = (gameId: number, gameTitle: string) => {
    setPendingDeleteCard({ id: gameId, title: gameTitle });
  };

  const confirmDeleteGameCard = async () => {
    if (!pendingDeleteCard) return;
    const { id } = pendingDeleteCard;
    setPendingDeleteCard(null);
    if (window.electronAPI?.deleteGame) {
      await window.electronAPI.deleteGame(id);
      fetchGames();
    }
  };

  const handleGameUpdated = (updatedGame: Game) => {
    setGames((prev) => prev.map((g) => (g.id === updatedGame.id ? updatedGame : g)));
  };

  // Add a game found via external Steam search — clicking a button first
  // opens the rating/review prompt; the actual add happens on confirm.
  // 'completed' = đã phá đảo (chơi ở máy khác, không có giờ chơi tại đây)
  // 'backlog'   = thêm vào Chờ chơi (Wishlist)
  const [pendingAdd, setPendingAdd] = useState<PendingAddGame | null>(null);
  const [pendingAddBusy, setPendingAddBusy] = useState<boolean>(false);
  const [pendingAddError, setPendingAddError] = useState<string | null>(null);

  const handleAddExternal = (result: WishlistSearchResult, status: 'backlog' | 'completed') => {
    setPendingAddError(null);
    setPendingAdd({ appId: result.appId, name: result.name, status });
  };

  const confirmAddExternal = async (rating: number | null, notes: string) => {
    if (!pendingAdd || !window.electronAPI?.addWishlistGame) return;
    setPendingAddBusy(true);
    setPendingAddError(null);
    try {
      await window.electronAPI.addWishlistGame({
        title: pendingAdd.name,
        steamId: pendingAdd.appId,
        status: pendingAdd.status,
        user_rating: rating,
        notes,
      });
      setExternalAdded((prev) => ({ ...prev, [pendingAdd.appId]: pendingAdd.status }));
      // Drop from external list — the game now lives in the library grid above
      setExternalResults((prev) => prev.filter((r) => r.appId !== pendingAdd.appId));
      setPendingAdd(null);
      await fetchGames();
    } catch (err: any) {
      setPendingAddError(err?.message || 'Không thể thêm game vào thư viện');
    } finally {
      setPendingAddBusy(false);
    }
  };

  // Add Game handler
  const handleCreateGame = async (e: React.FormEvent) => {    e.preventDefault();
    if (!newTitle.trim()) {
      setAddError('Vui lòng nhập tên trò chơi');
      return;
    }

    setAddingGame(true);
    setAddError(null);
    try {
      if (window.electronAPI?.createGame) {
        // New games are ALWAYS 'playing' by default — 'Chờ chơi' (wishlist)
        // is only reachable through the Steam wishlist search modal
        const created = await window.electronAPI.createGame({
          title: newTitle.trim(),
          exe_name: newExeName.trim() || null,
          status: 'playing',
          playtime_minutes: 0,
        });

        // Try automatic Steam cover art lookup in background
        if (window.electronAPI.searchSteamCovers) {
          window.electronAPI
            .searchSteamCovers(created.title)
            .then(async (covers) => {
              if (covers.posterUrl || covers.bannerUrl) {
                await window.electronAPI.updateGame(created.id, {
                  cover_url: covers.posterUrl || null,
                  banner_url: covers.bannerUrl || null,
                });
                fetchGames();
              }
            })
            .catch(() => {});
        }

        setNewTitle('');
        setNewExeName('');
        setAddGameModalOpen(false);
        await fetchGames();
        handleSelectGame(created.id);
      }
    } catch (err: any) {
      setAddError(err?.message || 'Lỗi khi tạo trò chơi');
    } finally {
      setAddingGame(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e1015] text-[#f1f3f7]">
      {/* Top Navbar */}
      <Navbar
        onCommunitySearch={setCommunitySearch}
        onAuthChanged={(st) => {
          setAuthStatus(st);
          void refreshOnboardingState();
        }}
        currentView={view}
        isDetailView={view === 'detail'}
        selectedGameTitle={selectedGame?.title}
        onBackToLibrary={handleBackToLibrary}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
        totalGames={games.length}
        totalPlaytimeMinutes={totalPlaytimeMinutes}
        completedGamesCount={completedGamesCount}
        trackerStatus={trackerStatus}
        libraryLayout={libraryLayout}
        onLibraryLayoutChange={setLibraryLayout}
        onOpenSyncModal={(tab) => {
          if (tab) setSyncModalTab(tab);
          setSyncModalOpen(true);
        }}
        onOpenAddGameModal={openAddGameModal}
        onOpenWishlistModal={() => setWishlistModalOpen(true)}
        onOpenSettingsModal={() => setSettingsModalOpen(true)}
        onOpenAdminModal={() => setAdminCoversModalOpen(true)}
        onEnrichCovers={handleEnrichCovers}
        onOpenCommunity={() => {
          setCommunitySearch(undefined);
          setProfileRequest(0);
          setCommunityGame(null);
          setView('community');
          window.scrollTo({ top: 0 });
        }}
        onOpenProfile={() => {
          setCommunitySearch(undefined);
          setCommunityGame(null);
          setProfileRequest((request) => request + 1);
          setView('community');
          window.scrollTo({ top: 0 });
        }}
      />

      {/* Main View Router */}
      <main className="mx-auto max-w-7xl">
        {view === 'community' ? (
          <CommunityView searchRequest={communitySearch} onBack={() => setView('library')} authStatus={authStatus} initialGame={communityGame} profileRequest={profileRequest} onLocalGame={(id) => { setSelectedGameId(id); setView('detail'); window.scrollTo({ top: 0 }); }} />
        ) : view === 'detail' && selectedGameId !== null ? (
          <GameDetail
            gameId={selectedGameId}
            onBack={handleBackToLibrary}
            onGameUpdated={handleGameUpdated}
            onShowToast={showToast}
            onOpenCommunity={(game) => {
              setProfileRequest(0);
              setCommunityGame(game);
              setCommunitySearch(undefined);
              setView('community');
              window.scrollTo({ top: 0 });
            }}
          />
        ) : (
          /* Library Grid View */
          <div className="px-6 py-8">
            {loading ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-[#ff2a44]" />
                <p className="text-xs text-[#8e95a5]">Đang nạp thư viện trò chơi...</p>
              </div>
            ) : games.length === 0 && externalResults.length === 0 ? (
              /* Empty Library State */
              <div className="flex min-h-[55vh] flex-col items-center justify-center rounded-3xl border border-[#2a2e3d] bg-[#161821]/50 p-12 text-center backdrop-blur-sm">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ff2a44]/10 border border-[#ff2a44]/30 shadow-lg shadow-[#ff2a44]/10">
                  <Gamepad2 className="h-8 w-8 text-[#ff2a44]" />
                </div>
                <h3 className="text-lg font-bold text-white">Chưa có trò chơi nào trong thư viện</h3>
                <p className="mt-1.5 max-w-md text-xs text-[#8e95a5]">
                  {searchQuery || statusFilter !== 'all'
                    ? 'Không tìm thấy trò chơi phù hợp với bộ lọc hiện tại. Thử xóa tìm kiếm hoặc chuyển tab.'
                    : 'Thêm game mới để bắt đầu theo dõi giờ chơi và ảnh chụp trên mọi GPU.'}
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={openAddGameModal}
                    className="flex items-center gap-2 rounded-xl border border-[#2a2e3d] bg-[#161821] px-4 py-2.5 text-xs font-bold text-[#f1f3f7] hover:border-[#ff2a44] hover:bg-[#1f2230] transition-all"
                  >
                    <Plus className="h-4 w-4 text-[#ff2a44]" />
                    <span>Thêm game thủ công</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {libraryLayout === 'timeline' ? (
                  /* Timeline Tree / Column View */
                  <TimelineView
                    games={games}
                    onSelectGame={handleSelectGame}
                    trackerStatus={trackerStatus}
                    searchQuery={searchQuery}
                    statusFilter={statusFilter}
                  />
                ) : statusFilter !== 'all' ? (
                  /* Single Status Filter Grid View */
                  <div>
                    {/* Filter Banner */}
                    <div className="mb-6 flex items-center justify-between border-b border-[#2a2e3d] pb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2a2e3d] bg-[#161821] text-white">
                          <Gamepad2 className="h-5 w-5 text-[#ff2a44]" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-white">
                              {getStatusTabInfo(statusFilter).label}
                            </h2>
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                                getStatusTabInfo(statusFilter).colorClass
                              }`}
                            >
                              {games.length} game
                            </span>
                          </div>
                          <p className="text-xs text-[#8e95a5]">
                            {getStatusTabInfo(statusFilter).desc}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => setStatusFilter('all')}
                        className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3.5 py-2 text-xs font-semibold text-[#8e95a5] hover:border-[#ff2a44] hover:text-white transition-all"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        <span>Xem trang chủ (Tất cả)</span>
                      </button>
                    </div>

                    {games.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
                        {games.map((game) => (
                          <GameCard
                            key={game.id}
                            game={game}
                            isActive={
                              trackerStatus?.activeGameTitle
                                ? game.title.toLowerCase() === trackerStatus.activeGameTitle.toLowerCase()
                                : false
                            }
                            onSelect={handleSelectGame}
                            onDelete={handleDeleteGameCard}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[#2a2e3d] bg-[#161821]/30 p-8 text-center text-xs text-[#8e95a5]">
                        Không có trò chơi nào trong mục này.
                      </div>
                    )}
                  </div>
                ) : (
                  /* Home Page ("Tất cả" tab): Top row = Game chơi gần đây, Bottom = All games grid with search & A-Z filter */
                  <div>
                    {/* Row 1: Game chơi gần đây */}
                    {categorizedGames.playing.length > 0 ? (
                      <GameRowSection
                        id="section-playing"
                        title="Game chơi gần đây"
                        subtitle="Sắp xếp theo thứ tự chơi gần đây nhất"
                        icon={<Flame className="h-4 w-4 text-[#ff2a44]" />}
                        badgeLabel="Đang chơi"
                        badgeColorClass="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        games={categorizedGames.playing}
                        activeGameTitle={trackerStatus?.activeGameTitle}
                        onSelectGame={handleSelectGame}
                        onDeleteGame={handleDeleteGameCard}
                        onFilterToThisStatus={() => setStatusFilter('playing')}
                      />
                    ) : (
                      !searchQuery && games.length > 0 && (
                        <div className="mb-6 rounded-xl border border-dashed border-[#2a2e3d] bg-[#161821]/40 p-4 text-center">
                          <p className="text-xs text-[#8e95a5]">
                            Chưa có game nào trong danh sách Đang chơi gần đây.
                          </p>
                        </div>
                      )
                    )}

                    {/* Divider separating Recent Games from All Games */}
                    <div className="my-8 flex items-center gap-4">
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#2a2e3d] to-[#2a2e3d]" />
                      <span className="text-[11px] font-bold uppercase tracking-widest text-[#8e95a5]">
                        Toàn bộ thư viện
                      </span>
                      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-[#2a2e3d] to-[#2a2e3d]" />
                    </div>

                    {/* Bottom Section: All Games Grid + Search & Sort (A-Z, etc.) */}
                    <section id="section-all-games">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2a2e3d] bg-[#161821] text-white">
                            <Library className="h-5 w-5 text-[#ff2a44]" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="text-lg font-bold text-white">Tất cả game</h2>
                              <span className="rounded-full border border-[#2a2e3d] bg-[#161821] px-2.5 py-0.5 text-xs font-bold text-[#f1f3f7]">
                                {filteredAllGames.length} game
                              </span>
                            </div>
                            <p className="text-xs text-[#8e95a5]">
                              Hiển thị toàn bộ các tựa game trong thư viện của bạn
                            </p>
                          </div>
                        </div>

                        {/* Search & Filter Toolbar */}
                        <div className="flex flex-wrap items-center gap-2.5">
                          <div className="relative flex-1 sm:w-64 sm:flex-initial">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#8e95a5]">
                              <Search className="h-3.5 w-3.5" />
                            </div>
                            <input
                              type="text"
                              value={allSearchQuery}
                              onChange={(e) => setAllSearchQuery(e.target.value)}
                              placeholder="Tìm game trong thư viện..."
                              className="w-full rounded-lg border border-[#2a2e3d] bg-[#161821] py-2 pl-9 pr-8 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none transition-all focus:border-[#ff2a44] focus:ring-1 focus:ring-[#ff2a44]"
                            />
                            {allSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setAllSearchQuery('')}
                                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-[#8e95a5] hover:text-white"
                                title="Xóa tìm kiếm"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          <select
                            value={allStatusSubFilter}
                            onChange={(e) => setAllStatusSubFilter(e.target.value)}
                            className="cursor-pointer rounded-lg border border-[#2a2e3d] bg-[#161821] px-2.5 py-2 text-xs text-[#f1f3f7] outline-none transition-colors hover:border-[#ff2a44] focus:border-[#ff2a44]"
                            title="Lọc theo trạng thái"
                          >
                            <option value="all" className="bg-[#161821] text-[#f1f3f7]">Tất cả trạng thái</option>
                            <option value="playing" className="bg-[#161821] text-[#f1f3f7]">Đang chơi</option>
                            <option value="completed" className="bg-[#161821] text-[#f1f3f7]">Đã phá đảo</option>
                            <option value="backlog" className="bg-[#161821] text-[#f1f3f7]">Chờ chơi</option>
                            <option value="paused" className="bg-[#161821] text-[#f1f3f7]">Tạm dừng</option>
                            <option value="dropped" className="bg-[#161821] text-[#f1f3f7]">Bỏ dở</option>
                          </select>

                          <div className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-2.5 py-2">
                            <SlidersHorizontal className="h-3.5 w-3.5 text-[#8e95a5] shrink-0" />
                            <select
                              value={allSortBy}
                              onChange={(e) => setAllSortBy(e.target.value)}
                              className="cursor-pointer bg-transparent text-xs text-[#f1f3f7] outline-none"
                              title="Sắp xếp danh sách"
                            >
                              <option value="title_asc" className="bg-[#161821] text-[#f1f3f7]">Tên (A - Z)</option>
                              <option value="title_desc" className="bg-[#161821] text-[#f1f3f7]">Tên (Z - A)</option>
                              <option value="playtime_desc" className="bg-[#161821] text-[#f1f3f7]">Thời gian chơi nhiều nhất</option>
                              <option value="recent_played" className="bg-[#161821] text-[#f1f3f7]">Mới chơi gần đây</option>
                              <option value="rating_desc" className="bg-[#161821] text-[#f1f3f7]">Điểm đánh giá cao nhất</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {filteredAllGames.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
                          {filteredAllGames.map((game) => (
                            <GameCard
                              key={game.id}
                              game={game}
                              isActive={
                                trackerStatus?.activeGameTitle
                                  ? game.title.toLowerCase() === trackerStatus.activeGameTitle.toLowerCase()
                                  : false
                              }
                              onSelect={handleSelectGame}
                              onDelete={handleDeleteGameCard}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-[#2a2e3d] bg-[#161821]/30 p-8 text-center text-xs text-[#8e95a5]">
                          <p>Không tìm thấy trò chơi nào khớp với bộ lọc hiện tại.</p>
                          {(allSearchQuery || allStatusSubFilter !== 'all') && (
                            <button
                              type="button"
                              onClick={() => {
                                setAllSearchQuery('');
                                setAllStatusSubFilter('all');
                              }}
                              className="mt-3 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#ff2a44]"
                            >
                              Xóa bộ lọc
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {/* External Steam Results — add games played elsewhere as 'Đã phá đảo' or Wishlist */}
                {searchQuery.trim().length >= 2 && (
                  <div className="mt-8">
                    <div className="mb-3 flex items-center gap-2">
                      <Search className="h-4 w-4 text-[#8e95a5]" />
                      <h3 className="text-sm font-bold text-white">
                        Không có trong thư viện? Kết quả trên Steam
                      </h3>
                      {externalSearching && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#8e95a5]" />
                      )}
                    </div>

                    {externalError && (
                      <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{externalError}</span>
                      </div>
                    )}

                    {!externalSearching && externalResults.length === 0 && !externalError ? (
                      <p className="text-xs text-[#8e95a5]">
                        Không tìm thấy game nào trùng khớp trên Steam.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {externalResults.map((r) => {
                          const added = externalAdded[r.appId];
                          return (
                            <div
                              key={r.appId}
                              className="flex items-center gap-3 rounded-xl border border-[#2a2e3d] bg-[#161821] p-2.5 transition-all hover:border-[#ff2a44]/50"
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
                                <p className="text-[10px] text-[#8e95a5]">
                                  Steam AppID: {r.appId} — chơi ở máy khác thì thêm &amp; đánh dấu đã phá đảo
                                </p>
                              </div>
                              {added ? (
                                <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-3 py-2 text-xs font-bold text-emerald-400">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>Đã thêm</span>
                                </span>
                              ) : (
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    onClick={() => handleAddExternal(r, 'completed')}
                                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff2a44] to-[#e02424] px-3 py-2 text-xs font-bold text-white shadow hover:brightness-110"
                                    title="Đã chơi game này (máy khác) — thêm vào thư viện với trạng thái Đã phá đảo"
                                  >
                                    <Trophy className="h-3.5 w-3.5" />
                                    <span>Đã phá đảo</span>
                                  </button>
                                  <button
                                    onClick={() => handleAddExternal(r, 'backlog')}
                                    className="flex items-center gap-1.5 rounded-lg border border-purple-400/40 bg-purple-600/15 px-3 py-2 text-xs font-bold text-purple-300 transition-all hover:bg-purple-600 hover:text-white"
                                    title="Chưa chơi — thêm vào danh sách Chờ chơi (Wishlist)"
                                  >
                                    <BookmarkPlus className="h-3.5 w-3.5" />
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
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Sync Modal */}
      <SyncModal
        isOpen={syncModalOpen}
        initialTab={syncModalTab}
        onClose={() => setSyncModalOpen(false)}
        onSuccess={() => fetchGames()}
      />

      {/* Add Game Modal */}
      {addGameModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="h-5 w-5 text-[#ff2a44]" />
                <span>Thêm trò chơi mới</span>
              </h3>
              <button
                type="button"
                onClick={closeAddGameModal}
                className="rounded-lg p-1 text-[#8e95a5] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {addError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleCreateGame} noValidate className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-[#8e95a5] mb-1">Tên trò chơi (*):</label>
                <input
                  type="text"
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ví dụ: Cyberpunk 2077, Elden Ring..."
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-white outline-none focus:border-[#ff2a44]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#8e95a5] mb-1">
                  Tên file thực thi .exe (tùy chọn để theo dõi):
                </label>
                <input
                  type="text"
                  value={newExeName}
                  onChange={(e) => setNewExeName(e.target.value)}
                  placeholder="Ví dụ: Cyberpunk2077.exe, eldenring.exe"
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 font-mono text-white outline-none focus:border-[#ff2a44]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#8e95a5] mb-1">Trạng thái ban đầu:</label>
                <div className="flex items-center justify-between rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2">
                  <span className="flex items-center gap-2 font-bold text-emerald-400">🎮 Đang chơi</span>
                  <span className="text-[10px] text-[#8e95a5]">Mặc định — muốn chờ chơi thì tìm qua Wishlist</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2a2e3d]">
                <button
                  type="button"
                  onClick={closeAddGameModal}
                  className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 font-semibold text-[#8e95a5] hover:text-white"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={addingGame}
                  className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-4 py-1.5 font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
                >
                  {addingGame ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  <span>Thêm vào Thư viện</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(pendingDeleteCard)}
        title="Xóa trò chơi khỏi thư viện"
        message={
          pendingDeleteCard
            ? `Bạn có chắc chắn muốn xóa "${pendingDeleteCard.title}" khỏi thư viện GameVault không?\n\n(Chỉ xóa dữ liệu khỏi app, không ảnh hưởng file game thực tế)`
            : ''
        }
        confirmText="Xóa khỏi thư viện"
        onConfirm={confirmDeleteGameCard}
        onCancel={() => setPendingDeleteCard(null)}
      />

      {/* Wishlist Search Modal ('Chờ chơi') */}
      <WishlistModal
        isOpen={wishlistModalOpen}
        onClose={() => setWishlistModalOpen(false)}
        onAdded={() => fetchGames()}
        onOpenGame={(id) => {
          setWishlistModalOpen(false);
          handleSelectGame(id);
        }}
      />

      {/* Settings & Hotkey Customization Modal */}
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        onSaved={() => fetchGames()}
        onOpenSyncCenter={() => {
          setSettingsModalOpen(false);
          setSyncModalOpen(true);
        }}
      />

      {/* Admin Game Covers Management Modal */}
      <AdminCoversModal
        isOpen={adminCoversModalOpen}
        onClose={() => setAdminCoversModalOpen(false)}
        onCoversChanged={() => fetchGames()}
      />

      {/* Mandatory 2-step first-run onboarding */}
      {firstRunOpen && (
        <FirstRunSetupModal
          loggedIn={!!authStatus?.loggedIn}
          userEmail={authStatus?.profile?.email}
          mediaBaseDir={firstRunPaths.mediaBaseDir}
          screenshotsDir={firstRunPaths.screenshotsDir}
          vaultRoot={firstRunPaths.vaultRoot}
          hddMode={firstRunPaths.hddMode}
          screenshotEnabled={firstRunPaths.screenshotEnabled}
          screenshotHotkey={firstRunPaths.screenshotHotkey}
          appStartupEnabled={firstRunPaths.appStartupEnabled}
          onHddModeChange={(enabled) => setFirstRunPaths((p) => ({ ...p, hddMode: enabled }))}
          onScreenshotEnabledChange={(enabled) => setFirstRunPaths((p) => ({ ...p, screenshotEnabled: enabled }))}
          onScreenshotHotkeyChange={(hotkey) => setFirstRunPaths((p) => ({ ...p, screenshotHotkey: hotkey }))}
          onAppStartupChange={(enabled) => setFirstRunPaths((p) => ({ ...p, appStartupEnabled: enabled }))}
          onFieldChange={(field, value) => {
            if (field === 'media') setFirstRunPaths((p) => ({ ...p, mediaBaseDir: value }));
            else if (field === 'screenshots') setFirstRunPaths((p) => ({ ...p, screenshotsDir: value }));
            else setFirstRunPaths((p) => ({ ...p, vaultRoot: value }));
          }}
          onBrowseFolder={handleFirstRunBrowse}
          onGoogleLogin={handleFirstRunLogin}
          onComplete={handleFirstRunComplete}
        />
      )}

      {/* Rating/review prompt before adding a game from external search */}
      <AddGameDetailsModal
        pending={pendingAdd}
        busy={pendingAddBusy}
        error={pendingAddError}
        onClose={() => setPendingAdd(null)}
        onConfirm={confirmAddExternal}
      />

      {/* In-app Update Ready Banner */}
      {updateReady && !updateReady.dismissed && (
        <div className="fixed bottom-6 left-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-[#161821]/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-md">
          <span className="font-medium">
            Có bản cập nhật mới{updateReady.version ? ` v${updateReady.version}` : ''} đã sẵn sàng!
          </span>
          <button
            onClick={() => window.electronAPI?.installUpdate?.()}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-500 transition-colors"
          >
            Cập nhật & Khởi động lại
          </button>
          <button
            onClick={() => setUpdateReady((prev) => (prev ? { ...prev, dismissed: true } : null))}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Real-time Floating Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-red-500/40 bg-[#161821]/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200">
          <Sparkles className="h-4 w-4 text-red-400 animate-pulse" />
          <span className="font-medium">{toastMsg}</span>
          <button
            onClick={() => setToastMsg(null)}
            className="ml-2 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
