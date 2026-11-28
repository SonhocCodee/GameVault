import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PerformancePanel } from '../community/PerformancePanel.tsx';
import { ScreenshotShare } from '../community/ScreenshotShare.tsx';
import { gameToPublic } from '../community/DesktopCommunity.tsx';
import { ConfirmModal } from './ConfirmModal.js';
import type { PublicGame } from '../../shared/community.ts';
import {
  ArrowLeft,
  Clock,
  Star,
  Trophy,
  FolderOpen,
  Zap,
  Image as ImageIcon,
  Film,
  Calendar,
  Save,
  Check,
  Edit3,
  Play,
  RotateCcw,
  Sliders,
  History,
  FileText,
  Loader2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Trash2,
  BookmarkCheck,
  MessageSquareText,
  Users,
  HardDrive,
  LayoutGrid
} from 'lucide-react';
import { formatScore } from '../community/CommunityWidgets.tsx';
import type { Game, GameStatus, MediaItem, Session } from '../../shared/types.js';
import { formatPlaytime, getStatusMeta } from './GameCard.js';
import { Lightbox } from './Lightbox.js';
import { VideoPlayer } from './VideoPlayer.js';
import { CoverArtModal } from './CoverArtModal.js';
import { SaveVaultSection } from './SaveVaultSection.js';

export interface GameDetailProps {
  gameId: number;
  onBack: () => void;
  onGameUpdated: (updatedGame: Game) => void;
  onOpenCommunity?: (game: PublicGame) => void;
  onShowToast?: (msg: string) => void;
}

export const formatDisplayUrl = (
  url?: string | null,
  options?: { thumb?: boolean; width?: number }
): string | undefined => {
  if (!url) return undefined;
  let finalUrl = url;
  if (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('game-media://') &&
    !url.startsWith('data:')
  ) {
    const normalized = url.replace(/\\/g, '/');
    finalUrl = `game-media://local/${encodeURIComponent(normalized)}`;
  }

  if (options?.thumb && finalUrl.startsWith('game-media://')) {
    const w = options.width || 480;
    const separator = finalUrl.includes('?') ? '&' : '?';
    return `${finalUrl}${separator}thumb=1&w=${w}`;
  }

  return finalUrl;
};

export const GameDetail: React.FC<GameDetailProps> = ({
  gameId,
  onBack,
  onGameUpdated,
  onOpenCommunity,
  onShowToast,
}) => {
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [syncingF6, setSyncingF6] = useState<boolean>(false);

  // Active detail tab
  const [activeTab, setActiveTab] = useState<'overview' | 'saves'>('overview');

  useEffect(() => {
    setActiveTab('overview');
  }, [gameId]);

  // Media Gallery state
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaFolderPath, setMediaFolderPath] = useState<string>('');
  const [mediaLoading, setMediaLoading] = useState<boolean>(false);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video'>('all');
  const [visibleCount, setVisibleCount] = useState<number>(36);

  // Interactive Viewers
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [activeVideo, setActiveVideo] = useState<MediaItem | null>(null);
  const [coverModalOpen, setCoverModalOpen] = useState<boolean>(false);

  // Manual Playtime Edit Modal
  const [editPlaytimeOpen, setEditPlaytimeOpen] = useState<boolean>(false);
  const [editHours, setEditHours] = useState<number>(0);
  const [editMins, setEditMins] = useState<number>(0);
  const [editPlaytimeError, setEditPlaytimeError] = useState('');

  // Notes state
  const [notesText, setNotesText] = useState<string>('');
  const [notesSaved, setNotesSaved] = useState<boolean>(false);
  const [reviewSyncMessage, setReviewSyncMessage] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const showReviewSync = (updated: Game) => {
    if (updated.user_rating == null) {
      setReviewSyncMessage(updated.reviewSync?.state === 'synced'
        ? 'Đã lưu trên máy và máy chủ. Chấm điểm từ 1 đến 10 để đăng cảm nhận và tham gia Top game.'
        : 'Đã lưu trên máy. Chấm điểm từ 1 đến 10 để đăng cảm nhận; mở Cộng đồng để đồng bộ lại khi có mạng.');
      return;
    }
    const result = updated.reviewSync;
    setReviewSyncMessage(result?.state === 'synced'
      ? 'Đã lưu trên máy và máy chủ.'
      : result?.state === 'signed_out'
        ? 'Đã lưu trên máy. Đăng nhập để đồng bộ đánh giá lên máy chủ.'
        : 'Đã lưu trên máy; chưa gửi được lên máy chủ. Mở Cộng đồng để đồng bộ lại.');
  };

  // Status & Rating state
  const [status, setStatus] = useState<GameStatus>('playing');
  const [rating, setRating] = useState<number | null>(null);
  const [completedDate, setCompletedDate] = useState<string>('');

  // Fetch Game Details & Media
  const loadGameData = useCallback(async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.getGameById) {
        const fetched = await window.electronAPI.getGameById(gameId);
        if (fetched) {
          setGame(fetched);
          setStatus(fetched.status);
          setRating(fetched.user_rating ?? null);
          setNotesText(fetched.notes || '');
          setCompletedDate(fetched.completed_at ? fetched.completed_at.slice(0, 10) : '');
          setEditHours(Math.floor((fetched.playtime_minutes || 0) / 60));
          setEditMins(Math.round((fetched.playtime_minutes || 0) % 60));

          // Load Media
          loadMedia(fetched.title);

          // Load Media Folder Path — wishlist ('Chờ chơi') games have no folder yet
          if (fetched.status === 'backlog') {
            setMediaFolderPath('');
          } else if (window.electronAPI?.getMediaFolderPath) {
            window.electronAPI.getMediaFolderPath(fetched.title).then((res) => {
              if (res?.fullPath) setMediaFolderPath(res.fullPath);
            }).catch(() => {});
          } else {
            setMediaFolderPath(`E:\\Game\\${fetched.title}`);
          }

          // Load Sessions
          if (window.electronAPI.getSessions) {
            const sess = await window.electronAPI.getSessions(fetched.id);
            setSessions(sess);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load game details:', err);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  const loadMedia = async (title: string) => {
    setMediaLoading(true);
    try {
      if (window.electronAPI?.getGameMedia) {
        const media = await window.electronAPI.getGameMedia(title);
        setMediaItems(media);
      }
    } catch (err) {
      console.error('Failed to fetch media for', title, err);
    } finally {
      setMediaLoading(false);
    }
  };
const latestMediaDate = useMemo(() => {
    if (!mediaItems || mediaItems.length === 0) return null;
    const item = mediaItems[0];
    const raw = item.captureDate || item.createdAt;
    return raw ? raw.slice(0, 10) : null;
  }, [mediaItems]);

  // Tổng hợp FPS của game từ các phiên đã đo (weighted theo số frame sample)
  const gameFpsStats = useMemo(() => {
    const measured = sessions.filter((s) => s.fps_avg != null && s.fps_avg > 0 && (s.fps_samples ?? 0) > 0);
    if (measured.length === 0) return null;
    const totalSamples = measured.reduce((acc, s) => acc + (s.fps_samples || 0), 0);
    const avg = measured.reduce((acc, s) => acc + s.fps_avg! * (s.fps_samples || 0), 0) / totalSamples;
    const lows = measured.filter((s) => s.fps_1pct_low != null && s.fps_1pct_low > 0);
    const low1pct = lows.length > 0
      ? lows.reduce((acc, s) => acc + s.fps_1pct_low! * (s.fps_samples || 0), 0) / totalSamples
      : null;
    return {
      avg,
      low1pct,
      best: Math.max(...measured.map((s) => s.fps_avg!)),
      worst: Math.min(...measured.map((s) => s.fps_avg!)),
      sessions: measured.length,
    };
  }, [sessions]);

  useEffect(() => {
    loadGameData();
  }, [loadGameData]);

  // Handle ESC key to return
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIndex !== null || activeVideo !== null || coverModalOpen || editPlaytimeOpen) return;
      if (e.key === 'Escape') {
        onBack();
      }
    };
