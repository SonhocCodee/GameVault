import React, { useEffect, useRef, useState } from 'react';
import {
  Edit3,
  Sparkles,
  Image as ImageIcon,
  Upload,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Activity,
  Trash2,
  AlertTriangle,
  Crop,
} from 'lucide-react';
import { ImageCropModal } from './ImageCropModal.tsx';
import {
  type AdminCoverItem,
  type HealthCheckItem,
  type IgdbCandidate,
  type PropagationStats,
  qualifyImageUrl,
  updateAdminCover,
  uploadAdminCoverFile,
  syncAllCovers,
  healthCheckCovers,
  searchIgdbCovers,
} from '../api.ts';

interface CoverEditorPanelProps {
  cover: AdminCoverItem | null;
  health?: HealthCheckItem;
  onUpdated: (updated: AdminCoverItem, message: string) => void;
  onDeleted: (gameKey: string) => void;
  onHealthChecked: (item: HealthCheckItem) => void;
  onError: (msg: string) => void;
}

function formatSyncSummary(stats?: PropagationStats): string {
  if (!stats) return '';
  const total =
    stats.userLibraryUpdated + stats.ratingsUpdated + stats.picksUpdated + stats.votesUpdated;
  if (total === 0) return 'Đã lưu Master Catalog.';
  return `Đồng bộ toàn server: ${stats.userLibraryUpdated} library, ${stats.ratingsUpdated} reviews, ${stats.picksUpdated + stats.votesUpdated} picks/votes.`;
}

function toAdminPreviewUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const igdbMatch = rawUrl.match(
    /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/(t_cover_big_2x|t_cover_big|t_1080p|t_720p)\/([a-z0-9_]{4,32}\.jpg)$/i
  );
  if (igdbMatch) {
    return `/api/admin/igdb-image/${igdbMatch[1]}/${igdbMatch[2]}`;
  }
  return qualifyImageUrl(rawUrl);
}

