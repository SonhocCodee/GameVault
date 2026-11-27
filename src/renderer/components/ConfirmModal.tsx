import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app confirmation modal replacing native window.confirm(), which can
 * stall Chromium focus/input state on Electron Windows.
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy',
  danger = true,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-[#2a2e3d] bg-[#161821] p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-3 mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${danger ? 'text-rose-400' : 'text-amber-400'}`} />
            <span>{title}</span>
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-[#8e95a5] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="whitespace-pre-line text-xs leading-relaxed text-[#c4c9d4]">{message}</p>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#2a2e3d] pt-3 text-xs">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3.5 py-1.5 font-semibold text-[#8e95a5] hover:text-white"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-1.5 font-bold text-white shadow hover:brightness-110 ${
              danger ? 'bg-[#ff2a44]' : 'bg-emerald-600'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