window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack, lightboxIndex, activeVideo, coverModalOpen, editPlaytimeOpen]);

  // Auto-save rating
  const handleRatingChange = async (newRating: number | null) => {
    const finalRating = newRating !== null && newRating > 0 ? newRating : null;
    setRating(finalRating);
    if (!game) return;
    try {
      if (window.electronAPI?.updateGame) {
        const updated = await window.electronAPI.updateGame(game.id, { user_rating: finalRating });
        showReviewSync(updated);
        setGame(updated);
        onGameUpdated(updated);
      }
    } catch (err) {
      console.error('Failed to save rating:', err);
    }
  };
  // Status changes preserve the existing completion date; only an explicit date selection changes it.
  const handleStatusChange = async (newStatus: GameStatus) => {
    setStatus(newStatus);
    if (!game) return;

    try {
      if (window.electronAPI?.updateGame) {
        const updated = await window.electronAPI.updateGame(game.id, {
          status: newStatus,
        });
        setGame(updated);
        onGameUpdated(updated);
      }
    } catch (err) {
      console.error('Failed to save status:', err);
    }
  };
const handleCompletedDateChange = async (dateStr: string) => {
    setCompletedDate(dateStr);
    if (!game) return;
    try {
      if (window.electronAPI?.updateGame) {
        const updated = await window.electronAPI.updateGame(game.id, {
          completed_at: dateStr ? `${dateStr}T00:00:00` : null,
        });
        setGame(updated);
        onGameUpdated(updated);
      }
    } catch (err) {
      console.error('Failed to update completed date:', err);
    }
  };
// Save Review / Notes
  const handleSaveNotes = async () => {
    if (!game) return;
    setSavingNotes(true);
    try {
      if (window.electronAPI?.updateGame) {
        const updated = await window.electronAPI.updateGame(game.id, { notes: notesText });
        showReviewSync(updated);
        setGame(updated);
        onGameUpdated(updated);
        setNotesSaved(true);
        setTimeout(() => setNotesSaved(false), 2000);
      }
    } catch (err) {
      console.error('Failed to save notes:', err);
      setReviewSyncMessage('Không lưu được cảm nhận. Hãy thử lại.');
    } finally { setSavingNotes(false); }
  };
// Manual Playtime Save
  const handleSaveManualPlaytime = async () => {
    if (!game) return;
    const totalMinutes = editHours * 60 + editMins;
    setEditPlaytimeError('');
    if (totalMinutes < recordedMinutes) {
      setEditPlaytimeError(`Tổng giờ chơi không thể thấp hơn ${formatPlaytime(recordedMinutes)} đã được ghi nhận.`);
      return;
    }
    try {
      if (window.electronAPI?.updatePlaytimeManual) {
        await window.electronAPI.updatePlaytimeManual(game.id, totalMinutes);
      } else if (window.electronAPI?.updateGame) {
        await window.electronAPI.updateGame(game.id, { playtime_minutes: totalMinutes });
      }

      if (window.electronAPI?.getGameById) {
        const updated = await window.electronAPI.getGameById(game.id);
        if (updated) {
          setGame(updated);
          onGameUpdated(updated);
        }
      }
      setEditPlaytimeOpen(false);
    } catch (err) {
      console.error('Failed to update playtime manual:', err);
      setEditPlaytimeError(err instanceof Error ? err.message : 'Không lưu được giờ chơi. Hãy thử lại.');
    }
  };
