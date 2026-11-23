import React, { useState, useEffect } from 'react';
import {
  X,
  Image as ImageIcon,
  Check,
  LayoutTemplate,
  Loader2,
  AlertCircle,
  FolderOpen,
  Sparkles,
  Undo2,
  Search,
  Globe,
} from 'lucide-react';
import type { Game, MediaItem, WebImageCandidate, GoogleConfig } from '../../shared/types.js';
import { formatDisplayUrl } from './GameCard';

export interface CoverArtModalProps {
  game: Game;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedGame: Game) => void;
}

type TargetType = 'poster' | 'banner';

interface UndoEntry {
  /** Field values BEFORE the change — written back on undo. */
  values: Partial<Game>;
  label: string;
}

export const CoverArtModal: React.FC<CoverArtModalProps> = ({
  game,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [targetType, setTargetType] = useState<TargetType>('poster');

  // Auto fetch state
  const [autoLoading, setAutoLoading] = useState(false);
  const [appIdFallback, setAppIdFallback] = useState(false);
  const [appIdInput, setAppIdInput] = useState('');

  // Web image search (Google CSE) state
  const [webCandidates, setWebCandidates] = useState<WebImageCandidate[] | null>(null);
  const [webLoading, setWebLoading] = useState(false);
  const [brokenWebUrls, setBrokenWebUrls] = useState<Set<string>>(new Set());
  const [showGoogleForm, setShowGoogleForm] = useState(false);
  const [googleKeyInput, setGoogleKeyInput] = useState('');
  const [googleCseInput, setGoogleCseInput] = useState('');
  const [googleCfg, setGoogleCfg] = useState<GoogleConfig | null>(null);

  // IGDB (chuẩn poster 2:3) state
  const [showIgdbForm, setShowIgdbForm] = useState(false);
  const [igdbIdInput, setIgdbIdInput] = useState('');
  const [igdbSecretInput, setIgdbSecretInput] = useState('');

  // Undo state
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  // Current-cover preview state
  const [previewError, setPreviewError] = useState(false);

  // Screenshots state
  const [screenshots, setScreenshots] = useState<MediaItem[]>([]);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<MediaItem | null>(null);
  const [visibleScreenshotCount, setVisibleScreenshotCount] = useState<number>(30);

  // General state
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentUrl = targetType === 'poster' ? game.cover_url : game.banner_url;
  const previewSrc = formatDisplayUrl(currentUrl, { thumb: true, width: 400 });

  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg(null);
    setSelectedScreenshot(null);
    setVisibleScreenshotCount(30);
    setAppIdFallback(false);
    setAppIdInput('');
    setUndoStack([]);
    setPreviewError(false);
    setWebCandidates(null);
    setWebLoading(false);
    setShowGoogleForm(false);
    setShowIgdbForm(false);
    setBrokenWebUrls(new Set());

    // Fetch local screenshots for picker
    if (window.electronAPI?.getGameMedia) {
      setScreenshotsLoading(true);
      window.electronAPI
        .getGameMedia(game.title)
        .then((items) => {
          const images = items.filter((i) => i.type === 'image');
          setScreenshots(images);
        })
        .catch((err) => console.error('Failed to load screenshots:', err))
        .finally(() => setScreenshotsLoading(false));
    }
  }, [isOpen, game.title, game.steam_id]);

  // Reset preview error whenever the underlying URL or target changes;
  // web candidates were searched for a different slot → clear them too
  useEffect(() => {
    setPreviewError(false);
    setWebCandidates(null);
  }, [currentUrl, targetType]);

  if (!isOpen) return null;

  /**
   * Writes fields via db:updateGame and records the previous values on the
   * undo stack. The modal stays open so the user can judge the result and
   * hit "Hoàn tác" if unsatisfied.
   */
  const applyUpdates = async (updates: Partial<Game>, label: string) => {
    if (!window.electronAPI?.updateGame) return null;
    const prev: Partial<Game> = {};
    for (const key of Object.keys(updates) as Array<keyof Game>) {
      (prev as unknown as Record<string, unknown>)[key] =
        (game as unknown as Record<string, unknown>)[key] ?? null;
    }
    const updated = await window.electronAPI.updateGame(game.id, updates);
    setUndoStack((stack) => [...stack, { values: prev, label }]);
    onSuccess(updated);
    return updated;
  };

  const runAutoFetch = async (appIdOverride?: number) => {
    setAutoLoading(true);
    setErrorMsg(null);
    try {
      const steamIdArg =
        appIdOverride ?? (typeof game.steam_id === 'number' && game.steam_id > 0 ? game.steam_id : undefined);
      const res = await window.electronAPI.searchSteamCovers(game.title, steamIdArg);
      const url =
        targetType === 'poster' ? res.posterUrl || res.poster : res.bannerUrl || res.banner;
      if (!url) {
        if (res.appId) {
          // Game exists on Steam but this slot's art doesn't exist yet
          // (unreleased / freshly announced games lack vertical art)
          setErrorMsg(
            `"${game.title}" có trên Steam (AppID ${res.appId}) nhưng chưa có ảnh ${
              targetType === 'poster' ? 'dọc 2:3' : 'ngang 16:9'
            } — thường do game chưa ra mắt hoặc mới announced. Chọn "Ảnh trong máy" bên dưới để dùng ảnh của bạn.`
          );
        } else {
          setAppIdFallback(true);
          setErrorMsg(
            `Không tìm thấy "${game.title}" trên Steam — game có thể không bán trên Steam. Dùng "Ảnh trong máy" bên dưới, hoặc nhập AppID thủ công nếu bạn biết.`
          );
        }
        void tryWebSearch();
        // IGDB là nguồn poster 2:3 chuẩn — nếu chưa cấu hình thì hiện form
        window.electronAPI?.getIgdbConfig?.().then((cfg) => {
          if (!cfg?.clientId || !cfg?.clientSecret) setShowIgdbForm(true);
        }).catch(() => {});
        return;
      }

      const updates: Partial<Game> =
        targetType === 'poster' ? { cover_url: url } : { banner_url: url };
      // Persist the resolved AppID so future lookups skip the network search
      if (res.appId && res.appId > 0 && game.steam_id !== res.appId) {
        updates.steam_id = res.appId;
      }
      await applyUpdates(updates, targetType === 'poster' ? 'poster tự động' : 'banner tự động');
      setAppIdFallback(false);
      setAppIdInput('');
    } catch (err: any) {
      setAppIdFallback(true);
      setErrorMsg(err?.message || 'Không thể lấy ảnh tự động từ Steam');
    } finally {
      setAutoLoading(false);
    }
  };

  const handleRetryWithAppId = async () => {
    const id = parseInt(appIdInput, 10);
    if (!Number.isFinite(id) || id <= 0) {
      setErrorMsg('AppID không hợp lệ — phải là số dương (vd: 1091500).');
      return;
    }
    await runAutoFetch(id);
  };

  /** Google CSE image search — runs automatically when Steam has no art. */
  const tryWebSearch = async () => {
    setWebLoading(true);
    try {
      const cfg = (await window.electronAPI?.getGoogleConfig?.()) ?? null;
      setGoogleCfg(cfg);
      if (!cfg?.apiKey || !cfg?.cseId) {
        setShowGoogleForm(true);
        setWebCandidates(null);
        return;
      }
      const items = await window.electronAPI.searchWebImages!(game.title, targetType);
      setWebCandidates(items);
      setBrokenWebUrls(new Set());
      if (!items.length) {
        setErrorMsg('Google Image Search không có kết quả nào cho từ khóa này.');
      }
    } catch (err: any) {
      setWebCandidates(null);
      setErrorMsg(err?.message || 'Lỗi tìm ảnh trên web');
      if (/API Key|cấu hình/i.test(err?.message || '')) setShowGoogleForm(true);
    } finally {
      setWebLoading(false);
    }
  };

  const handleSaveGoogleConfig = async () => {
    if (!googleKeyInput.trim() || !googleCseInput.trim()) {
      setErrorMsg('Cần nhập cả Google API Key và CSE ID.');
      return;
    }
    try {
      const cfg = await window.electronAPI.setGoogleConfig!(googleKeyInput.trim(), googleCseInput.trim());
      setGoogleCfg(cfg);
      setShowGoogleForm(false);
      setErrorMsg(null);
      await tryWebSearch();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi lưu cấu hình Google');
    }
  };

  const handleSaveIgdbConfig = async () => {
    if (!igdbIdInput.trim() || !igdbSecretInput.trim()) {
      setErrorMsg('Cần nhập cả Client ID và Client Secret.');
      return;
    }
    try {
      await window.electronAPI.setIgdbConfig!(igdbIdInput.trim(), igdbSecretInput.trim());
      setShowIgdbForm(false);
      setErrorMsg(null);
      // IGDB là nguồn poster chuẩn — chạy lại auto để áp ngay
      await runAutoFetch();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi lưu cấu hình IGDB');
    }
  };

  const handleApplyWebImage = async (url: string) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await applyUpdates(
        targetType === 'poster' ? { cover_url: url } : { banner_url: url },
        targetType === 'poster' ? 'poster từ web' : 'banner từ web'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi áp ảnh từ web');
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setErrorMsg(null);
    try {
      if (window.electronAPI?.updateGame) {
        const updated = await window.electronAPI.updateGame(game.id, last.values);
        onSuccess(updated);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể hoàn tác');
    }
  };

  /**
   * Picks one local screenshot and applies it to BOTH slots at once —
   * the app crops the same source into a 2:3 poster and a 16:9 banner.
   */
  const handleApplyScreenshot = async () => {
    if (!selectedScreenshot) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      if (window.electronAPI?.setCoverFromScreenshot) {
        const prevCover = game.cover_url ?? null;
        const prevBanner = game.banner_url ?? null;
        await window.electronAPI.setCoverFromScreenshot(game.id, 'poster', selectedScreenshot.path);
        await window.electronAPI.setCoverFromScreenshot(game.id, 'banner', selectedScreenshot.path);
        setUndoStack((stack) => [
          ...stack,
          {
            values: { cover_url: prevCover, banner_url: prevBanner },
            label: 'ảnh bìa + ảnh nền từ ảnh chụp',
          },
        ]);
        if (window.electronAPI.getGameById) {
          const updated = await window.electronAPI.getGameById(game.id);
          if (updated) onSuccess(updated);
        }
      } else {
        await applyUpdates(
          { cover_url: selectedScreenshot.url, banner_url: selectedScreenshot.url },
          'ảnh bìa + ảnh nền'
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi khi đặt ảnh chụp làm ảnh bìa');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[#2a2e3d] bg-[#161821] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] px-6 py-4 bg-[#0e1015]">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-[#ff2a44]" />
              <span>Đổi ảnh bìa / Banner: {game.title}</span>
            </h2>
            <p className="text-xs text-[#8e95a5]">
              Lấy ảnh tự động hoặc chọn ảnh trong máy bên dưới — đặt cả bìa lẫn nền, không ưng thì Hoàn tác
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#8e95a5] hover:bg-[#ff2a44]/20 hover:text-[#ff2a44] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Target Selection */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2a2e3d] px-6 py-3 bg-[#11131a]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#8e95a5]" title="Chỉ áp dụng cho nút Lấy ảnh tự động — ảnh trong máy bên dưới áp cho cả 2 slot">Áp dụng cho (ảnh tự động):</span>
            <div className="flex rounded-lg bg-[#0e1015] p-1 border border-[#2a2e3d]">
              <button
                onClick={() => setTargetType('poster')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition-all ${
                  targetType === 'poster'
                    ? 'bg-[#ff2a44] text-white shadow-sm'
                    : 'text-[#8e95a5] hover:text-[#f1f3f7]'
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                <span>Poster đứng (2:3)</span>
              </button>
              <button
                onClick={() => setTargetType('banner')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold transition-all ${
                  targetType === 'banner'
                    ? 'bg-[#ff2a44] text-white shadow-sm'
                    : 'text-[#8e95a5] hover:text-[#f1f3f7]'
                }`}
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                <span>Hero Banner ngang (16:9)</span>
              </button>
            </div>
          </div>

          {undoStack.length > 0 && (
            <span className="text-[10px] text-[#8e95a5]">
              Đã thay {undoStack.length} lần — có thể hoàn tác
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Current cover preview */}
          <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4">
            <div className="mb-2 text-xs font-bold text-[#f1f3f7]">
              Ảnh hiện tại:{' '}
              {targetType === 'poster' ? 'Poster (2:3)' : 'Hero Banner (16:9)'}
            </div>
            <div
              className="flex min-h-[140px] items-center justify-center overflow-hidden rounded-lg border border-[#2a2e3d] bg-[#161821] p-2"
            >
              {previewSrc && !previewError ? (
                // Show the art at its natural aspect ratio — Steam hero banners
                // are ~3.1:1, wider than 16:9, and object-cover would crop them
                <img
                  src={previewSrc}
                  alt={`Current ${targetType}`}
                  onError={() => setPreviewError(true)}
                  className="max-h-[440px] max-w-full w-auto rounded-md object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-1 py-10 text-xs text-[#8e95a5]">
                  <ImageIcon className="h-8 w-8 text-[#2a2e3d]" />
                  <span>{previewSrc ? 'Không tải được ảnh hiện tại' : 'Chưa có ảnh'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Two main actions + undo */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => runAutoFetch()}
              disabled={autoLoading || saving}
              title="Tự tìm ảnh trên Steam cho slot đang chọn ở trên"
              className="flex items-center gap-2 rounded-lg bg-[#ff2a44] px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#ff2a44]/25 hover:brightness-110 disabled:opacity-50"
            >
              {autoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span>Lấy ảnh tự động</span>
            </button>
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0 || autoLoading || saving}
              title={undoStack.length > 0 ? `Khôi phục: ${undoStack[undoStack.length - 1].label}` : 'Chưa có thay đổi nào để hoàn tác'}
              className="ml-auto flex items-center gap-2 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-4 py-2.5 text-xs font-bold text-[#8e95a5] hover:border-amber-500/60 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:hover:border-[#2a2e3d] disabled:hover:text-[#8e95a5]"
            >
              <Undo2 className="h-4 w-4" />
              <span>Hoàn tác</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => tryWebSearch()}
            disabled={autoLoading || saving || webLoading}
            className="self-start flex items-center gap-1 text-[10px] font-bold text-[#8e95a5] hover:text-[#ff2a44] transition-colors disabled:opacity-50"
          >
            <Globe className="h-3 w-3" />
            <span>Tìm ảnh trên web (Google) →</span>
          </button>

          {/* Hidden until auto-fetch fails: manual AppID escape hatch */}
          {appIdFallback && (
            <div className="flex items-center gap-2 rounded-lg border border-[#2a2e3d] bg-[#0e1015] p-3">
              <input
                type="number"
                value={appIdInput}
                onChange={(e) => setAppIdInput(e.target.value)}
                placeholder="Steam AppID (vd: 1091500)"
                className="w-56 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-2 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none focus:border-[#ff2a44]"
              />
              <button
                onClick={handleRetryWithAppId}
                disabled={autoLoading || !appIdInput}
                className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-4 py-2 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
              >
                {autoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                <span>Thử lại với AppID</span>
              </button>
            </div>
          )}

          {/* Web image search (Google CSE) — appears when Steam has no art for this slot */}
          {(webLoading || webCandidates || showGoogleForm) && (
            <div className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#f1f3f7] flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-[#8e95a5]" />
                  <span>Ảnh trên web — Google Image Search cho {targetType === 'poster' ? 'Poster' : 'Hero Banner'}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => tryWebSearch()}
                  disabled={webLoading}
                  className="flex items-center gap-1 rounded-md border border-[#2a2e3d] px-2 py-1 text-[10px] font-bold text-[#8e95a5] hover:text-white transition-colors disabled:opacity-50"
                >
                  {webLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  <span>Tìm lại</span>
                </button>
              </div>

              {webLoading && (
                <div className="flex h-20 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-[#ff2a44]" />
                </div>
              )}

              {!webLoading && webCandidates && webCandidates.length > 0 && (
                <div className="grid grid-cols-4 gap-2 max-h-[240px] overflow-y-auto pr-1">
                  {webCandidates
                    .filter((c) => !brokenWebUrls.has(c.url))
                    .map((c, i) => (
                      <div
                        key={c.url + i}
                        onClick={() => handleApplyWebImage(c.url)}
                        title={c.snippet || c.url}
                        className="group relative aspect-video cursor-pointer overflow-hidden rounded-lg border border-[#2a2e3d] bg-[#161821] hover:border-[#ff2a44] hover:ring-2 hover:ring-[#ff2a44]/40"
                      >
                        <img
                          src={c.url}
                          alt={`candidate ${i + 1}`}
                          loading="lazy"
                          onError={() => setBrokenWebUrls((prev) => new Set(prev).add(c.url))}
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-[#ff2a44]/25">
                          <Check className="h-5 w-5 text-white" />
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {!webLoading && webCandidates && webCandidates.length === 0 && !showGoogleForm && (
                <p className="text-xs text-[#8e95a5]">Không có kết quả — thử "Tìm lại" hoặc dùng ảnh trong máy.</p>
              )}

              {showIgdbForm && (
                <div className="space-y-2 rounded-lg border border-[#ff2a44]/30 bg-[#ff2a44]/5 p-3">
                  <p className="text-xs font-bold text-[#f1f3f7]">Nguồn poster chuẩn 2:3 — IGDB (khuyên dùng)</p>
                  <p className="text-[10px] leading-relaxed text-[#8e95a5]">
                    Tạo ứng dụng miễn phí tại{' '}
                    <span className="text-[#ff2a44]">dev.twitch.tv/console/apps/create</span> (Category: Other,
                    OAuth redirect: bất kỳ) → copy <strong>Client ID</strong> + <strong>Client Secret</strong> dán vào
                    đây. Mọi game — kể cả chưa ra mắt — sẽ có poster dọc 2:3 nét chuẩn.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={igdbIdInput}
                      onChange={(e) => setIgdbIdInput(e.target.value)}
                      placeholder="Client ID"
                      className="w-52 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-2 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none focus:border-[#ff2a44]"
                    />
                    <input
                      type="password"
                      value={igdbSecretInput}
                      onChange={(e) => setIgdbSecretInput(e.target.value)}
                      placeholder="Client Secret"
                      className="w-52 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-2 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none focus:border-[#ff2a44]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveIgdbConfig}
                      disabled={!igdbIdInput.trim() || !igdbSecretInput.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-4 py-2 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Lưu &amp; lấy poster</span>
                    </button>
                  </div>
                </div>
              )}

              {showGoogleForm && (
                <div className="space-y-2">
                  <p className="text-[10px] leading-relaxed text-[#8e95a5]">
                    Tạo Google API Key tại{' '}
                    <span className="text-[#ff2a44]">developers.google.com/custom-search/v1/introduction</span> và CSE ID
                    tại <span className="text-[#ff2a44]">cse.google.com/cse/all</span> (bật "Search entire web" + Image
                    search; miễn phí 100 lần/ngày) rồi dán vào đây:
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      value={googleKeyInput}
                      onChange={(e) => setGoogleKeyInput(e.target.value)}
                      placeholder="Google API Key (AIza...)"
                      className="w-60 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-2 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none focus:border-[#ff2a44]"
                    />
                    <input
                      value={googleCseInput}
                      onChange={(e) => setGoogleCseInput(e.target.value)}
                      placeholder="CSE ID (đã bật Search entire web)"
                      className="w-60 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-2 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none focus:border-[#ff2a44]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveGoogleConfig}
                      disabled={!googleKeyInput.trim() || !googleCseInput.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-4 py-2 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Lưu &amp; tìm</span>
                    </button>
                    {googleCfg?.apiKey && (
                      <span className="text-[10px] text-emerald-400">✓ Đã cấu hình</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Screenshots from the game's media folder (merged "local images") */}
          <div className="border-t border-[#2a2e3d] pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold text-[#f1f3f7] flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5 text-[#8e95a5]" />
                <span>Ảnh trong máy — E:\Game\{game.title}</span>
              </h3>
              <span className="text-[10px] text-emerald-400">⚡ Chọn 1 ảnh → đặt làm cả bìa lẫn nền, tự nén lưu SSD</span>
            </div>

            {screenshotsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-[#ff2a44]" />
              </div>
            ) : screenshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-6 text-center text-[#8e95a5]">
                <ImageIcon className="h-10 w-10 text-[#2a2e3d] mb-2" />
                <p className="text-xs">Chưa có ảnh chụp màn hình nào trong thư mục này</p>
                <button
                  type="button"
                  onClick={() => window.electronAPI?.openMediaFolder(game.title)}
                  className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#ff2a44]/50 bg-[#ff2a44]/15 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#ff2a44]"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-[#ff2a44]" />
                  <span>Mở thư mục ảnh để thêm ảnh</span>
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-[300px] overflow-y-auto pr-1">
                  {screenshots.slice(0, visibleScreenshotCount).map((s) => {
                    const isSelected = selectedScreenshot?.path === s.path;
                    const thumbUrl = s.url + (s.url.includes('?') ? '&' : '?') + 'thumb=1&w=360';
                    return (
                      <div
                        key={s.path}
                        onClick={() => setSelectedScreenshot(s)}
                        className={`group relative aspect-[16/9] cursor-pointer overflow-hidden rounded-lg border transition-all ${
                          isSelected
                            ? 'border-[#ff2a44] ring-2 ring-[#ff2a44]'
                            : 'border-[#2a2e3d] hover:border-white/50'
                        }`}
                      >
                        <img
                          src={thumbUrl}
                          alt={s.name}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                        {isSelected && (
                          <div className="absolute inset-0 flex items-center justify-center bg-[#ff2a44]/30 backdrop-blur-xs">
                            <Check className="h-6 w-6 text-white stroke-[3]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {screenshots.length > visibleScreenshotCount && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setVisibleScreenshotCount((prev) => prev + 30)}
                      className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-4 py-1.5 text-xs font-bold text-[#8e95a5] hover:text-white transition-colors"
                    >
                      Hiển thị thêm ảnh ({screenshots.length - visibleScreenshotCount} ảnh còn lại)
                    </button>
                  </div>
                )}

                {selectedScreenshot && (
                  <div className="mt-3 flex items-center justify-between border-t border-[#2a2e3d] pt-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`overflow-hidden rounded-md border border-[#ff2a44] bg-[#0e1015] shrink-0 ${
                          targetType === 'poster' ? 'aspect-[2/3] w-12' : 'aspect-[16/9] w-20'
                        }`}
                      >
                        <img
                          src={selectedScreenshot.url + (selectedScreenshot.url.includes('?') ? '&' : '?') + 'thumb=1&w=240'}
                          alt="Preview"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="truncate max-w-xs text-xs text-[#8e95a5]">
                        <span>Đã chọn: </span>
                        <strong className="text-white block truncate">{selectedScreenshot.name}</strong>
                        <span className="text-[10px] text-emerald-400">⚡ Sẽ tự động nén &amp; lưu vào SSD siêu tốc</span>
                      </div>
                    </div>
                    <button
                      onClick={handleApplyScreenshot}
                      disabled={saving}
                      title="Áp cho cả Poster (2:3) và Hero Banner (16:9) — tự crop từ cùng một ảnh nguồn"
                      className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-5 py-2 text-xs font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      <span>Đặt làm ảnh bìa + ảnh nền</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
