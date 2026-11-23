import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Image as ImageIcon,
  LayoutTemplate,
  Check,
  Calendar,
  HardDrive
} from 'lucide-react';
import type { MediaItem } from '../../shared/types.js';

export interface LightboxProps {
  items: MediaItem[];
  currentIndex: number;
  gameId: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onCoverUpdated?: (type: 'poster' | 'banner', newUrl: string) => void;
}

export const Lightbox: React.FC<LightboxProps> = ({
  items,
  currentIndex,
  gameId,
  isOpen,
  onClose,
  onNavigate,
  onCoverUpdated,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [posterSuccess, setPosterSuccess] = useState(false);
  const [bannerSuccess, setBannerSuccess] = useState(false);

  const currentItem = items[currentIndex];

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setZoomLevel(1);
      onNavigate(currentIndex - 1);
    }
  }, [currentIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (currentIndex < items.length - 1) {
      setZoomLevel(1);
      onNavigate(currentIndex + 1);
    }
  }, [currentIndex, items.length, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === '+' || e.key === '=') {
        setZoomLevel((z) => Math.min(z + 0.25, 3));
      } else if (e.key === '-') {
        setZoomLevel((z) => Math.max(z - 0.25, 0.5));
      } else if (e.key === '0') {
        setZoomLevel(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  if (!isOpen || !currentItem) return null;

  const handleSetCover = async (type: 'poster' | 'banner') => {
    try {
      if (window.electronAPI?.setCoverFromScreenshot) {
        const resultUrl = await window.electronAPI.setCoverFromScreenshot(gameId, type, currentItem.path);
        if (type === 'poster') {
          setPosterSuccess(true);
          setTimeout(() => setPosterSuccess(false), 2500);
        } else {
          setBannerSuccess(true);
          setTimeout(() => setBannerSuccess(false), 2500);
        }
        onCoverUpdated?.(type, resultUrl);
      } else if (window.electronAPI?.updateGame) {
        const updateData = type === 'poster' ? { cover_url: currentItem.url } : { banner_url: currentItem.url };
        await window.electronAPI.updateGame(gameId, updateData);
        if (type === 'poster') {
          setPosterSuccess(true);
          setTimeout(() => setPosterSuccess(false), 2500);
        } else {
          setBannerSuccess(true);
          setTimeout(() => setBannerSuccess(false), 2500);
        }
        onCoverUpdated?.(type, currentItem.url);
      }
    } catch (err) {
      console.error('Failed to set cover from lightbox screenshot:', err);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-[#f1f3f7] backdrop-blur-xl select-none animate-in fade-in duration-200">
      {/* Top Header Controls */}
      <div className="flex items-center justify-between border-b border-[#2a2e3d]/60 bg-[#0e1015]/80 px-6 py-3">
        {/* Left: Metadata info */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-[#ff2a44]">
              {currentIndex + 1} / {items.length}
            </span>
            <span className="max-w-md truncate text-sm font-semibold text-[#f1f3f7]" title={currentItem.name}>
              {currentItem.name}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs text-[#8e95a5]">
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {formatFileSize(currentItem.size)}
            </span>
            {(currentItem.captureDate || currentItem.createdAt) && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(currentItem.captureDate || currentItem.createdAt).toLocaleString('vi-VN')}
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions (Set as Poster/Banner, Zoom, Close) */}
        <div className="flex items-center gap-3">
          {/* Set as Poster */}
          <button
            onClick={() => handleSetCover('poster')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
              posterSuccess
                ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                : 'border-[#2a2e3d] bg-[#161821] text-[#f1f3f7] hover:border-[#ff2a44] hover:text-[#ff2a44]'
            }`}
          >
            {posterSuccess ? <Check className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5 text-[#ff2a44]" />}
            <span>{posterSuccess ? 'Đã đặt Poster!' : 'Đặt làm Poster (2:3)'}</span>
          </button>

          {/* Set as Banner */}
          <button
            onClick={() => handleSetCover('banner')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
              bannerSuccess
                ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                : 'border-[#2a2e3d] bg-[#161821] text-[#f1f3f7] hover:border-[#ff2a44] hover:text-[#ff2a44]'
            }`}
          >
            {bannerSuccess ? <Check className="h-3.5 w-3.5" /> : <LayoutTemplate className="h-3.5 w-3.5 text-amber-400" />}
            <span>{bannerSuccess ? 'Đã đặt Banner!' : 'Đặt làm Hero Banner (16:9)'}</span>
          </button>

          <div className="h-5 w-px bg-[#2a2e3d]" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-[#161821] rounded-lg border border-[#2a2e3d] p-0.5">
            <button
              onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.5))}
              className="p-1.5 text-[#8e95a5] hover:text-white rounded"
              title="Thu nhỏ (-)"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-10 text-center text-xs font-mono font-medium">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 3))}
              className="p-1.5 text-[#8e95a5] hover:text-white rounded"
              title="Phóng to (+)"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="p-1.5 text-[#8e95a5] hover:text-white rounded"
              title="Khôi phục 100% (0)"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#8e95a5] transition-colors hover:bg-[#ff2a44]/20 hover:text-[#ff2a44]"
            title="Đóng (ESC)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div className="relative flex-1 overflow-hidden flex items-center justify-center p-4">
        {/* Previous Button */}
        {currentIndex > 0 && (
          <button
            onClick={handlePrev}
            className="absolute left-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-all hover:scale-110 hover:bg-[#ff2a44] border border-white/10"
            title="Ảnh trước (Mũi tên trái)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Scaled Image */}
        <div className="max-h-full max-w-full overflow-auto flex items-center justify-center">
          <img
            src={currentItem.url}
            alt={currentItem.name}
            style={{
              transform: `scale(${zoomLevel})`,
              transition: zoomLevel === 1 ? 'transform 0.2s ease-out' : 'none',
              transformOrigin: 'center center',
            }}
            className="max-h-[82vh] max-w-[90vw] object-contain shadow-2xl rounded-sm select-none"
            draggable={false}
          />
        </div>

        {/* Next Button */}
        {currentIndex < items.length - 1 && (
          <button
            onClick={handleNext}
            className="absolute right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-all hover:scale-110 hover:bg-[#ff2a44] border border-white/10"
            title="Ảnh tiếp theo (Mũi tên phải)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bottom Thumbnail Strip */}
      <div className="border-t border-[#2a2e3d]/60 bg-[#0e1015]/90 px-6 py-2.5 overflow-x-auto">
        <div className="flex items-center gap-2 justify-center min-w-max mx-auto">
          {items.slice(Math.max(0, currentIndex - 5), Math.min(items.length, currentIndex + 6)).map((item, idx) => {
            const actualIndex = Math.max(0, currentIndex - 5) + idx;
            const isSelected = actualIndex === currentIndex;
            return (
              <button
                key={item.path}
                onClick={() => {
                  setZoomLevel(1);
                  onNavigate(actualIndex);
                }}
                className={`relative h-14 w-20 overflow-hidden rounded-md border transition-all ${
                  isSelected
                    ? 'border-[#ff2a44] ring-2 ring-[#ff2a44]/50 scale-105'
                    : 'border-[#2a2e3d] opacity-50 hover:opacity-100'
                }`}
              >
                <img
                  src={item.url + (item.url.includes('?') ? '&' : '?') + 'thumb=1&w=240'}
                  alt={item.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