// Open Media Folder in Explorer
  const handleOpenFolder = async () => {
    if (!game || game.status === 'backlog') return; // wishlist: no folder on disk
    try {
      if (window.electronAPI?.openMediaFolder) {
        await window.electronAPI.openMediaFolder(game.title);
      }
    } catch (err) {
      console.error('Failed to open media folder:', err);
    }
  };
// Trigger F6 screenshot sync
  const handleTriggerSync = async () => {
    if (!game || syncingF6) return;
    setSyncingF6(true);
    try {
      if (window.electronAPI?.syncScreenshots) {
        const res = await window.electronAPI.syncScreenshots({ dryRun: false, targetGameId: game.id });
        await loadMedia(game.title);
        if (window.electronAPI?.getGameById) {
          const fresh = await window.electronAPI.getGameById(game.id);
          if (fresh) {
            setGame(fresh);
            onGameUpdated(fresh);
          }
        }

        // Tự động kích hoạt đồng bộ Drive ngay lập tức
        if (window.electronAPI?.uploadMediaToDrive) {
          window.electronAPI.uploadMediaToDrive({ gameTitle: game.title }).catch(console.error);
        }

        if (res && res.moved > 0) {
          onShowToast?.(`📸 Đã gom ${res.moved} ảnh vào ổ E: & tự động đẩy lên Google Drive thành công!`);
        } else {
          onShowToast?.(`✨ Toàn bộ ảnh của "${game.title}" đã được lưu trên ổ E: & Google Drive!`);
        }
      }
    } catch (err: any) {
      console.error('Failed to trigger sync:', err);
      onShowToast?.(`❌ Lỗi đồng bộ ảnh: ${err?.message || 'Không xác định'}`);
    } finally {
      setSyncingF6(false);
    }
  };

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Delete Game
  const handleDeleteGame = () => {
    if (!game) return;
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteGame = async () => {
    if (!game) return;
    setDeleteConfirmOpen(false);
    if (window.electronAPI?.deleteGame) {
      await window.electronAPI.deleteGame(game.id);
      onBack();
    }
  };
const filteredMedia = useMemo(() => {
    if (mediaFilter === 'all') return mediaItems;
    return mediaItems.filter((m) => m.type === mediaFilter);
  }, [mediaItems, mediaFilter]);

  const displayedMedia = useMemo(() => {
    return filteredMedia.slice(0, visibleCount);
  }, [filteredMedia, visibleCount]);

  useEffect(() => {
    setVisibleCount(36);
  }, [mediaFilter, gameId]);

  const imageCount = useMemo(() => mediaItems.filter((m) => m.type === 'image').length, [mediaItems]);
  const videoCount = useMemo(() => mediaItems.filter((m) => m.type === 'video').length, [mediaItems]);

  const ratingLabel = useMemo(() => {
    if (rating === null || rating <= 0) return 'Chưa chấm điểm (Sẽ không tính vào xếp hạng)';
    if (rating >= 9.5) return 'Tuyệt tác bất hủ (Masterpiece)';
    if (rating >= 8.5) return 'Cực kỳ xuất sắc (Excellent)';
    if (rating >= 7.0) return 'Rất hay (Great)';
    if (rating >= 5.0) return 'Khá ổn (Decent)';
    return 'Dưới trung bình (Mediocre)';
  }, [rating]);

  if (loading || !game) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff2a44]" />
      </div>
    );
  }

  const statusMeta = getStatusMeta(status);
  const totalMinutes = Math.max(0, Number(game.playtime_minutes) || 0);
  const recordedValue = Number(game.recorded_playtime_minutes ?? totalMinutes);
  const recordedMinutes = Number.isFinite(recordedValue)
    ? Math.min(totalMinutes, Math.max(0, recordedValue))
    : totalMinutes;
  const manualMinutes = Math.max(0, totalMinutes - recordedMinutes);
  const playtimeExplanation = `Tổng giờ chơi: ${formatPlaytime(totalMinutes)}. App ghi nhận / dữ liệu cũ được giữ lại: ${formatPlaytime(recordedMinutes)}. Nhập thủ công: ${formatPlaytime(manualMinutes)}. Giờ nhập thủ công không tính vào bảng xếp hạng.`;

  return (
    <div className="min-h-screen pb-20 select-none animate-in fade-in duration-200">
      {/* 16:9 Cinematic Hero Banner */}
      <div className="relative aspect-[16/9] max-h-[460px] w-full overflow-hidden bg-[#0e1015]">
        {formatDisplayUrl(game.banner_url) ? (
          <img src={formatDisplayUrl(game.banner_url)} alt={game.title} className="h-full w-full object-cover" />
        ) : formatDisplayUrl(game.cover_url) ? (
          <img src={formatDisplayUrl(game.cover_url)} alt={game.title} className="h-full w-full object-cover blur-md scale-110 opacity-40" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-[#1f2230] to-[#0e1015]" />
        )}

        {/* Multi-stop smooth dark gradient fade to blend into background */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e1015] via-[#0e1015]/60 to-black/40" />

        {/* Top Floating Bar: Back Button & Quick Actions */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-xl bg-black/60 px-4 py-2 text-xs font-bold text-white backdrop-blur-md transition-all hover:bg-[#ff2a44] border border-white/10 shadow-lg"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>← Quay lại Thư viện (ESC)</span>
          </button>

          <button
            onClick={() => setCoverModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-black/60 px-4 py-2 text-xs font-bold text-white backdrop-blur-md transition-all hover:bg-[#ff2a44] border border-white/10 shadow-lg"
          >
            <ImageIcon className="h-4 w-4" />
            <span>🖼️ Đổi ảnh bìa / Banner</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="mx-auto max-w-7xl px-6">
        {/* Floating Poster & Header Section */}
        <div className="relative -mt-28 md:-mt-36 flex flex-col md:flex-row items-start gap-8 z-10">
          {/* 2:3 Vertical Floating Poster */}
          <div className="aspect-[2/3] w-48 sm:w-56 md:w-64 shrink-0 overflow-hidden rounded-2xl border-2 border-[#2a2e3d] bg-[#161821] shadow-2xl shadow-black/80">
            {formatDisplayUrl(game.cover_url) ? (
              <img src={formatDisplayUrl(game.cover_url)} alt={game.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-[#8e95a5]">
                <ImageIcon className="h-12 w-12 text-[#ff2a44] mb-2" />
                <span className="text-xs font-bold text-[#f1f3f7]">{game.title}</span>
              </div>
            )}
          </div>

          {/* Details & Actions Header */}
          <div className="flex-1 pt-4 md:pt-14 space-y-4">
            {/* Title & Executable */}
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">{game.title}</h1>
                <div
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold backdrop-blur-md ${statusMeta.colorClass}`}
                >
                  {statusMeta.icon}
                  <span>{statusMeta.label}</span>
                </div>
              </div>

              {/* Thư mục ảnh & File thực thi */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs">
                <div className="flex items-center gap-2 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 font-mono shadow-inner">
                  <FolderOpen className="h-4 w-4 text-[#ff2a44] shrink-0" />
                  <span className="text-[#8e95a5] font-sans font-medium">Thư mục ảnh:</span>
                  <span className="font-bold text-[#f1f3f7] selection:bg-[#ff2a44] selection:text-white" title={mediaFolderPath || `E:\\Game\\${game.title}`}>
                    {mediaFolderPath || `E:\\Game\\${game.title}`}
                  </span>
                  <button
                    type="button"
                    onClick={handleOpenFolder}
                    className="ml-2 flex items-center gap-1 rounded bg-[#ff2a44] px-2.5 py-1 text-[11px] font-bold text-white shadow transition-all hover:brightness-110 active:scale-95"
                    title="Mở thư mục ảnh trong Windows Explorer"
                  >
                    <FolderOpen className="h-3 w-3" />
                    <span>Mở thư mục ảnh</span>
                  </button>
                </div>

                {game.exe_name && (
                  <div
                    className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d]/70 bg-[#161821] px-2.5 py-1.5 text-[11px] text-[#8e95a5]"
                    title={game.exe_path ? `Đường dẫn đầy đủ: ${game.exe_path}` : undefined}
                  >
                    <span>File chạy:</span>
                    <span className="font-mono text-[#f1f3f7]">{game.exe_name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Playtime & Actions */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <div className="flex items-center gap-2 rounded-xl border border-[#2a2e3d] bg-[#161821] px-4 py-2.5">
                <Clock className="h-5 w-5 text-[#ff2a44]" />
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-[#8e95a5]">
                    <span>Tổng thời gian chơi</span>
                    {manualMinutes > 0 && <button
                      type="button"
                      title={playtimeExplanation}
                      aria-label={playtimeExplanation}
                      className="rounded text-amber-400 outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>}
                  </div>
                  <div className="font-mono text-base font-black text-white">
                    {formatPlaytime(game.playtime_minutes)}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditHours(Math.floor(totalMinutes / 60));
                    setEditMins(Math.round(totalMinutes % 60));
                    setEditPlaytimeError('');
                    setEditPlaytimeOpen(true);
                  }}
                  className="ml-2 p-1 text-[#8e95a5] hover:text-[#ff2a44] transition-colors"
                  title="Chỉnh sửa giờ chơi thủ công"
                >
                  <Edit3 className="h-4 w-4" />
                </button>
              </div>

              {/* Action: Open E:\Game folder — wishlist games have no folder yet */}
              {game.status !== 'backlog' ? (
                <button
                  onClick={handleOpenFolder}
                  className="flex items-center gap-2 rounded-xl border border-[#ff2a44]/50 bg-[#ff2a44]/15 px-4 py-3 text-xs font-bold text-white shadow transition-all hover:bg-[#ff2a44] hover:shadow-[0_0_15px_rgba(255,42,68,0.35)]"
                  title={`Mở thư mục lưu trữ ảnh trong File Explorer: ${mediaFolderPath || `E:\\Game\\${game.title}`}`}
                >
                  <FolderOpen className="h-4 w-4 text-[#ff2a44]" />
                  <span>📂 Mở thư mục ảnh Explorer</span>
                </button>
              ) : (
                <div
                  className="flex items-center gap-2 rounded-xl border border-purple-400/40 bg-purple-600/10 px-4 py-3 text-xs font-bold text-purple-300"
                  title="Game wishlist chỉ có ảnh bìa & banner — thư mục ảnh sẽ tự tạo khi bạn bắt đầu chơi"
                >
                  <BookmarkCheck className="h-4 w-4" />
                  <span>📌 Wishlist — chưa có thư mục ảnh</span>
                </div>
              )}

              {/* Action: Sync F6 — not applicable to wishlist games */}
              {game.status !== 'backlog' && (
                <button
                  onClick={handleTriggerSync}
                  disabled={syncingF6}
                  className="flex items-center gap-2 rounded-xl border border-[#2a2e3d] bg-[#161821] px-4 py-3 text-xs font-bold text-white transition-all hover:border-amber-400 hover:bg-[#1f2230] disabled:opacity-50"
                  title="Cut ảnh chụp F6 từ C: sang E:\Game và tự động đẩy lên Google Drive"
                >
                  {syncingF6 ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                      <span>Đang gom &amp; đẩy lên Drive...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 text-amber-400" />
                      <span>⚡ Đồng bộ ảnh F6 &amp; Drive</span>
                    </>
                  )}
                </button>
              )}

              {/* Action: Open Community Reviews & Details */}
              {onOpenCommunity && (
                <button
                  onClick={() => onOpenCommunity(gameToPublic(game))}
                  className="flex items-center gap-2 rounded-xl border border-sky-400/50 bg-sky-500/15 px-4 py-3 text-xs font-bold text-sky-200 shadow transition-all hover:bg-sky-500 hover:text-white hover:shadow-[0_0_15px_rgba(56,189,248,0.35)]"
                  title="Mở trang điểm số, đánh giá và thông tin game trên Cộng đồng"
                >
                  <MessageSquareText className="h-4 w-4 text-sky-300" />
                  <span>Xem điểm &amp; Đánh giá cộng đồng</span>
                </button>
              )}

              {/* Action: Delete Game */}
              <button
                onClick={handleDeleteGame}
                className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-bold text-rose-400 transition-all hover:border-rose-500 hover:bg-rose-500 hover:text-white"
                title="Xóa game khỏi thư viện GameVault"
              >
                <Trash2 className="h-4 w-4" />
                <span>🗑️ Xóa game</span>
              </button>
            </div>
          </div>
        </div>

        {/* Detail View Tab Bar */}
        <div className="mt-8 flex items-center gap-2 border-b border-[#2a2e3d] pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeTab === 'overview'
                ? 'bg-[#ff2a44] text-white shadow-md shadow-[#ff2a44]/25'
                : 'border border-[#2a2e3d] bg-[#161821] text-[#8e95a5] hover:border-[#373c4e] hover:text-white'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            <span>Tổng quan &amp; Media</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('saves')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeTab === 'saves'
                ? 'bg-amber-500 text-black shadow-md shadow-amber-500/25'
                : 'border border-[#2a2e3d] bg-[#161821] text-[#8e95a5] hover:border-amber-500/50 hover:text-white'
            }`}
          >
            <HardDrive className="h-4 w-4" />
            <span>Lưu trữ Save</span>
          </button>
        </div>

        {activeTab === 'saves' ? (
          <div className="mt-6">
            <SaveVaultSection gameId={game.id} />
          </div>
        ) : (
          <>
        {/* Status, Score & Impression Hub */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status & Rating Panel */}
          <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 space-y-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#8e95a5] flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <span>Trạng thái &amp; Đánh giá</span>
            </h2>

            {/* Status Select */}
            <div>
              <label className="block text-xs font-semibold text-[#8e95a5] mb-1.5">Trạng thái chơi:</label>
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as GameStatus)}
                className="w-full rounded-xl border border-[#2a2e3d] bg-[#0e1015] px-3.5 py-2.5 text-xs font-bold text-white outline-none focus:border-[#ff2a44]"
              >
                <option value="playing">🎮 Đang chơi</option>
                <option value="completed">🏆 Đã phá đảo</option>
                <option value="backlog">⏳ Chờ chơi (Để dành)</option>
                <option value="paused">⏸️ Tạm dừng</option>
                <option value="dropped">🚫 Bỏ dở</option>
              </select>
            </div>

            {/* Completion Date (if completed) */}
            {status === 'completed' && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-amber-300">
                    🏆 Ngày phá đảo:
                  </label>
                  {latestMediaDate && latestMediaDate !== completedDate && (
                    <button
                      type="button"
                      onClick={() => handleCompletedDateChange(latestMediaDate)}
                      className="text-[10px] font-bold text-amber-400 hover:text-amber-300 underline"
                      title="Lấy theo ngày chụp ảnh/clip cuối cùng trong E:\Game"
                    >
                      📸 Lấy ngày ảnh cuối ({latestMediaDate})
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-amber-400 shrink-0" />
                  <input
                    type="date"
                    value={completedDate}
                    onChange={(e) => handleCompletedDateChange(e.target.value)}
                    className="flex-1 rounded-xl border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs text-white outline-none focus:border-amber-400"
                  />
                </div>
                {latestMediaDate && latestMediaDate === completedDate ? (
                  <p className="text-[10px] text-emerald-400">
                    Ngày đã chọn trùng với ảnh/clip cuối cùng ({latestMediaDate}).
                  </p>
                ) : (
                  <p className="text-[10px] text-[#8e95a5]">
                    Không nhớ ngày thì để trống. Chỉ lưu ngày khi bạn chọn hoặc bấm lấy ngày ảnh cuối.
                  </p>
                )}
              </div>
            )}

            {/* 10-Star Interactive Rating & Slider */}
            <div className="pt-2 border-t border-[#2a2e3d]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#8e95a5]">Điểm cá nhân:</span>
                <div className="flex items-center gap-2">
                  <span className={`text-base font-black ${rating !== null && rating > 0 ? 'text-amber-400' : 'text-[#8e95a5]'}`}>
                    {rating !== null && rating > 0 ? `${formatScore(rating)} / 10` : 'Chưa chấm'}
                  </span>
                  {rating !== null && rating > 0 && (
                    <button
                      onClick={() => handleRatingChange(null)}
                      className="text-[10px] text-[#8e95a5] hover:text-[#ff2a44] underline transition-colors cursor-pointer"
                      title="Xóa đánh giá (Về trạng thái chưa chấm)"
                    >
                      (Xóa điểm)
                    </button>
                  )}
                </div>
              </div>

              {/* 10-Star Bar */}
              <div className="flex items-center justify-between gap-1 py-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleRatingChange(star)}
                    className="p-1 transition-transform hover:scale-125 focus:outline-none"
                    title={`Chấm ${star} điểm`}
                  >
                    <Star
                      className={`h-5 w-5 ${
                        rating !== null && rating > 0 && rating >= star
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-[#2a2e3d] hover:text-amber-300'
                      }`}
                    />
                  </button>
                ))}
              </div>

              {/* Continuous 1.0 - 10.0 Slider */}
              <div className="mt-3">
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={rating && rating > 0 ? rating : 7.5}
                  onChange={(e) => handleRatingChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 cursor-pointer appearance-none rounded bg-[#0e1015] accent-amber-400 outline-none"
                />
              </div>

              <div className="mt-2 text-center text-xs font-semibold text-[#8e95a5] italic">
                {ratingLabel}
              </div>

              {onOpenCommunity && (
                <button
                  onClick={() => onOpenCommunity(gameToPublic(game))}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/50 bg-sky-500/15 px-3 py-2.5 text-xs font-bold text-sky-200 transition hover:bg-sky-500 hover:text-white"
                  title="Mở trang đánh giá, điểm số, cấu hình và top người chơi trên tab Cộng đồng"
                >
                  <MessageSquareText className="h-4 w-4" />
                  Xem đánh giá &amp; Điểm cộng đồng
                </button>
              )}
            </div>
          </div>

          {/* Story Impressions / Review / Notes Editor */}
          <div className="lg:col-span-2 rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#8e95a5] flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#ff2a44]" />
                  <span>Cảm nhận cốt truyện &amp; Ghi chú (Review &amp; Notes)</span>
                </h2>
                {notesSaved && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 font-bold animate-in fade-in">
                    <Check className="h-3.5 w-3.5" /> Đã lưu
                  </span>
                )}
              </div>

              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Ghi lại cảm nghĩ về cốt truyện, lối chơi, kết thúc ấn tượng, cấu hình đồ họa tối ưu hoặc hướng dẫn phá đảo bí mật..."
                rows={6}
                className="w-full rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-3.5 text-xs text-[#f1f3f7] placeholder-[#8e95a5] outline-none focus:border-[#ff2a44] resize-none"
              />
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#2a2e3d] mt-4">
              <span className="text-[11px] text-[#8e95a5]">
                Điểm và cảm nhận được lưu trên máy và đồng bộ công khai khi đăng nhập. Cần chấm điểm để tham gia Top game.
              </span>
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="flex items-center gap-1.5 rounded-lg bg-[#ff2a44] px-4 py-2 text-xs font-bold text-white shadow hover:brightness-110 transition-all"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{savingNotes ? 'Đang lưu…' : 'Lưu cảm nhận'}</span>
              </button>
            </div>
            {reviewSyncMessage && <p role="status" className="mt-3 text-xs text-[#adb4c4]">{reviewSyncMessage}</p>}
          </div>
        </div>

        {/* Media Gallery Section */}
        <div className="mt-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2a2e3d] pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-[#ff2a44]" />
                <span>Thư viện Media ({mediaItems.length})</span>
              </h2>

              {/* Media Filter Tabs */}
              <div className="flex rounded-lg bg-[#161821] p-1 border border-[#2a2e3d]">
                <button
                  onClick={() => setMediaFilter('all')}
                  className={`rounded-md px-3 py-1 text-xs font-bold transition-all ${
                    mediaFilter === 'all' ? 'bg-[#ff2a44] text-white' : 'text-[#8e95a5] hover:text-white'
                  }`}
                >
                  Tất cả [{mediaItems.length}]
                </button>
                <button
                  onClick={() => setMediaFilter('image')}
                  className={`rounded-md px-3 py-1 text-xs font-bold transition-all ${
                    mediaFilter === 'image' ? 'bg-[#ff2a44] text-white' : 'text-[#8e95a5] hover:text-white'
                  }`}
                >
                  Ảnh chụp [{imageCount}]
                </button>
                <button
                  onClick={() => setMediaFilter('video')}
                  className={`rounded-md px-3 py-1 text-xs font-bold transition-all ${
                    mediaFilter === 'video' ? 'bg-[#ff2a44] text-white' : 'text-[#8e95a5] hover:text-white'
                  }`}
                >
                  Video Clip [{videoCount}]
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenFolder}
                className="flex items-center gap-1.5 rounded-lg border border-[#ff2a44]/40 bg-[#ff2a44]/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#ff2a44]"
                title="Mở thư mục ảnh này trong Windows Explorer"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#ff2a44]" />
                <span>Mở thư mục ảnh</span>
              </button>

              <button
                onClick={() => loadMedia(game.title)}
                className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs text-[#8e95a5] hover:text-white transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Làm mới</span>
              </button>
            </div>
          </div>

          {/* Media Grid */}
          {mediaLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#ff2a44]" />
            </div>
          ) : filteredMedia.length === 0 ? (
            <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] p-10 text-center text-[#8e95a5]">
              <ImageIcon className="h-12 w-12 text-[#2a2e3d] mx-auto mb-2" />
              <p className="text-sm font-semibold text-white">Chưa có tệp hình ảnh hoặc video trong thư mục</p>
              <p className="mt-1 font-mono text-xs text-[#8e95a5]">
                Đường dẫn thư mục: <span className="font-bold text-[#ff2a44]">{mediaFolderPath || `E:\\Game\\${game.title}`}</span>
              </p>
              <p className="mt-1 text-xs text-[#8e95a5]">
                Bạn có thể copy ảnh/video trực tiếp vào thư mục này, hoặc nhấn phím F6 trong game rồi dùng nút "Đồng bộ ảnh F6".
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleOpenFolder}
                  className="flex items-center gap-2 rounded-xl bg-[#ff2a44] px-4 py-2 text-xs font-bold text-white transition-all hover:brightness-110 shadow-lg shadow-[#ff2a44]/25"
                >
                  <FolderOpen className="h-4 w-4" />
                  <span>📂 Mở thư mục ảnh trong Explorer</span>
                </button>
                <button
                  type="button"
                  onClick={handleTriggerSync}
                  disabled={syncingF6}
                  className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-300 transition-all hover:bg-amber-400 hover:text-black disabled:opacity-50"
                  title="Cut ảnh chụp F6 từ C: sang E:\Game và tự động đẩy lên Google Drive"
                >
                  {syncingF6 ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                      <span>Đang gom &amp; đẩy lên Drive...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      <span>⚡ Đồng bộ ảnh F6 &amp; Drive</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                {displayedMedia.map((item) => {
                  const isVideo = item.type === 'video';
                  const thumbUrl = item.url + (item.url.includes('?') ? '&' : '?') + 'thumb=1&w=480';
                  return (
                    <div
                      key={item.path}
                      onClick={() => {
                        if (isVideo) {
                          setActiveVideo(item);
                        } else {
                          // find index in image-only array for lightbox
                          const imgIdx = mediaItems.filter((m) => m.type === 'image').findIndex((m) => m.path === item.path);
                          setLightboxIndex(imgIdx >= 0 ? imgIdx : 0);
                        }
                      }}
                      className="group relative aspect-[16/9] cursor-pointer overflow-hidden rounded-xl border border-[#2a2e3d] bg-[#0e1015] transition-all hover:border-[#ff2a44] hover:shadow-[0_4px_20px_rgba(255,42,68,0.25)]"
                    >
                      {isVideo ? (
                        <div className="relative h-full w-full bg-[#161821] flex items-center justify-center">
                          <video src={item.url} className="h-full w-full object-cover opacity-80" preload="none" />
                          <div className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-[#ff2a44] border border-[#ff2a44]/50 backdrop-blur-md group-hover:scale-110 transition-transform">
                            <Play className="h-5 w-5 fill-[#ff2a44] pl-0.5" />
                          </div>
                          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                            VIDEO
                          </span>
                        </div>
                      ) : (
                        <img
                          src={thumbUrl}
                          alt={item.name}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      )}

                      {/* Bottom Metadata Overlay */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="truncate font-semibold">{item.name}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredMedia.length > visibleCount && (
                <div className="flex items-center justify-center gap-3 pt-6">
                  <button
                    onClick={() => setVisibleCount((prev) => prev + 36)}
                    className="flex items-center gap-2 rounded-xl border border-[#2a2e3d] bg-[#161821] px-6 py-2.5 text-xs font-bold text-white transition-all hover:border-[#ff2a44] hover:bg-[#1f2230]"
                  >
                    <span>Hiển thị thêm ({Math.min(36, filteredMedia.length - visibleCount)} / {filteredMedia.length - visibleCount} còn lại)</span>
                  </button>
                  <button
                    onClick={() => setVisibleCount(filteredMedia.length)}
                    className="rounded-xl border border-[#2a2e3d] bg-[#0e1015] px-4 py-2.5 text-xs font-bold text-[#8e95a5] hover:text-white transition-colors"
                  >
                    Tải tất cả ({filteredMedia.length})
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Share & Performance */}
        <ScreenshotShare game={game} media={mediaItems} />
        <PerformancePanel gameId={game.id} status={game.status} />

        {/* Performance & Historic Sessions Section */}
        {sessions.length > 0 && (
          <div className="mt-12 space-y-4">
            {/* Aggregate FPS stat (dữ liệu cho bảng xếp hạng hiệu năng) */}
            {gameFpsStats && (
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-emerald-400" />
                  <div>
                    <div className="text-[10px] uppercase font-bold text-[#8e95a5]">FPS trung bình (tổng hợp)</div>
                    <div className="font-mono text-lg font-black text-emerald-400">
                      {gameFpsStats.avg.toFixed(1)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-[#8e95a5]">
                  <span>1% low: <b className="font-mono text-[#f1f3f7]">{gameFpsStats.low1pct?.toFixed(1) ?? '—'}</b></span>
                  <span>Cao nhất: <b className="font-mono text-[#f1f3f7]">{gameFpsStats.best.toFixed(0)}</b></span>
                  <span>Thấp nhất: <b className="font-mono text-[#f1f3f7]">{gameFpsStats.worst.toFixed(0)}</b></span>
                  <span>Phiên đoán: <b className="font-mono text-[#f1f3f7]">{gameFpsStats.sessions}</b></span>
                </div>
              </div>
            )}

            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <History className="h-4 w-4 text-amber-400" />
              <span>Lịch sử các phiên chơi ({sessions.length})</span>
            </h2>
            <div className="max-h-60 overflow-y-auto rounded-2xl border border-[#2a2e3d] bg-[#161821] p-4 space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg bg-[#0e1015] px-4 py-2 text-xs border border-[#2a2e3d]/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[#8e95a5]">
                      {new Date(s.start_time).toLocaleString('vi-VN')}
                    </span>
                    <span className="rounded bg-[#2a2e3d] px-2 py-0.5 text-[10px] text-[#8e95a5]">
                      {s.source === 'amd_import' ? 'AMD Import' : s.source === 'tracker' ? 'Zero-Impact Tracker' : 'Thủ công'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {s.fps_avg != null && s.fps_avg > 0 && (
                      <span
                        className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400 border border-emerald-500/30"
                        title={`1% low: ${s.fps_1pct_low != null ? s.fps_1pct_low.toFixed(0) : '—'} FPS · ${s.fps_samples ?? 0} frame`}
                      >
                        {s.fps_avg.toFixed(0)} FPS
                      </span>
                    )}
                    <div className="font-mono font-bold text-[#f1f3f7]">
                      {s.duration_minutes} phút
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* Lightbox for Images */}
      {lightboxIndex !== null && (
        <Lightbox
          items={mediaItems.filter((m) => m.type === 'image')}
          currentIndex={lightboxIndex}
          gameId={game.id}
          isOpen={lightboxIndex !== null}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(newIdx) => setLightboxIndex(newIdx)}
          onCoverUpdated={(type, newUrl) => {
            const updated = {
              ...game,
              cover_url: type === 'poster' ? newUrl : game.cover_url,
              banner_url: type === 'banner' ? newUrl : game.banner_url,
            };
setGame(updated);
            onGameUpdated(updated);
          }}
        />
      )}

      {/* Video Player Modal */}
      {activeVideo && (
        <VideoPlayer
          item={activeVideo}
          gameTitle={game.title}
          isOpen={activeVideo !== null}
          onClose={() => setActiveVideo(null)}
          onOpenFolder={handleOpenFolder}
        />
      )}

      {/* Cover Art Modal */}
      {coverModalOpen && (
        <CoverArtModal
          game={game}
          isOpen={coverModalOpen}
          onClose={() => setCoverModalOpen(false)}
          onSuccess={(updatedGame) => {
            setGame(updatedGame);
            onGameUpdated(updatedGame);
          }}
        />
      )}

      {/* Edit Playtime Modal */}
      {editPlaytimeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="h-5 w-5 text-[#ff2a44]" />
              <span>Chỉnh sửa thời gian chơi</span>
            </h3>
            <p className="text-xs text-[#8e95a5]">
              Nhập tổng số giờ và phút cho {game.title}. Phần nhập thêm được hiển thị trong thư viện nhưng không tính vào bảng xếp hạng.
            </p>
            <p className="text-xs text-[#8e95a5]">
              Giờ được ghi nhận: {formatPlaytime(recordedMinutes)}. Tổng giờ không thể thấp hơn phần này.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#8e95a5] mb-1">Giờ (Hours):</label>
                <input
                  type="number"
                  min="0"
                  value={editHours}
                  onChange={(e) => setEditHours(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs font-mono text-white outline-none focus:border-[#ff2a44]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8e95a5] mb-1">Phút (Minutes):</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={editMins}
                  onChange={(e) => setEditMins(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs font-mono text-white outline-none focus:border-[#ff2a44]"
                />
              </div>
            </div>

            {editPlaytimeError && (
              <p role="alert" className="text-xs text-rose-400">{editPlaytimeError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setEditPlaytimeOpen(false)}
                className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] hover:text-white"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveManualPlaytime}
                className="rounded-lg bg-[#ff2a44] px-4 py-1.5 text-xs font-bold text-white shadow hover:brightness-110"
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        title="Xóa trò chơi khỏi thư viện"
        message={
          game
            ? `Bạn có chắc chắn muốn xóa "${game.title}" khỏi thư viện GameVault không?\n\n(Lưu ý: Chỉ xóa khỏi danh sách app GameVault, không ảnh hưởng đến file game thực tế trên máy tính của bạn)`
            : ''
        }
        confirmText="Xóa khỏi thư viện"
        onConfirm={confirmDeleteGame}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      {/* Floating Sticky Corner Back Button - Always visible when scrolling down */}
      <button
        onClick={onBack}
        className="fixed bottom-8 left-8 z-40 flex items-center gap-2.5 rounded-full border border-[#2a2e3d] bg-[#161821]/95 px-4 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-md transition-all hover:scale-105 hover:border-[#ff2a44] hover:bg-[#ff2a44] hover:shadow-[#ff2a44]/30 active:scale-95 group"
        title="Quay lại Thư viện (ESC)"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
        <span>Quay lại Thư viện</span>
        <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-mono text-white/80">ESC</span>
      </button>
    </div>
  );
};
