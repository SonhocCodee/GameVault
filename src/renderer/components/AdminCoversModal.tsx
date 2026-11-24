import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Search,
  RefreshCw,
  Loader2,
  ShieldCheck,
  Edit3,
  Trash2,
  Upload,
  Link as LinkIcon,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Plus,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import type { AdminCoverItem, AdminUpdateCoverPayload } from '../../shared/types.js';

interface AdminCoversModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCoversChanged?: () => void;
}

export const AdminCoversModal: React.FC<AdminCoversModalProps> = ({
  isOpen,
  onClose,
  onCoversChanged,
}) => {
  const [covers, setCovers] = useState<AdminCoverItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCover, setSelectedCover] = useState<AdminCoverItem | null>(null);

  // Edit form states
  const [editTitle, setEditTitle] = useState<string>('');
  const [editSteamId, setEditSteamId] = useState<string>('');
  const [editPosterUrl, setEditPosterUrl] = useState<string>('');
  const [editBannerUrl, setEditBannerUrl] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [uploadingPoster, setUploadingPoster] = useState<boolean>(false);
  const [uploadingBanner, setUploadingBanner] = useState<boolean>(false);

  // Add new game form
  const [showAddNew, setShowAddNew] = useState<boolean>(false);
  const [newGameKey, setNewGameKey] = useState<string>('');
  const [newGameTitle, setNewGameTitle] = useState<string>('');
  const [newSteamId, setNewSteamId] = useState<string>('');

  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchCovers = useCallback(async (query = '') => {
    setLoading(true);
    setError(null);
    try {
      if (!window.electronAPI?.adminGetCovers) {
        throw new Error('Tính năng Quản trị Bìa chưa sẵn sàng trên ứng dụng này.');
      }
      const res = await window.electronAPI.adminGetCovers({ query: query.trim(), limit: 100 });
      setCovers(res.covers || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      console.error('Error fetching admin covers:', err);
      setError(err?.message || 'Không thể tải danh sách bìa');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchCovers(searchQuery);
    } else {
      setSelectedCover(null);
      setError(null);
      setSuccessMsg(null);
    }
  }, [isOpen, fetchCovers]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      fetchCovers(val);
    }, 300);
  };

  const handleSelectForEdit = (item: AdminCoverItem) => {
    setSelectedCover(item);
    setEditTitle(item.title || '');
    setEditSteamId(item.steam_id ? String(item.steam_id) : '');
    setEditPosterUrl(item.cover_url || '');
    setEditBannerUrl(item.banner_url || '');
    setError(null);
    setSuccessMsg(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedCover) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const payload: AdminUpdateCoverPayload = {
        title: editTitle.trim(),
        steamId: editSteamId.trim() ? Number(editSteamId.trim()) : null,
        coverUrl: editPosterUrl.trim() || null,
        bannerUrl: editBannerUrl.trim() || null,
      };

      const res = await window.electronAPI.adminUpdateCover!(selectedCover.game_key, payload);
      if (res.success) {
        setSuccessMsg(`✅ Đã cập nhật thành công bìa game "${editTitle || selectedCover.game_key}"!`);
        if (res.cover) {
          setSelectedCover(res.cover);
        }
        await fetchCovers(searchQuery);
        onCoversChanged?.();
      }
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi lưu ảnh bìa');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCover = async (gameKey: string) => {
    if (!confirm(`Bạn có chắc muốn xóa bìa game "${gameKey}" khỏi Cloud Master Catalog?`)) return;
    setLoading(true);
    try {
      await window.electronAPI.adminDeleteCover!(gameKey);
      if (selectedCover?.game_key === gameKey) {
        setSelectedCover(null);
      }
      setSuccessMsg(`Đã xóa bìa game "${gameKey}" khỏi Cloud`);
      await fetchCovers(searchQuery);
      onCoversChanged?.();
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi xóa bìa game');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadFile = async (type: 'poster' | 'banner') => {
    if (!selectedCover) return;
    const isPoster = type === 'poster';
    if (isPoster) setUploadingPoster(true);
    else setUploadingBanner(true);
    setError(null);

    try {
      const url = await window.electronAPI.adminUploadCover!(
        selectedCover.game_key,
        type,
        undefined,
        {
          title: editTitle || selectedCover.title,
          steamId: editSteamId ? Number(editSteamId) : (selectedCover.steam_id || undefined),
        }
      );

      if (url) {
        if (isPoster) setEditPosterUrl(url);
        else setEditBannerUrl(url);
        setSuccessMsg(`✅ Đã tải file ảnh ${type === 'poster' ? 'Poster' : 'Banner'} lên Cloud thành công!`);
        await fetchCovers(searchQuery);
        onCoversChanged?.();
      }
    } catch (err: any) {
      setError(err?.message || `Lỗi tải file ảnh ${type}`);
    } finally {
      if (isPoster) setUploadingPoster(false);
      else setUploadingBanner(false);
    }
  };

  const handleFetchSteamImages = () => {
    const sId = editSteamId.trim() || (selectedCover?.steam_id ? String(selectedCover.steam_id) : '');
    if (!sId) {
      setError('Vui lòng nhập Steam App ID để nạp tự động từ Steam CDN');
      return;
    }
    const poster = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_600x900_2x.jpg`;
    const banner = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_hero.jpg`;
    setEditPosterUrl(poster);
    setEditBannerUrl(banner);
    setSuccessMsg('Đã điền link ảnh gốc từ Steam CDN. Bấm "Lưu thay đổi" để hệ thống tự động tải về lưu vĩnh viễn lên Cloud!');
  };

  const handleCreateNewGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGameKey.trim()) {
      setError('Vui lòng nhập Game Key');
      return;
    }
    setSaving(true);
    try {
      const cleanKey = newGameKey.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
      const res = await window.electronAPI.adminUpdateCover!(cleanKey, {
        title: newGameTitle.trim() || cleanKey,
        steamId: newSteamId.trim() ? Number(newSteamId.trim()) : null,
      });
      setShowAddNew(false);
      setNewGameKey('');
      setNewGameTitle('');
      setNewSteamId('');
      await fetchCovers(cleanKey);
      if (res.cover) {
        handleSelectForEdit(res.cover);
      }
      setSuccessMsg(`Đã tạo bản ghi bìa game "${cleanKey}"`);
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tạo bìa game mới');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-[#2a2e3d] bg-[#161821] shadow-2xl overflow-hidden text-[#f1f3f7]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] bg-[#1a1d28] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-red-500/20 border border-amber-500/30 text-amber-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">Quản trị Bìa Game (Cloud Master)</h2>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400 border border-amber-500/20">
                  Admin Master
                </span>
              </div>
              <p className="text-xs text-[#8e95a5]">
                Cập nhật và sửa ảnh bìa tập trung — Tất cả người dùng sẽ nhận cùng ảnh này từ Cloud.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddNew(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[#2a2e3d] hover:bg-[#34394c] px-3 py-1.5 text-xs font-semibold text-white transition-all shadow-sm"
              title="Thêm game mới vào Cloud Catalog"
            >
              <Plus className="h-3.5 w-3.5 text-amber-400" />
              <span>Thêm Game</span>
            </button>
            <button
              onClick={() => fetchCovers(searchQuery)}
              disabled={loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2a2e3d] bg-[#161821] text-[#8e95a5] hover:text-white transition-colors disabled:opacity-50"
              title="Làm mới"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2a2e3d] bg-[#161821] text-[#8e95a5] hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Notification Alerts */}
        {error && (
          <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Modal Body: Left column (Catalog List), Right column (Cover Editor) */}
        <div className="flex flex-1 overflow-hidden p-6 gap-6 min-h-0">
          {/* Left Column: Game Covers List */}
          <div className="flex flex-1 flex-col rounded-xl border border-[#2a2e3d] bg-[#11131a] overflow-hidden min-w-0">
            {/* Search Header */}
            <div className="flex items-center gap-2 border-b border-[#2a2e3d] p-3 bg-[#161821]/50">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8e95a5]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Tìm theo tên game hoặc game_key..."
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#8e95a5] outline-none focus:border-amber-400"
                />
              </div>
              <span className="text-[11px] text-[#8e95a5] whitespace-nowrap font-medium pr-1">
                Tổng: <strong className="text-white">{total}</strong>
              </span>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && covers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-[#8e95a5] gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
                  <span className="text-xs">Đang tải danh sách bìa từ Cloud...</span>
                </div>
              ) : covers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-[#8e95a5] gap-2 text-center p-4">
                  <ImageIcon className="h-8 w-8 text-[#2a2e3d]" />
                  <span className="text-xs font-semibold">Chưa có bìa game nào khớp</span>
                  <p className="text-[11px] text-[#606575]">
                    Thử tìm kiếm với từ khóa khác hoặc bấm "Thêm Game" để đăng ký mới.
                  </p>
                </div>
              ) : (
                covers.map((item) => {
                  const isSelected = selectedCover?.game_key === item.game_key;
                  return (
                    <div
                      key={item.game_key}
                      onClick={() => handleSelectForEdit(item)}
                      className={`group relative flex items-center gap-3 rounded-xl border p-2.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'border-amber-400/80 bg-amber-500/10 shadow-md shadow-amber-500/5'
                          : 'border-[#2a2e3d] bg-[#161821] hover:border-[#3d4358] hover:bg-[#1a1d28]'
                      }`}
                    >
                      {/* Mini Poster Preview */}
                      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-[#0e1015] border border-[#2a2e3d]">
                        {item.cover_url ? (
                          <img
                            src={item.cover_url}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] text-[#606575]">
                            No img
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-xs font-bold text-white group-hover:text-amber-300">
                            {item.title || item.game_key}
                          </h4>
                          {item.steam_id && (
                            <span className="rounded bg-sky-500/10 px-1.5 py-0.2 text-[10px] font-medium text-sky-400 border border-sky-500/20">
                              Steam: {item.steam_id}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#8e95a5] mt-0.5">
                          <code className="text-[#a0a5b5] bg-[#0e1015] px-1 py-0.5 rounded text-[10px]">
                            {item.game_key}
                          </code>
                          <span>•</span>
                          <span>
                            {item.cover_url ? 'Poster ✓' : 'Thiếu poster'} |{' '}
                            {item.banner_url ? 'Banner ✓' : 'Thiếu banner'}
                          </span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectForEdit(item);
                          }}
                          className="rounded p-1.5 text-[#8e95a5] hover:bg-[#2a2e3d] hover:text-white"
                          title="Chỉnh sửa bìa"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCover(item.game_key);
                          }}
                          className="rounded p-1.5 text-[#8e95a5] hover:bg-red-500/20 hover:text-red-400"
                          title="Xóa khỏi Cloud"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Cover Editor */}
          <div className="w-[480px] shrink-0 rounded-xl border border-[#2a2e3d] bg-[#11131a] flex flex-col overflow-hidden">
            {selectedCover ? (
              <div className="flex flex-col h-full overflow-y-auto">
                {/* Editor Header */}
                <div className="border-b border-[#2a2e3d] bg-[#161821] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                        <Edit3 className="h-4 w-4 text-amber-400" />
                        <span>Chỉnh sửa Bìa Game</span>
                      </h3>
                      <p className="text-[11px] text-[#8e95a5] mt-0.5">
                        Khóa game: <code className="text-white font-mono">{selectedCover.game_key}</code>
                      </p>
                    </div>

                    {selectedCover.steam_id && (
                      <button
                        type="button"
                        onClick={handleFetchSteamImages}
                        className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-400 hover:bg-sky-500/20 transition-all"
                        title="Tự động điền link ảnh độ nét cao từ Steam CDN"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Nạp từ Steam</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Form Inputs */}
                <div className="p-4 space-y-4 flex-1">
                  {/* Title & Steam ID */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-[#8e95a5] mb-1">
                        Tên Game:
                      </label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs text-white outline-none focus:border-amber-400"
                        placeholder="VD: Black Myth: Wukong"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8e95a5] mb-1">
                        Steam ID:
                      </label>
                      <input
                        type="number"
                        value={editSteamId}
                        onChange={(e) => setEditSteamId(e.target.value)}
                        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs text-white outline-none focus:border-amber-400"
                        placeholder="2358720"
                      />
                    </div>
                  </div>

                  {/* Poster (2:3) Section */}
                  <div className="rounded-xl border border-[#2a2e3d] bg-[#161821] p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <ImageIcon className="h-3.5 w-3.5 text-amber-400" />
                        <span>Poster (Tỷ lệ 2:3)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUploadFile('poster')}
                        disabled={uploadingPoster}
                        className="flex items-center gap-1 rounded bg-[#2a2e3d] hover:bg-[#3d4358] px-2 py-1 text-[11px] font-semibold text-white transition disabled:opacity-50"
                      >
                        {uploadingPoster ? (
                          <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
                        ) : (
                          <Upload className="h-3 w-3 text-amber-400" />
                        )}
                        <span>Upload File</span>
                      </button>
                    </div>

                    <div className="flex gap-3">
                      {/* Preview Box */}
                      <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-[#0e1015] border border-[#2a2e3d] flex items-center justify-center">
                        {editPosterUrl ? (
                          <img
                            src={editPosterUrl}
                            alt="Poster Preview"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.opacity = '0.3';
                            }}
                          />
                        ) : (
                          <span className="text-[10px] text-[#606575]">Chưa có</span>
                        )}
                      </div>

                      {/* URL input */}
                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <label className="block text-[10px] text-[#8e95a5] mb-1">
                            URL ảnh (Hệ thống tự lưu về Cloud):
                          </label>
                          <textarea
                            rows={3}
                            value={editPosterUrl}
                            onChange={(e) => setEditPosterUrl(e.target.value)}
                            placeholder="Dán link ảnh https://... hoặc /api/images/..."
                            className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] p-2 text-[11px] text-white outline-none focus:border-amber-400 resize-none font-mono"
                          />
                        </div>
                        {editPosterUrl && (
                          <button
                            type="button"
                            onClick={() => setEditPosterUrl('')}
                            className="self-start text-[10px] text-red-400 hover:underline"
                          >
                            Xóa link ảnh
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Banner (16:9) Section */}
                  <div className="rounded-xl border border-[#2a2e3d] bg-[#161821] p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <ImageIcon className="h-3.5 w-3.5 text-sky-400" />
                        <span>Banner Hero (Tỷ lệ 16:9)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUploadFile('banner')}
                        disabled={uploadingBanner}
                        className="flex items-center gap-1 rounded bg-[#2a2e3d] hover:bg-[#3d4358] px-2 py-1 text-[11px] font-semibold text-white transition disabled:opacity-50"
                      >
                        {uploadingBanner ? (
                          <Loader2 className="h-3 w-3 animate-spin text-sky-400" />
                        ) : (
                          <Upload className="h-3 w-3 text-sky-400" />
                        )}
                        <span>Upload File</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {/* Banner Preview Box */}
                      <div className="h-24 w-full overflow-hidden rounded-lg bg-[#0e1015] border border-[#2a2e3d] flex items-center justify-center">
                        {editBannerUrl ? (
                          <img
                            src={editBannerUrl}
                            alt="Banner Preview"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.opacity = '0.3';
                            }}
                          />
                        ) : (
                          <span className="text-[10px] text-[#606575]">Chưa có banner</span>
                        )}
                      </div>

                      {/* URL input */}
                      <div>
                        <label className="block text-[10px] text-[#8e95a5] mb-1">
                          URL Banner (Hệ thống tự lưu về Cloud):
                        </label>
                        <input
                          type="text"
                          value={editBannerUrl}
                          onChange={(e) => setEditBannerUrl(e.target.value)}
                          placeholder="Dán link banner https://... hoặc /api/images/..."
                          className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-sky-400 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="border-t border-[#2a2e3d] bg-[#161821] p-4 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleSelectForEdit(selectedCover)}
                    disabled={saving}
                    className="text-xs text-[#8e95a5] hover:text-white"
                  >
                    Khôi phục
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-red-500 hover:from-amber-400 hover:to-red-400 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    <span>Lưu thay đổi vào Cloud</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center text-[#8e95a5] gap-3">
                <Edit3 className="h-10 w-10 text-[#2a2e3d]" />
                <h4 className="text-sm font-bold text-white">Chọn một game để chỉnh sửa</h4>
                <p className="text-xs text-[#606575] max-w-xs">
                  Chọn bất kỳ game nào từ danh sách bên trái để cập nhật Poster 2:3 hoặc Banner 16:9.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Add New Game Dialog Modal */}
        {showAddNew && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="h-5 w-5 text-amber-400" />
                  <span>Thêm Game mới vào Cloud Catalog</span>
                </h3>
                <button
                  onClick={() => setShowAddNew(false)}
                  className="text-[#8e95a5] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleCreateNewGame} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8e95a5] mb-1">
                    Game Key (Khóa định danh): <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newGameKey}
                    onChange={(e) => setNewGameKey(e.target.value)}
                    placeholder="VD: 2358720 (nếu là Steam) hoặc t_black_myth_wukong"
                    className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white outline-none focus:border-amber-400 font-mono"
                  />
                  <span className="text-[10px] text-[#606575] mt-0.5 block">
                    Ghi chú: Nếu là game Steam, nên điền chính xác Steam App ID (VD: 1086940).
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8e95a5] mb-1">
                    Tên Game:
                  </label>
                  <input
                    type="text"
                    value={newGameTitle}
                    onChange={(e) => setNewGameTitle(e.target.value)}
                    placeholder="VD: Baldur's Gate 3"
                    className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8e95a5] mb-1">
                    Steam App ID (nếu có):
                  </label>
                  <input
                    type="number"
                    value={newSteamId}
                    onChange={(e) => setNewSteamId(e.target.value)}
                    placeholder="1086940"
                    className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white outline-none focus:border-amber-400"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddNew(false)}
                    className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-4 py-2 text-xs font-semibold text-[#8e95a5] hover:text-white"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-bold text-black shadow transition disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span>Tạo mới & Chỉnh sửa</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