export const CoverEditorPanel: React.FC<CoverEditorPanelProps> = ({
  cover,
  health,
  onUpdated,
  onDeleted,
  onHealthChecked,
  onError,
}) => {
  const [title, setTitle] = useState<string>('');
  const [steamId, setSteamId] = useState<string>('');
  const [posterUrl, setPosterUrl] = useState<string>('');
  const [bannerUrl, setBannerUrl] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [uploadingType, setUploadingType] = useState<'poster' | 'banner' | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [igdbLoading, setIgdbLoading] = useState<boolean>(false);
  const [igdbResults, setIgdbResults] = useState<IgdbCandidate[] | null>(null);
  const [posterBroken, setPosterBroken] = useState<boolean>(false);
  const [bannerBroken, setBannerBroken] = useState<boolean>(false);
  const [cropTarget, setCropTarget] = useState<{
    type: 'poster' | 'banner';
    sourceUrl: string;
    originalFile?: File | null;
    isObjectUrl?: boolean;
  } | null>(null);

  const posterInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cover) return;
    setTitle(cover.title || '');
    setSteamId(cover.steam_id ? String(cover.steam_id) : '');
    setPosterUrl(cover.cover_url || '');
    setBannerUrl(cover.banner_url || '');
    setPosterBroken(false);
    setBannerBroken(false);
    setIgdbResults(null);
  }, [cover]);

  if (!cover) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-[#262b3d] bg-[#121520] p-8 text-center text-[#8e95a5] gap-3">
        <Edit3 className="h-10 w-10 text-[#2e344a]" />
        <h3 className="text-sm font-bold text-white">Chọn một game để sửa & đồng bộ ảnh</h3>
        <p className="text-xs max-w-xs text-[#6f778c]">
          Mọi thay đổi ở đây sẽ cập nhật vào Master Catalog và đồng bộ sang toàn bộ User Library, Reviews & Community Picks.
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateAdminCover(cover.game_key, {
        title: title.trim() || cover.game_key,
        steamId: steamId.trim() ? Number(steamId.trim()) : null,
        coverUrl: posterUrl.trim() || null,
        bannerUrl: bannerUrl.trim() || null,
      });
      setPosterBroken(false);
      setBannerBroken(false);
      onUpdated(res.cover, `✅ Đã cập nhật "${res.cover.title}". ${formatSyncSummary(res.syncStats)}`);
    } catch (err: any) {
      onError(err?.message || 'Không lưu được thay đổi');
    } finally {
      setSaving(false);
    }
  };

  const openFileCropper = (type: 'poster' | 'banner', file?: File | null) => {
    if (!file) return;
    if (file.type === 'image/gif') {
      handleFileUpload(type, file);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setCropTarget({
      type,
      sourceUrl: objectUrl,
      originalFile: file,
      isObjectUrl: true,
    });
  };

  const openCropFromBanner = () => {
    const src = qualifyImageUrl(bannerUrl);
    if (!src) {
      onError('Chưa có ảnh Banner để cắt thành Poster');
      return;
    }
    setCropTarget({
      type: 'poster',
      sourceUrl: src,
      originalFile: null,
      isObjectUrl: false,
    });
  };

  const handleFileUpload = async (type: 'poster' | 'banner', file?: File | null) => {
    if (!file) return;
    setUploadingType(type);
    try {
      const res = await uploadAdminCoverFile(cover.game_key, type, file, {
        title: title.trim() || cover.title,
        steamId: steamId.trim() ? Number(steamId.trim()) : cover.steam_id,
      });
      if (type === 'poster') {
        setPosterUrl(res.url);
        setPosterBroken(false);
      } else {
        setBannerUrl(res.url);
        setBannerBroken(false);
      }
      onUpdated(
        res.cover,
        `✅ Upload ${type === 'poster' ? 'Poster' : 'Banner'} thành công! ${formatSyncSummary(res.syncStats)}`
      );
    } catch (err: any) {
      onError(err?.message || `Lỗi upload ${type}`);
    } finally {
      setUploadingType(null);
    }
  };

  const handleFillSteam = () => {
    const id = steamId.trim() || (cover.steam_id ? String(cover.steam_id) : '');
    if (!id) {
      onError('Nhập Steam App ID trước để nạp ảnh từ Steam CDN');
      return;
    }
    setPosterUrl(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900_2x.jpg`);
    setBannerUrl(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`);
    setPosterBroken(false);
    setBannerBroken(false);
  };

  const handleCheckHealth = async () => {
    setChecking(true);
    try {
      const res = await healthCheckCovers({ gameKeys: [cover.game_key] });
      if (res.results[0]) {
        onHealthChecked(res.results[0]);
      }
    } catch (err: any) {
      onError(err?.message || 'Lỗi kiểm tra URL');
    } finally {
      setChecking(false);
    }
  };

  const handleForceSyncOne = async () => {
    setSyncing(true);
    try {
      const res = await syncAllCovers(cover.game_key);
      onUpdated(cover, `🔄 Đã ép đồng bộ "${cover.title}". ${formatSyncSummary(res.syncStats)}`);
    } catch (err: any) {
      onError(err?.message || 'Lỗi đồng bộ game');
    } finally {
      setSyncing(false);
    }
  };

  const handleIgdbLookup = async () => {
    setIgdbLoading(true);
    try {
      const res = await searchIgdbCovers(title.trim() || cover.title || cover.game_key, steamId.trim() ? Number(steamId.trim()) : null);
      if (!res.configured) {
        onError(res.message || 'Chưa cấu hình TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET trên Worker.');
        setIgdbResults(null);
        return;
      }
      setIgdbResults(res.results || []);
      if (!res.results?.length) {
        onError(`Không tìm thấy "${title || cover.game_key}" trên IGDB.`);
      }
    } catch (err: any) {
      onError(err?.message || 'Lỗi tra cứu IGDB');
    } finally {
      setIgdbLoading(false);
    }
  };

  const renderDropZone = (
    type: 'poster' | 'banner',
    url: string,
    setUrl: (v: string) => void,
    broken: boolean,
    setBroken: (b: boolean) => void,
    inputRef: React.RefObject<HTMLInputElement | null>
  ) => {
    const isPoster = type === 'poster';
    const previewSrc = toAdminPreviewUrl(url);
    const healthStatus = isPoster ? health?.poster : health?.banner;

    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f && f.type.startsWith('image/')) {
            openFileCropper(type, f);
          }
        }}
        className="rounded-xl border border-[#262b3d] bg-[#161a26] p-3.5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className={`h-4 w-4 ${isPoster ? 'text-amber-400' : 'text-sky-400'}`} />
            <span className="text-xs font-bold text-white">
              {isPoster ? 'Poster (2:3)' : 'Banner Hero (16:9)'}
            </span>
            {healthStatus && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                  healthStatus.status === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : healthStatus.status === 'external_ok'
                      ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                      : 'bg-red-500/10 text-red-400 border-red-500/30'
                }`}
              >
                {healthStatus.status === 'ok'
                  ? 'Cloud OK'
                  : healthStatus.status === 'external_ok'
                    ? 'Link ngoài'
                    : healthStatus.reason || 'Lỗi'}
              </span>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFileCropper(type, f);
              e.target.value = '';
            }}
          />
          <div className="flex items-center gap-1.5">
            {isPoster && bannerUrl && !bannerBroken && (
              <button
                type="button"
                disabled={uploadingType !== null}
                onClick={openCropFromBanner}
                className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1 text-[11px] font-semibold text-sky-300 transition disabled:opacity-50"
                title="Cắt một phần từ ảnh Banner 16:9 hiện tại thành Poster 2:3"
              >
                <Crop className="h-3 w-3" />
                <span>Cắt từ Banner</span>
              </button>
            )}
            <button
              type="button"
              disabled={uploadingType !== null}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg bg-[#262b3d] hover:bg-[#353c54] px-2.5 py-1 text-[11px] font-semibold text-white transition disabled:opacity-50"
            >
              {uploadingType === type ? (
                <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
              ) : (
                <Upload className="h-3 w-3 text-amber-400" />
              )}
              <span>Chọn / Kéo ảnh</span>
            </button>
          </div>
        </div>

        <div className={isPoster ? 'flex gap-3' : 'space-y-2.5'}>
          <div
            className={`${
              isPoster ? 'h-32 w-22 shrink-0' : 'h-28 w-full'
            } overflow-hidden rounded-lg border border-[#262b3d] bg-[#0b0d13] flex items-center justify-center relative`}
          >
            {previewSrc && !broken ? (
              <img
                src={previewSrc}
                alt={type}
                className="h-full w-full object-cover"
                onError={() => setBroken(true)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 text-center p-2">
                {broken ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <span className="text-[10px] text-red-400">Ảnh lỗi</span>
                  </>
                ) : (
                  <span className="text-[10px] text-[#60677a]">Chưa có ảnh</span>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col justify-between gap-1.5">
            <textarea
              rows={isPoster ? 3 : 2}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setBroken(false);
              }}
              placeholder="Dán link ảnh https://... hoặc /api/images/..."
              className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] p-2 text-[11px] text-white font-mono outline-none focus:border-amber-400 resize-none"
            />
            {url && (
              <button
                type="button"
                onClick={() => {
                  setUrl('');
                  setBroken(false);
                }}
                className="self-start text-[10px] text-red-400 hover:underline"
              >
                Xóa link {isPoster ? 'poster' : 'banner'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col rounded-2xl border border-[#262b3d] bg-[#121520] overflow-hidden">
      <div className="border-b border-[#262b3d] bg-[#161a26] p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-amber-400" />
            <span className="truncate max-w-[260px]">{cover.title || cover.game_key}</span>
          </h3>
          <p className="text-[11px] text-[#8e95a5] mt-0.5">
            Key: <code className="text-amber-300 font-mono">{cover.game_key}</code>
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCheckHealth}
            disabled={checking}
            className="flex items-center gap-1 rounded-lg border border-[#262b3d] bg-[#0d1018] px-2.5 py-1 text-[11px] font-semibold text-[#c6cde0] hover:text-white disabled:opacity-50"
            title="Kiểm tra link ảnh hiện tại"
          >
            {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3 text-emerald-400" />}
            <span>Check</span>
          </button>
          <button
            type="button"
            onClick={handleIgdbLookup}
            disabled={igdbLoading}
            className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-[11px] font-semibold text-purple-300 hover:bg-purple-500/20 disabled:opacity-50"
            title="Tìm poster 2:3 & banner chuẩn từ IGDB (Twitch)"
          >
            {igdbLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            <span>IGDB</span>
          </button>
          <button
            type="button"
            onClick={handleFillSteam}
            className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20"
            title="Điền link gốc từ Steam CDN"
          >
            <Sparkles className="h-3 w-3" />
            <span>Steam CDN</span>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-[#8e95a5] mb-1">Tên Game</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-3 py-1.5 text-xs text-white outline-none focus:border-amber-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8e95a5] mb-1">Steam ID</label>
            <input
              type="number"
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              placeholder="2358720"
              className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-3 py-1.5 text-xs text-white outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {igdbResults && igdbResults.length > 0 && (
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-purple-300">
              <span>Kết quả từ IGDB (bấm để chọn ảnh):</span>
              <button onClick={() => setIgdbResults(null)} className="text-[#8e95a5] hover:text-white">Đóng</button>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {igdbResults.map((cand) => (
                <button
                  key={cand.id}
                  type="button"
                  onClick={() => {
                    if (cand.posterUrl) {
                      setPosterUrl(cand.posterUrl);
                      setPosterBroken(false);
                    }
                    if (cand.bannerUrl) {
                      setBannerUrl(cand.bannerUrl);
                      setBannerBroken(false);
                    }
                    setIgdbResults(null);
                  }}
                  className="flex items-center gap-2.5 rounded-lg border border-[#262b3d] bg-[#121520] p-2 text-left hover:border-purple-400 transition"
                >
                  <div className="h-14 w-10 rounded bg-[#0b0d13] border border-[#262b3d] overflow-hidden shrink-0 flex items-center justify-center">
                    {cand.posterUrl ? (
                      <img
                        src={toAdminPreviewUrl(cand.posterUrl) || cand.posterUrl}
                        referrerPolicy="no-referrer"
                        alt={cand.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-[9px] text-[#60677a]">No img</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-[11px] text-white font-semibold line-clamp-2">{cand.name}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[#8e95a5]">
                      <span>{cand.posterUrl ? 'Poster ✓' : 'No poster'}</span>
                      <span>•</span>
                      <span>{cand.bannerUrl ? 'Banner ✓' : 'No banner'}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {renderDropZone('poster', posterUrl, setPosterUrl, posterBroken, setPosterBroken, posterInputRef)}
        {renderDropZone('banner', bannerUrl, setBannerUrl, bannerBroken, setBannerBroken, bannerInputRef)}
      </div>

      <div className="border-t border-[#262b3d] bg-[#161a26] p-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleForceSyncOne}
            disabled={syncing || saving}
            className="flex items-center gap-1.5 rounded-lg border border-[#262b3d] bg-[#0d1018] px-3 py-2 text-xs font-semibold text-[#c6cde0] hover:text-white disabled:opacity-50"
            title="Đẩy cover hiện tại sang toàn bộ user_library, ratings, picks"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync bảng khác</span>
          </button>
          <button
            type="button"
            onClick={() => onDeleted(cover.game_key)}
            className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20"
            title="Xóa khỏi Master Catalog"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-red-500 hover:from-amber-400 hover:to-red-400 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-amber-500/20 transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <span>Lưu & Đồng bộ toàn Server</span>
        </button>
      </div>

      {cropTarget && (
        <ImageCropModal
          sourceUrl={cropTarget.sourceUrl}
          targetType={cropTarget.type}
          originalFile={cropTarget.originalFile}
          onConfirm={(croppedFile) => handleFileUpload(cropTarget.type, croppedFile)}
          onUploadOriginal={
            cropTarget.originalFile
              ? (origFile) => handleFileUpload(cropTarget.type, origFile)
              : undefined
          }
          onClose={() => {
            if (cropTarget.isObjectUrl) {
              URL.revokeObjectURL(cropTarget.sourceUrl);
            }
            setCropTarget(null);
          }}
        />
      )}
    </div>
  );
};
