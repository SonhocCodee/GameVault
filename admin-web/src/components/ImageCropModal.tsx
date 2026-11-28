import React, { useEffect, useRef, useState } from 'react';
import { Crop, Loader2, RotateCcw, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ImageCropModalProps {
  sourceUrl: string;
  targetType: 'poster' | 'banner';
  originalFile?: File | null;
  onConfirm: (croppedFile: File) => Promise<void> | void;
  onUploadOriginal?: (file: File) => Promise<void> | void;
  onClose: () => void;
}

const POSTER_SIZE = { width: 600, height: 900 };
const BANNER_SIZE = { width: 1280, height: 720 };

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  sourceUrl,
  targetType,
  originalFile,
  onConfirm,
  onUploadOriginal,
  onClose,
}) => {
  const isPoster = targetType === 'poster';
  const frameWidth = isPoster ? 280 : 480;
  const frameHeight = isPoster ? 420 : 270;
  const outputSize = isPoster ? POSTER_SIZE : BANNER_SIZE;

  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setNaturalSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLoadError(null);
  }, [sourceUrl]);

  // Base scale so the image always covers the entire crop frame
  const baseScale = naturalSize
    ? Math.max(frameWidth / naturalSize.w, frameHeight / naturalSize.h)
    : 1;
  const displayScale = baseScale * zoom;

  const clampOffset = (x: number, y: number, scale: number) => {
    if (!naturalSize) return { x: 0, y: 0 };
    const maxX = Math.max(0, (naturalSize.w * scale - frameWidth) / 2);
    const maxY = Math.max(0, (naturalSize.h * scale - frameHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const handleZoomChange = (nextZoom: number) => {
    const clampedZoom = Math.min(4, Math.max(1, nextZoom));
    setZoom(clampedZoom);
    setOffset((prev) => clampOffset(prev.x, prev.y, baseScale * clampedZoom));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!naturalSize) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset(dragRef.current.origX + dx, dragRef.current.origY + dy, displayScale));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleCropAndUpload = async () => {
    if (!imgRef.current || !naturalSize) return;
    setSubmitting(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = outputSize.width;
      canvas.height = outputSize.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D');

      const imgLeftInFrame = frameWidth / 2 + offset.x - (naturalSize.w * displayScale) / 2;
      const imgTopInFrame = frameHeight / 2 + offset.y - (naturalSize.h * displayScale) / 2;

      const sx = Math.max(0, -imgLeftInFrame / displayScale);
      const sy = Math.max(0, -imgTopInFrame / displayScale);
      const sw = Math.min(naturalSize.w - sx, frameWidth / displayScale);
      const sh = Math.min(naturalSize.h - sy, frameHeight / displayScale);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, outputSize.width, outputSize.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Không thể xuất ảnh đã cắt (CORS hoặc lỗi ảnh)'))),
          'image/jpeg',
          0.92
        );
      });

      const baseName = originalFile?.name?.replace(/\.[^.]+$/, '') || targetType;
      const croppedFile = new File([blob], `${baseName}_${targetType}.jpg`, { type: 'image/jpeg' });
      await onConfirm(croppedFile);
      onClose();
    } catch (err: any) {
      setLoadError(err?.message || 'Lỗi cắt ảnh');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-[#262b3d] bg-[#121520] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#262b3d] bg-[#161a26] px-4 py-3">
          <div className="flex items-center gap-2">
            <Crop className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">
              {isPoster ? 'Cắt ảnh Poster (2:3 — 600×900)' : 'Cắt ảnh Banner (16:9 — 1280×720)'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-[#8e95a5] hover:bg-[#262b3d] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          <p className="text-[11px] text-[#8e95a5] text-center">
            Kéo ảnh để căn vị trí, cuộn chuột hoặc kéo thanh zoom để phóng to/thu nhỏ.
          </p>

          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={(e) => {
              e.preventDefault();
              handleZoomChange(zoom + (e.deltaY < 0 ? 0.12 : -0.12));
            }}
            style={{ width: frameWidth, height: frameHeight }}
            className="relative overflow-hidden rounded-xl border-2 border-amber-400/70 bg-[#0b0d13] cursor-grab active:cursor-grabbing select-none touch-none shadow-inner"
          >
            <img
              ref={imgRef}
              src={sourceUrl}
              crossOrigin="anonymous"
              alt="Crop preview"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onError={() => setLoadError('Không tải được ảnh để cắt (link ngoài chặn CORS hoặc ảnh lỗi).')}
              style={
                naturalSize
                  ? {
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: naturalSize.w * displayScale,
                      height: naturalSize.h * displayScale,
                      maxWidth: 'none',
                      maxHeight: 'none',
                      transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                    }
                  : { opacity: 0 }
              }
            />

            {/* Rule-of-thirds overlay */}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }).map((_, idx) => (
                <div key={idx} className="border border-white/10" />
              ))}
            </div>
          </div>

          {loadError && (
            <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 text-center">
              {loadError}
            </div>
          )}

          <div className="flex w-full max-w-sm items-center gap-3">
            <ZoomOut className="h-4 w-4 text-[#8e95a5] shrink-0" />
            <input
              type="range"
              min={1}
              max={4}
              step={0.05}
              value={zoom}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
            <ZoomIn className="h-4 w-4 text-[#8e95a5] shrink-0" />
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }}
              className="flex items-center gap-1 rounded-lg border border-[#262b3d] bg-[#161a26] px-2 py-1 text-[11px] text-[#c6cde0] hover:text-white shrink-0"
              title="Đặt lại vị trí"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#262b3d] bg-[#161a26] px-4 py-3">
          {originalFile && onUploadOriginal ? (
            <button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await onUploadOriginal(originalFile);
                  onClose();
                } finally {
                  setSubmitting(false);
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-[#262b3d] bg-[#0d1018] px-3 py-2 text-xs font-semibold text-[#c6cde0] hover:text-white disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload nguyên gốc</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="rounded-lg border border-[#262b3d] px-3 py-2 text-xs font-semibold text-[#8e95a5] hover:text-white"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={submitting || !naturalSize || Boolean(loadError)}
              onClick={handleCropAndUpload}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-red-500 hover:from-amber-400 hover:to-red-400 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-amber-500/20 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crop className="h-3.5 w-3.5" />}
              <span>Cắt & Upload lên Cloud</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
