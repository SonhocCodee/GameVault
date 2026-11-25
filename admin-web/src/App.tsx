import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  Search,
  RefreshCw,
  LogOut,
  Plus,
  Activity,
  CloudUpload,
  DatabaseZap,
  Globe,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Layers,
} from 'lucide-react';
import {
  type AdminCoverItem,
  type AdminStats,
  type AdminUserInfo,
  type CoverFilter,
  type HealthCheckItem,
  batchIngestCovers,
  consumeTokenFromUrlHash,
  deleteAdminCover,
  discoverGamesFromDb,
  fetchAdminCovers,
  getAdminMe,
  getStoredToken,
  healthCheckCovers,
  qualifyImageUrl,
  setStoredToken,
  syncAllCovers,
  updateAdminCover,
} from './api.ts';
import { LoginView } from './components/LoginView.tsx';
import { CoverEditorPanel } from './components/CoverEditorPanel.tsx';

export default function App() {
  const [user, setUser] = useState<AdminUserInfo | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [covers, setCovers] = useState<AdminCoverItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [query, setQuery] = useState<string>('');
  const [filter, setFilter] = useState<CoverFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [healthMap, setHealthMap] = useState<Record<string, HealthCheckItem>>({});

  const [bannerMsg, setBannerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Add new game modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newKey, setNewKey] = useState<string>('');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newSteamId, setNewSteamId] = useState<string>('');

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCovers = useCallback(
    async (qText = query, activeFilter = filter) => {
      setLoading(true);
      try {
        const apiFilter = activeFilter === 'broken' ? 'all' : activeFilter;
        const res = await fetchAdminCovers({
          query: qText.trim(),
          filter: apiFilter,
          limit: 150,
          offset: 0,
        });
        setCovers(res.covers || []);
        setTotal(res.total || 0);
        if (res.stats) setStats(res.stats);
      } catch (err: any) {
        setBannerMsg({ type: 'err', text: err?.message || 'Không tải được danh sách game' });
      } finally {
        setLoading(false);
      }
    },
    [query, filter]
  );

  const verifySession = useCallback(async () => {
    setAuthChecking(true);
    setAuthError(null);
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setAuthChecking(false);
      return;
    }
    try {
      const me = await getAdminMe();
      setUser(me.user);
      setStats(me.stats);
      await loadCovers('', 'all');
    } catch (err: any) {
      setStoredToken(null);
      setUser(null);
      setAuthError(err?.message || 'Phiên đăng nhập không hợp lệ hoặc không có quyền Admin');
    } finally {
      setAuthChecking(false);
    }
  }, [loadCovers]);

  useEffect(() => {
    consumeTokenFromUrlHash();
    verifySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchChange = (val: string) => {
    setQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      loadCovers(val, filter);
    }, 300);
  };

  const handleFilterChange = (next: CoverFilter) => {
    setFilter(next);
    loadCovers(query, next);
  };

  const handleDiscover = async () => {
    setBusyAction('discover');
    try {
      const res = await discoverGamesFromDb();
      setBannerMsg({
        type: 'ok',
        text: `🔍 Đã quét toàn DB server: thêm ${res.discovered} game mới vào Master Catalog (Tổng: ${res.totalCovers}).`,
      });
      await loadCovers(query, filter);
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Lỗi quét DB' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleHealthScan = async () => {
    if (covers.length === 0) return;
    setBusyAction('health');
    try {
      const keys = covers.map((c) => c.game_key);
      const nextMap: Record<string, HealthCheckItem> = { ...healthMap };
      let checkedTotal = 0;
      let brokenCount = 0;
      let missingCount = 0;

      // Chunk by 15 games per request to respect Cloudflare Worker's 50-subrequest limit
      for (let i = 0; i < keys.length; i += 15) {
        const res = await healthCheckCovers({ gameKeys: keys.slice(i, i + 15) });
        checkedTotal += res.checked;
        for (const item of res.results) {
          nextMap[item.gameKey] = item;
          if (item.overall === 'broken') brokenCount++;
          if (item.overall === 'missing') missingCount++;
        }
      }
      setHealthMap(nextMap);
      setBannerMsg({
        type: brokenCount > 0 ? 'err' : 'ok',
        text: `🩺 Đã kiểm tra ${checkedTotal} game: ${brokenCount} game lỗi ảnh (404/Dead), ${missingCount} game thiếu ảnh.`,
      });
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Lỗi Health Scan' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleBatchIngest = async () => {
    setBusyAction('ingest');
    try {
      let totalProcessed = 0;
      let totalFixed = 0;
      for (let round = 0; round < 6; round++) {
        const res = await batchIngestCovers({ limit: 10 });
        totalProcessed += res.processed;
        totalFixed += res.fixed;
        if (res.processed === 0 || res.fixed === 0) break;
      }
      setBannerMsg({
        type: 'ok',
        text: `☁️ Auto-Ingest xong (${totalProcessed} lượt kiểm tra): đã lưu bền vững ${totalFixed} game lên Cloud.`,
      });
      await loadCovers(query, filter);
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Lỗi Auto-Ingest' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncAll = async () => {
    setBusyAction('syncall');
    try {
      const res = await syncAllCovers();
      setBannerMsg({
        type: 'ok',
        text: `🔄 Đã đồng bộ ${res.gamesSynced} Master Covers sang toàn bộ server (${res.syncStats.userLibraryUpdated} library, ${res.syncStats.ratingsUpdated} reviews, ${res.syncStats.picksUpdated + res.syncStats.votesUpdated} picks/votes).`,
      });
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Lỗi đồng bộ toàn server' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (gameKey: string) => {
    if (!window.confirm(`Xóa "${gameKey}" khỏi Master Catalog?`)) return;
    try {
      await deleteAdminCover(gameKey);
      if (selectedKey === gameKey) setSelectedKey(null);
      setBannerMsg({ type: 'ok', text: `🗑️ Đã xóa "${gameKey}" khỏi Master Catalog.` });
      await loadCovers(query, filter);
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Lỗi xóa game' });
    }
  };

  const handleAddGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setBusyAction('add');
    try {
      const cleanKey = newKey.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
      const res = await updateAdminCover(cleanKey, {
        title: newTitle.trim() || cleanKey,
        steamId: newSteamId.trim() ? Number(newSteamId.trim()) : null,
      });
      setShowAddModal(false);
      setNewKey('');
      setNewTitle('');
      setNewSteamId('');
      setSelectedKey(res.cover.game_key);
      setBannerMsg({ type: 'ok', text: `➕ Đã tạo "${res.cover.title}".` });
      await loadCovers(query, filter);
    } catch (err: any) {
      setBannerMsg({ type: 'err', text: err?.message || 'Lỗi tạo game mới' });
    } finally {
      setBusyAction(null);
    }
  };

  const visibleCovers = useMemo(() => {
    if (filter !== 'broken') return covers;
    return covers.filter((c) => {
      const h = healthMap[c.game_key];
      return h && (h.overall === 'broken' || h.overall === 'missing');
    });
  }, [covers, filter, healthMap]);

  const selectedCover = useMemo(
    () => covers.find((c) => c.game_key === selectedKey) || null,
    [covers, selectedKey]
  );

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0d13] text-[#8e95a5] gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
        <span className="text-sm">Đang kiểm tra phiên Admin...</span>
      </div>
    );
  }

  if (!user) {
    return <LoginView initialError={authError} onLoggedIn={verifySession} />;
  }

  return (
    <div className="min-h-screen bg-[#0b0d13] text-[#f1f3f7] flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-[#262b3d] bg-[#10131d]/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-red-500/20 border border-amber-500/30 text-amber-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-white">GameVault Web Admin</h1>
                <span className="rounded-full bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  Server Master
                </span>
              </div>
              <p className="text-[11px] text-[#8e95a5]">
                Quản lý thumbnail lỗi & đồng bộ toàn server Cloudflare D1
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex flex-col items-end text-right">
              <span className="text-xs font-semibold text-white">{user.displayName || 'Admin'}</span>
              <span className="text-[10px] text-[#8e95a5]">{user.email}</span>
            </div>
            <button
              onClick={() => loadCovers(query, filter)}
              disabled={loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#262b3d] bg-[#161a26] text-[#8e95a5] hover:text-white"
              title="Làm mới"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => {
                setStoredToken(null);
                setUser(null);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-[#262b3d] bg-[#161a26] px-2.5 py-1.5 text-xs font-semibold text-[#c6cde0] hover:border-red-500/40 hover:text-red-400"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 space-y-5">
        {/* Overview Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-xl border border-[#262b3d] bg-[#121520] p-3.5">
              <div className="text-[11px] text-[#8e95a5]">Master Catalog</div>
              <div className="text-xl font-bold text-white mt-0.5">{stats.totalCovers}</div>
              <div className="text-[10px] text-[#6f778c]">game đã đăng ký</div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
              <div className="text-[11px] text-emerald-300/80">Lưu Cloud (/api/images)</div>
              <div className="text-xl font-bold text-emerald-400 mt-0.5">{stats.cloudCovers}</div>
              <div className="text-[10px] text-emerald-300/60">đủ Poster & Banner</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
              <div className="text-[11px] text-amber-300/80">Thiếu Poster/Banner</div>
              <div className="text-xl font-bold text-amber-400 mt-0.5">{stats.missingCovers}</div>
              <div className="text-[10px] text-amber-300/60">cần bổ sung</div>
            </div>
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5">
              <div className="text-[11px] text-sky-300/80">Link ngoài chưa Cache</div>
              <div className="text-xl font-bold text-sky-400 mt-0.5">{stats.externalCovers}</div>
              <div className="text-[10px] text-sky-300/60">nên Auto-Ingest</div>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl border border-[#262b3d] bg-[#121520] p-3.5">
              <div className="text-[11px] text-[#8e95a5]">Dữ liệu Server</div>
              <div className="text-xl font-bold text-white mt-0.5">{stats.libraryGamesCount}</div>
              <div className="text-[10px] text-[#6f778c]">
                library • {stats.reviewsCount} reviews • {stats.storedImagesCount} ảnh
              </div>
            </div>
          </div>
        )}

        {/* Alert Banner */}
        {bannerMsg && (
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs ${
              bannerMsg.type === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {bannerMsg.type === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{bannerMsg.text}</span>
            </div>
            <button onClick={() => setBannerMsg(null)} className="hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Action Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-[#262b3d] bg-[#121520] p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['all', 'Tất cả'],
                ['missing', 'Thiếu ảnh'],
                ['external', 'Link ngoài'],
                ['cloud', 'Đã lưu Cloud'],
                ['broken', 'Lỗi (Health Scan)'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handleFilterChange(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  filter === key
                    ? 'bg-amber-500 text-black'
                    : 'bg-[#181c2b] text-[#a5adc2] hover:bg-[#22273a] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDiscover}
              disabled={busyAction !== null}
              className="flex items-center gap-1.5 rounded-lg border border-[#262b3d] bg-[#181c2b] hover:bg-[#22273a] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              title="Tìm game từ bảng user_library, ratings, picks chưa có trong game_covers"
            >
              {busyAction === 'discover' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="h-3.5 w-3.5 text-purple-400" />}
              <span>Quét từ Server DB</span>
            </button>

            <button
              onClick={handleHealthScan}
              disabled={busyAction !== null || covers.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 disabled:opacity-50"
              title="Kiểm tra 404 / ảnh lỗi của tối đa 60 game đang hiển thị"
            >
              {busyAction === 'health' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
              <span>Check ảnh lỗi</span>
            </button>

            <button
              onClick={handleBatchIngest}
              disabled={busyAction !== null}
              className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-300 disabled:opacity-50"
              title="Tải hàng loạt ảnh link ngoài / Steam CDN về lưu vĩnh viễn trên Cloud"
            >
              {busyAction === 'ingest' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
              <span>Auto-Ingest</span>
            </button>

            <button
              onClick={handleSyncAll}
              disabled={busyAction !== null}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-300 disabled:opacity-50"
              title="Ép đồng bộ toàn bộ Master Catalog sang mọi user_library, ratings, picks"
            >
              {busyAction === 'syncall' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
              <span>Sync Toàn Server</span>
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-bold text-black"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Thêm Game</span>
            </button>
          </div>
        </div>

        {/* Main Split Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Catalog */}
          <div className="lg:col-span-7 rounded-2xl border border-[#262b3d] bg-[#121520] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[#262b3d] bg-[#161a26] p-3.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8e95a5]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Tìm theo tên game, game_key hoặc Steam AppID..."
                  className="w-full rounded-xl border border-[#262b3d] bg-[#0b0d13] pl-9 pr-3 py-2 text-xs text-white placeholder-[#6f778c] outline-none focus:border-amber-400"
                />
              </div>
              <span className="text-xs text-[#8e95a5] whitespace-nowrap">
                Hiển thị <strong className="text-white">{visibleCovers.length}</strong> / {total}
              </span>
            </div>

            <div className="max-h-[68vh] overflow-y-auto p-3 space-y-2">
              {loading && covers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#8e95a5] gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
                  <span className="text-xs">Đang tải Master Catalog...</span>
                </div>
              ) : visibleCovers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#8e95a5] gap-2 text-center">
                  <Globe className="h-8 w-8 text-[#2a3044]" />
                  <span className="text-xs font-semibold text-white">Không có game nào khớp</span>
                  <span className="text-[11px] text-[#6f778c]">
                    Thử bấm "Quét từ Server DB" hoặc đổi bộ lọc.
                  </span>
                </div>
              ) : (
                visibleCovers.map((item) => {
                  const isSelected = selectedKey === item.game_key;
                  const h = healthMap[item.game_key];
                  const thumb = qualifyImageUrl(item.cover_url);
                  const isCloudPoster = Boolean(item.cover_url?.startsWith('/api/images/'));
                  const isCloudBanner = Boolean(item.banner_url?.startsWith('/api/images/'));

                  return (
                    <div
                      key={item.game_key}
                      onClick={() => setSelectedKey(item.game_key)}
                      className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition ${
                        isSelected
                          ? 'border-amber-400/80 bg-amber-500/10'
                          : 'border-[#262b3d] bg-[#161a26] hover:border-[#3c4460]'
                      }`}
                    >
                      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-[#262b3d] bg-[#0b0d13] flex items-center justify-center">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <span className="text-[9px] text-[#60677a]">No img</span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-white">
                            {item.title || item.game_key}
                          </span>
                          {item.steam_id && (
                            <span className="rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                              Steam {item.steam_id}
                            </span>
                          )}
                          {h && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${
                                h.overall === 'healthy'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                  : h.overall === 'external'
                                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/25'
                                    : 'bg-red-500/10 text-red-400 border-red-500/25'
                              }`}
                            >
                              {h.overall === 'healthy'
                                ? 'OK'
                                : h.overall === 'external'
                                  ? 'Link ngoài'
                                  : h.overall === 'missing'
                                    ? 'Thiếu ảnh'
                                    : 'Ảnh lỗi!'}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[#8e95a5]">
                          <code className="rounded bg-[#0b0d13] px-1.5 py-0.5 text-[#b5bdd2]">
                            {item.game_key}
                          </code>
                          <span className={isCloudPoster ? 'text-emerald-400' : item.cover_url ? 'text-sky-300' : 'text-amber-400'}>
                            Poster: {isCloudPoster ? 'Cloud ✓' : item.cover_url ? 'External' : 'Thiếu'}
                          </span>
                          <span>•</span>
                          <span className={isCloudBanner ? 'text-emerald-400' : item.banner_url ? 'text-sky-300' : 'text-amber-400'}>
                            Banner: {isCloudBanner ? 'Cloud ✓' : item.banner_url ? 'External' : 'Thiếu'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Sticky Editor */}
          <div className="lg:col-span-5 lg:sticky lg:top-20">
            <CoverEditorPanel
              cover={selectedCover}
              health={selectedCover ? healthMap[selectedCover.game_key] : undefined}
              onUpdated={(updated, msg) => {
                setBannerMsg({ type: 'ok', text: msg });
                setCovers((prev) =>
                  prev.map((c) => (c.game_key === updated.game_key ? updated : c))
                );
                loadCovers(query, filter);
              }}
              onDeleted={handleDelete}
              onHealthChecked={(item) =>
                setHealthMap((prev) => ({ ...prev, [item.gameKey]: item }))
              }
              onError={(msg) => setBannerMsg({ type: 'err', text: msg })}
            />
          </div>
        </div>
      </main>

      {/* Add New Game Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#262b3d] bg-[#131620] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="h-4 w-4 text-amber-400" />
                <span>Thêm Game vào Master Catalog</span>
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-[#8e95a5] hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAddGame} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8e95a5] mb-1">
                  Game Key *
                </label>
                <input
                  required
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="VD: 2358720 hoặc t_black_myth_wukong"
                  className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-3 py-2 text-xs text-white font-mono outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8e95a5] mb-1">Tên Game</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Black Myth: Wukong"
                  className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-3 py-2 text-xs text-white outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8e95a5] mb-1">
                  Steam App ID (nếu có)
                </label>
                <input
                  type="number"
                  value={newSteamId}
                  onChange={(e) => setNewSteamId(e.target.value)}
                  placeholder="2358720"
                  className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-3 py-2 text-xs text-white outline-none focus:border-amber-400"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-[#262b3d] px-3.5 py-1.5 text-xs font-semibold text-[#a5adc2]"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'add'}
                  className="rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-1.5 text-xs font-bold text-black disabled:opacity-50"
                >
                  {busyAction === 'add' ? 'Đang tạo...' : 'Tạo & Sửa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
