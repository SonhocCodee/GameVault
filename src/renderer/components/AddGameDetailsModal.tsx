import React, { useState, useEffect } from 'react';
import { X, Loader2, Star, Trophy, BookmarkPlus, AlertCircle } from 'lucide-react';

export interface PendingAddGame {
  appId: number;
  name: string;
  status: 'backlog' | 'completed';
}

export interface AddGameDetailsModalProps {
  pending: PendingAddGame | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Called with rating (1-10 or null = chưa chấm) and review text (may be empty). */
  onConfirm: (rating: number | null, notes: string) => void;
}

/**
 * Rating/review prompt shown before a game found via external search is
 * added to the library ("Đã phá đảo" or "Chờ chơi"). Both fields are
 * optional — confirm adds the game straight away.
 */
export const AddGameDetailsModal: React.FC<AddGameDetailsModalProps> = ({
  pending,
  busy = false,
  error = null,
  onClose,
  onConfirm,
}) => {
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  // Reset whenever a new pending game is opened
  useEffect(() => {
    if (pending) {
      setRating(null);
      setNotes('');
    }
  }, [pending?.appId, pending?.status]);

  if (!pending) return null;

  const isCompleted = pending.status === 'completed';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#2a2e3d] pb-3 mb-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              {isCompleted ? (
                <Trophy className="h-5 w-5 shrink-0 text-amber-400" />
              ) : (
                <BookmarkPlus className="h-5 w-5 shrink-0 text-purple-400" />
              )}
              <span>{isCompleted ? 'Đánh dấu Đã phá đảo' : 'Thêm vào Chờ chơi'}</span>
            </h3>
            <p className="mt-1 truncate text-xs font-semibold text-[#f1f3f7]" title={pending.name}>
              {pending.name}
            </p>
            <p className="text-[10px] text-[#8e95a5]">Steam AppID: {pending.appId}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-[#8e95a5] hover:text-white disabled:opacity-50"
            title="Đóng"
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

        <div className="space-y-4 text-xs">
          {/* 10-star personal rating */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-semibold text-[#8e95a5]">Điểm cá nhân (1-10):</label>
              <span className="flex items-center gap-1.5">
                {rating !== null ? (
                  <span className="flex items-center gap-1 font-black text-amber-400">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {rating}/10
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-[#8e95a5]">Chưa chấm</span>
                )}
                {rating !== null && (
                  <button
                    onClick={() => setRating(null)}
                    className="text-[10px] text-[#8e95a5] underline transition-colors hover:text-[#ff2a44]"
                    title="Xóa điểm"
                  >
                    (Xóa)
                  </button>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() => setRating(rating === n ? null : n)}
                  className="transition-transform hover:scale-110 active:scale-95 disabled:opacity-50"
                  title={`${n}/10`}
                >
                  <Star
                    className={`h-5 w-5 transition-colors ${
                      rating !== null && n <= rating
                        ? 'fill-amber-400 text-amber-400'
                        : 'fill-transparent text-[#3a3f52] hover:text-amber-300'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Personal review (optional) */}
          <div>
            <label className="block font-semibold text-[#8e95a5] mb-1.5">
              Đánh giá của bạn (không bắt buộc):
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              disabled={busy}
              placeholder={
                isCompleted
                  ? 'Cảm nhận về game... (để trống nếu không muốn viết)'
                  : 'Lý do muốn chơi, ghi chú... (để trống nếu không muốn viết)'
              }
              className="w-full resize-none rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-white placeholder-[#5b6273] outline-none focus:border-[#ff2a44] disabled:opacity-50"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 font-semibold text-[#8e95a5] hover:text-white disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => onConfirm(rating, notes)}
              disabled={busy}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 font-bold text-white shadow disabled:opacity-50 ${
                isCompleted
                  ? 'bg-gradient-to-r from-[#ff2a44] to-[#e02424] hover:brightness-110'
                  : 'bg-purple-600 hover:brightness-110'
              }`}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{isCompleted ? '🏆 Thêm Đã phá đảo' : '⏳ Thêm Chờ chơi'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
