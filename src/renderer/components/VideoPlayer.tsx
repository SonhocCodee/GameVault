import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  HardDrive,
  Calendar,
  FolderOpen,
  Film
} from 'lucide-react';
import type { MediaItem } from '../../shared/types.js';

export interface VideoPlayerProps {
  item: MediaItem | null;
  gameTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenFolder?: (title: string) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  item,
  gameTitle,
  isOpen,
  onClose,
  onOpenFolder,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);

  // Reset when item changes
  useEffect(() => {
    if (isOpen && videoRef.current) {
      setCurrentTime(0);
      setIsPlaying(true);
      videoRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [isOpen, item]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  }, []);

  const handleVolumeChange = (newVol: number) => {
    if (!videoRef.current) return;
    videoRef.current.volume = newVol;
    setVolume(newVol);
    if (newVol > 0 && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  const handleSeek = (time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Keyboard controls
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
        } else {
          onClose();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current) handleSeek(Math.max(videoRef.current.currentTime - 5, 0));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (videoRef.current) handleSeek(Math.min(videoRef.current.currentTime + 5, duration));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, togglePlay, toggleFullscreen, toggleMute, duration]);

  if (!isOpen || !item) return null;

  const formatTime = (secs: number): string => {
    if (isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl animate-in fade-in duration-200">
      <div
        ref={containerRef}
        onMouseMove={() => setControlsVisible(true)}
        className="relative flex h-full w-full flex-col overflow-hidden bg-black select-none"
      >
        {/* Top Floating Header */}
        <div
          className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/90 via-black/50 to-transparent px-6 py-4 transition-opacity duration-300 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Metadata */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ff2a44]/20 border border-[#ff2a44]/40">
              <Film className="h-5 w-5 text-[#ff2a44]" />
            </div>
            <div>
              <h2 className="max-w-xl truncate text-base font-bold text-white" title={item.name}>
                {item.name}
              </h2>
              <div className="flex items-center gap-3 text-xs text-[#8e95a5]">
                <span>{gameTitle}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {formatFileSize(item.size)}
                </span>
                {(item.captureDate || item.createdAt) && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(item.captureDate || item.createdAt).toLocaleString('vi-VN')}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions & Close */}
          <div className="flex items-center gap-3">
            {onOpenFolder && (
              <button
                onClick={() => onOpenFolder(gameTitle)}
                className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-[#ff2a44] hover:border-[#ff2a44]"
                title="Mở thư mục video trong Explorer"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Mở thư mục E:\Game</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="rounded-full bg-white/10 p-2 text-white backdrop-blur-md transition-colors hover:bg-[#ff2a44]"
              title="Đóng video (ESC)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Video Canvas Stage */}
        <div
          className="relative flex flex-1 items-center justify-center cursor-pointer"
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            src={item.url}
            autoPlay
            playsInline
            onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
            onLoadedMetadata={() => videoRef.current && setDuration(videoRef.current.duration)}
            onEnded={() => setIsPlaying(false)}
            className="max-h-full max-w-full object-contain"
          />

          {/* Center Play/Pause Indicator when paused */}
          {!isPlaying && (
            <div className="pointer-events-none absolute flex h-20 w-20 items-center justify-center rounded-full bg-black/60 text-[#ff2a44] backdrop-blur-md border border-white/20 shadow-2xl">
              <Play className="h-10 w-10 fill-[#ff2a44] pl-1" />
            </div>
          )}
        </div>

        {/* Bottom Custom Playback Controls */}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 flex flex-col bg-gradient-to-t from-black/95 via-black/70 to-transparent px-6 pb-4 pt-8 transition-opacity duration-300 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Timeline Range Scrubber */}
          <div className="group relative mb-3 flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => handleSeek(parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/20 accent-[#ff2a44] outline-none transition-all hover:h-2"
            />
          </div>

          {/* Controls Bar */}
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-4">
              {/* Play / Pause */}
              <button
                onClick={togglePlay}
                className="rounded-lg p-2 hover:bg-white/10 transition-colors text-white"
                title={isPlaying ? 'Tạm dừng (Space)' : 'Phát (Space)'}
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white" />}
              </button>

              {/* Volume Slider & Mute */}
              <div className="flex items-center gap-2 group">
                <button
                  onClick={toggleMute}
                  className="rounded-lg p-2 hover:bg-white/10 transition-colors text-white"
                  title="Tắt/Bật tiếng (M)"
                >
                  {isMuted || volume === 0 ? <VolumeX className="h-5 w-5 text-rose-400" /> : <Volume2 className="h-5 w-5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-16 h-1 cursor-pointer appearance-none rounded bg-white/30 accent-[#ff2a44] outline-none"
                />
              </div>

              {/* Current / Total Time */}
              <div className="font-mono text-xs text-[#f1f3f7]">
                <span>{formatTime(currentTime)}</span>
                <span className="mx-1 text-[#8e95a5]">/</span>
                <span className="text-[#8e95a5]">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSeek(0)}
                className="rounded-lg p-2 hover:bg-white/10 transition-colors text-[#8e95a5] hover:text-white"
                title="Phát lại từ đầu"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              <button
                onClick={toggleFullscreen}
                className="rounded-lg p-2 hover:bg-white/10 transition-colors text-white"
                title="Toàn màn hình (F)"
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
