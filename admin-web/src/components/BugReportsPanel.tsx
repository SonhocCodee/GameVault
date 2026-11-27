import React, { useCallback, useEffect, useState } from 'react';
import { Bug, CheckCircle2, Loader2, RefreshCw, Save } from 'lucide-react';
import {
  type AdminBugReportItem,
  fetchAdminBugDetail,
  fetchAdminBugs,
  updateAdminBug,
} from '../api.ts';

const STATUS_META: Record<AdminBugReportItem['status'], { label: string; cls: string }> = {
  open: { label: 'Mới tiếp nhận', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  in_progress: { label: 'Đang sửa', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  fixed: { label: 'Đã fix', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  wontfix: { label: 'Đã đóng', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' },
};

export const BugReportsPanel: React.FC = () => {
  const [bugs, setBugs] = useState<AdminBugReportItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminBugReportItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [editStatus, setEditStatus] = useState<AdminBugReportItem['status']>('open');
  const [fixedVersion, setFixedVersion] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadBugs = useCallback(async (st = statusFilter) => {
    setLoading(true);
    try {
      const res = await fetchAdminBugs(st);
      setBugs(res.bugs || []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadBugs(statusFilter);
  }, [statusFilter, loadBugs]);

  const handleSelect = async (id: number) => {
    setSelectedId(id);
    setMsg(null);
    setLoadingDetail(true);
    try {
      const res = await fetchAdminBugDetail(id);
      setDetail(res.bug);
      setEditStatus(res.bug.status);
      setFixedVersion(res.bug.fixed_in_version || '');
      setAdminNote(res.bug.admin_note || '');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await updateAdminBug(detail.id, {
        status: editStatus,
        fixed_in_version: fixedVersion.trim(),
        admin_note: adminNote.trim(),
      });
      setDetail((prev) => (prev ? { ...prev, ...res.bug } : res.bug));
      setBugs((prev) => prev.map((b) => (b.id === detail.id ? { ...b, ...res.bug } : b)));
      setMsg('Đã lưu cập nhật trạng thái bug.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left list */}
      <div className="lg:col-span-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-bold text-white">Danh sách Bug Reports ({bugs.length})</h2>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-[#262b3d] bg-[#161a26] px-2.5 py-1.5 text-xs text-white outline-none"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="open">Mới tiếp nhận</option>
              <option value="in_progress">Đang sửa</option>
              <option value="fixed">Đã fix</option>
              <option value="wontfix">Đã đóng</option>
            </select>
            <button
              onClick={() => loadBugs(statusFilter)}
              disabled={loading}
              className="rounded-lg border border-[#262b3d] bg-[#161a26] p-1.5 text-[#8e95a5] hover:text-white"
              title="Làm mới"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {bugs.length === 0 ? (
            <div className="rounded-xl border border-[#262b3d] bg-[#121520] p-6 text-center text-xs text-[#8e95a5]">
              Không có bug nào.
            </div>
          ) : (
            bugs.map((b) => {
              const st = STATUS_META[b.status] || STATUS_META.open;
              return (
                <button
                  key={b.id}
                  onClick={() => handleSelect(b.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    selectedId === b.id
                      ? 'border-amber-500/60 bg-[#1a1f2e]'
                      : 'border-[#262b3d] bg-[#121520] hover:border-[#363d54]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-[#8e95a5]">#{b.id}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${st.cls}`}>
                        {st.label}
                        {b.fixed_in_version ? ` (${b.fixed_in_version})` : ''}
                      </span>
                      <span className="rounded bg-[#1e2333] px-1.5 py-0.5 text-[10px] text-[#9aa3b8]">
                        {b.category}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#8e95a5]">v{b.app_version || '?'}</span>
                  </div>
                  <div className="mt-1.5 text-xs font-bold text-white line-clamp-1">{b.title}</div>
                  <div className="mt-1 text-[10px] text-[#8e95a5]">
                    {b.email || b.uid} • {b.created_at?.slice(0, 16).replace('T', ' ')}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right detail & action */}
      <div className="lg:col-span-7">
        {loadingDetail ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-[#262b3d] bg-[#121520]">
            <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
          </div>
        ) : !detail ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-[#262b3d] bg-[#121520] text-xs text-[#8e95a5]">
            Chọn một bug ở danh sách bên trái để xem chi tiết, log và cập nhật trạng thái fix.
          </div>
        ) : (
          <div className="rounded-xl border border-[#262b3d] bg-[#121520] p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#262b3d] pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  #{detail.id} — {detail.title}
                </h3>
                <p className="mt-1 text-[11px] text-[#8e95a5]">
                  Người báo: <span className="text-white">{detail.email || detail.uid}</span> • App{' '}
                  <span className="font-mono text-white">v{detail.app_version}</span> • {detail.platform}
                </p>
                {detail.gpu_summary && (
                  <p className="mt-0.5 text-[11px] text-[#8e95a5]">GPU: {detail.gpu_summary}</p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#8e95a5]">Mô tả lỗi</div>
              <div className="rounded-lg border border-[#262b3d] bg-[#0b0d13] p-3 text-xs whitespace-pre-line text-[#e2e8f0]">
                {detail.description}
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-3 rounded-lg border border-[#262b3d] bg-[#161a26] p-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-[#c6cde0]">Trạng thái xử lý</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as AdminBugReportItem['status'])}
                    className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-2.5 py-2 text-xs text-white outline-none"
                  >
                    <option value="open">Mới tiếp nhận</option>
                    <option value="in_progress">Đang sửa</option>
                    <option value="fixed">Đã fix</option>
                    <option value="wontfix">Đã đóng</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-[#c6cde0]">Đã fix ở bản (Version)</label>
                  <input
                    type="text"
                    value={fixedVersion}
                    onChange={(e) => setFixedVersion(e.target.value)}
                    placeholder="VD: 1.0.8"
                    className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-2.5 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[#c6cde0]">Ghi chú phản hồi cho người dùng</label>
                <textarea
                  rows={2}
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="VD: Đã sửa lỗi kẹt bấm khi xóa game, cập nhật lên v1.0.8 để nhận bản vá."
                  className="w-full rounded-lg border border-[#262b3d] bg-[#0b0d13] px-2.5 py-2 text-xs text-white outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                {msg ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {msg}
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  <span>Lưu trạng thái</span>
                </button>
              </div>
            </form>

            {detail.log_text && (
              <div>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#8e95a5]">
                  Diagnostic Log đính kèm ({detail.log_text.length} ký tự)
                </div>
                <pre className="max-h-60 overflow-auto rounded-lg border border-[#262b3d] bg-[#0b0d13] p-3 font-mono text-[10px] leading-relaxed text-[#9aa3b8]">
                  {detail.log_text}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
