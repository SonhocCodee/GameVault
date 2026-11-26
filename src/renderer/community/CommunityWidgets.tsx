import React, { useState } from "react";
import {
  AlertTriangle,
  Camera,
  Flag,
  HelpCircle,
  MessageSquareText,
  Star,
  Trophy,
  X,
} from "lucide-react";
import type { PostKind } from "../../shared/community.ts";

export function Avatar({
  name,
  url,
  size = 36,
}: {
  name?: string | null;
  url?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const label = (name || "P").trim();
  const initial = (label[0] || "P").toUpperCase();
  if (url && !failed) {
    return (
      <img
        className="gv-avatar"
        src={url}
        alt={label}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className="gv-avatar gv-avatar-fallback"
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.42)) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

const KIND_META: Record<
  PostKind,
  { label: string; className: string; Icon: React.FC<{ size?: number }> }
> = {
  photo: { label: "Ảnh game", className: "gv-kind-photo", Icon: Camera },
  thought: { label: "Cảm nhận", className: "gv-kind-thought", Icon: MessageSquareText },
  question: { label: "Hỏi đáp", className: "gv-kind-question", Icon: HelpCircle },
  completed: { label: "Phá đảo", className: "gv-kind-completed", Icon: Trophy },
  review: { label: "Đánh giá", className: "gv-kind-review", Icon: Star },
};

export function KindBadge({ kind }: { kind: PostKind }) {
  const meta = KIND_META[kind] || KIND_META.thought;
  const Icon = meta.Icon;
  return (
    <span className={`gv-kind-badge ${meta.className}`}>
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

export function scoreTierClass(score: number): string {
  if (score >= 8) return "gv-score-high";
  if (score >= 5) return "gv-score-mid";
  return "gv-score-low";
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Xác nhận",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="gv-modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="gv-modal gv-modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="gv-modal-head">
          <div className="gv-modal-title">
            <AlertTriangle size={18} className={danger ? "gv-text-danger" : "gv-text-accent"} />
            <h3>{title}</h3>
          </div>
          <button type="button" className="gv-icon-btn" onClick={onCancel} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>
        <p className="gv-modal-body-text">{message}</p>
        <div className="gv-modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Hủy
          </button>
          <button
            type="button"
            disabled={busy}
            className={danger ? "gv-btn-danger" : "gv-primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const REPORT_PRESETS = [
  "Spoiler chưa gắn cảnh báo",
  "Spam hoặc quảng cáo",
  "Công kích / ngôn từ không phù hợp",
  "Thông tin sai lệch / giả mạo FPS",
];

export function ReportModal({
  open,
  title = "Báo cáo nội dung",
  busy = false,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title?: string;
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="gv-modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="gv-modal gv-modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="gv-modal-head">
          <div className="gv-modal-title">
            <Flag size={18} className="gv-text-amber" />
            <h3>{title}</h3>
          </div>
          <button type="button" className="gv-icon-btn" onClick={onCancel} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>
        <form
          className="gv-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            onSubmit(reason.trim().slice(0, 500));
          }}
        >
          <div className="gv-chip-row">
            {REPORT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`gv-chip ${reason === preset ? "active" : ""}`}
                onClick={() => setReason(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <label>
            Chi tiết lý do
            <textarea
              required
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Mô tả ngắn vấn đề của nội dung này..."
            />
          </label>
          <div className="gv-modal-actions">
            <button type="button" disabled={busy} onClick={onCancel}>
              Hủy
            </button>
            <button type="submit" className="gv-primary" disabled={busy || !reason.trim()}>
              {busy ? "Đang gửi…" : "Gửi báo cáo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  if (!src) return null;
  return (
    <div className="gv-modal-backdrop gv-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button
        type="button"
        className="gv-lightbox-close"
        onClick={onClose}
        aria-label="Đóng ảnh"
      >
        <X size={20} />
      </button>
      <img src={src} alt={alt || "Ảnh phóng to"} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
