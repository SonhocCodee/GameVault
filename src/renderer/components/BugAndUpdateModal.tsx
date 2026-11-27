import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type {
  AppUpdateStatus,
  BugCategory,
  BugReportItem,
  BugSeverity,
  BugStatus,
  PostUpdateInfo,
  RemoteReleaseNote,
} from '../../shared/types.js';
import { CHANGELOG_ENTRIES, type ChangelogEntry } from '../../shared/changelog.js';

export interface BugAndUpdateModalProps {
  isOpen: boolean;
  initialTab?: 'bugs' | 'updates';
  postUpdateInfo?: PostUpdateInfo | null;
  onAcknowledgePostUpdate?: (version: string) => void;
  onClose: () => void;
  onToast?: (msg: string) => void;
}

const CATEGORY_LABELS: Record<BugCategory, string> = {
  ui: 'Giao diện (UI)',
  tracker: 'Theo dõi giờ chơi',
  sync: 'Đồng bộ Cloud / Drive',
  updater: 'Cập nhật ứng dụng',
  other: 'Lỗi khác',
};

const SEVERITY_LABELS: Record<BugSeverity, { label: string; cls: string }> = {
  low: { label: 'Nhẹ', cls: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300' },
  medium: { label: 'Trung bình', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  high: { label: 'Nghiêm trọng', cls: 'border-red-500/40 bg-red-500/10 text-red-300' },
};

const STATUS_META: Record<BugStatus, { label: string; cls: string }> = {
  open: { label: 'Mới tiếp nhận', cls: 'border-sky-500/40 bg-sky-500/15 text-sky-300' },
  in_progress: { label: 'Đang sửa', cls: 'border-amber-500/40 bg-amber-500/15 text-amber-300' },
  fixed: { label: 'Đã fix', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' },
  wontfix: { label: 'Đã đóng', cls: 'border-zinc-500/40 bg-zinc-500/15 text-zinc-400' },
};

export const BugAndUpdateModal: React.FC<BugAndUpdateModalProps> = ({
  isOpen,
  initialTab = 'bugs',
  postUpdateInfo,
  onAcknowledgePostUpdate,
  onClose,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<'bugs' | 'updates'>(initialTab);

  // Bug form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<BugCategory>('ui');
  const [severity, setSeverity] = useState<BugSeverity>('medium');
  const [description, setDescription] = useState('');
  const [includeLogs, setIncludeLogs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Bug list state
  const [bugScope, setBugScope] = useState<'mine' | 'all'>('mine');
  const [bugs, setBugs] = useState<BugReportItem[]>([]);
  const [loadingBugs, setLoadingBugs] = useState(false);
  const [bugsError, setBugsError] = useState<string | null>(null);

  // Update & Changelog state
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [remoteReleases, setRemoteReleases] = useState<RemoteReleaseNote[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, postUpdateInfo]);

  const loadBugs = useCallback(async (scope: 'mine' | 'all' = bugScope) => {
    if (!window.electronAPI?.getBugReports) return;
    setLoadingBugs(true);
    setBugsError(null);
    try {
      const res = await window.electronAPI.getBugReports(scope);
      if (!res.ok) {
        setBugsError(res.error || 'Không tải được danh sách báo lỗi.');
        setBugs([]);
      } else {
        setBugs(res.bugs || []);
      }
    } catch (err: any) {
      setBugsError(err?.message || 'Lỗi kết nối máy chủ.');
    } finally {
      setLoadingBugs(false);
    }
  }, [bugScope]);

  const loadReleases = useCallback(async () => {
    setLoadingReleases(true);
    try {
      const list = await window.electronAPI?.fetchRemoteReleases?.();
      if (Array.isArray(list)) {
        setRemoteReleases(list);
      }
    } catch {
      // fallback to local CHANGELOG_ENTRIES
    } finally {
      setLoadingReleases(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI?.getUpdateStatus?.().then(setUpdateStatus).catch(() => {});
    const unsub = window.electronAPI?.onUpdateStatus?.(setUpdateStatus);
    void loadBugs(bugScope);
    void loadReleases();
    return () => {
      unsub?.();
    };
  }, [isOpen, bugScope, loadBugs, loadReleases]);

  const handleClose = () => {
    if (postUpdateInfo?.justUpdated) {
      onAcknowledgePostUpdate?.(postUpdateInfo.currentVersion);
    }
    onClose();
  };

  const handleSubmitBug = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (title.trim().length < 3) {
      setFormError('Vui lòng nhập tiêu đề lỗi (ít nhất 3 ký tự).');
      return;
    }
    if (description.trim().length < 5) {
      setFormError('Vui lòng mô tả chi tiết lỗi hoặc cách tái hiện (ít nhất 5 ký tự).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await window.electronAPI?.submitBugReport?.({
        title: title.trim(),
        category,
        severity,
        description: description.trim(),
        includeLogs,
      });
      if (!res?.ok) {
        setFormError(res?.error || 'Không gửi được báo lỗi.');
        return;
      }
      setTitle('');
      setDescription('');
      setFormSuccess('Đã gửi báo lỗi thành công! Cảm ơn bạn đã góp ý.');
      onToast?.('Đã gửi báo lỗi lên hệ thống!');
      await loadBugs(bugScope);
    } catch (err: any) {
      setFormError(err?.message || 'Lỗi không xác định khi gửi báo lỗi.');
    } finally {
      setSubmitting(false);
    }
  };

  // Merge local detailed changelog with any newer remote GitHub Releases
  const mergedChangelog = useMemo(() => {
    const localMap = new Map<string, ChangelogEntry>();
    for (const entry of CHANGELOG_ENTRIES) {
      localMap.set(entry.version, entry);
    }

    type DisplayEntry = ChangelogEntry & { rawBody?: string };
    const remoteOnly: DisplayEntry[] = [];

    for (const rel of remoteReleases) {
      if (!rel.version || localMap.has(rel.version)) continue;
      if (!rel.body) continue;
      remoteOnly.push({
        version: rel.version,
        date: rel.publishedAt ? rel.publishedAt.slice(0, 10) : '',
        summary: rel.name || `Phiên bản v${rel.version}`,
        fixes: [],
        rawBody: rel.body,
      });
    }

    return [...remoteOnly, ...CHANGELOG_ENTRIES] as DisplayEntry[];
  }, [remoteReleases]);

  if (!isOpen) return null;

  const currentVersion = postUpdateInfo?.currentVersion || updateStatus?.currentVersion || '1.0.6';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#2a2e3d] bg-[#0e1015] text-[#f1f3f7] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a2e3d] bg-[#161821] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ff2a44]/15 border border-[#ff2a44]/30 text-[#ff2a44]">
              {activeTab === 'bugs' ? <Bug className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Báo lỗi &amp; Cập nhật phiên bản</h2>
              <p className="text-[11px] text-[#8e95a5]">
                Phiên bản hiện tại: <span className="font-mono font-semibold text-white">v{currentVersion}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab Switcher */}
            <div className="flex items-center rounded-lg border border-[#2a2e3d] bg-[#0e1015] p-1">
              <button
                type="button"
                onClick={() => setActiveTab('bugs')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                  activeTab === 'bugs'
                    ? 'bg-[#ff2a44] text-white shadow-sm'
                    : 'text-[#8e95a5] hover:text-white'
                }`}
              >
                <Bug className="h-3.5 w-3.5" />
                <span>Báo lỗi (Bug)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('updates')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                  activeTab === 'updates'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-[#8e95a5] hover:text-white'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Cập nhật &amp; Đã fix gì</span>
                {(updateStatus?.state === 'downloaded' || postUpdateInfo?.justUpdated) && (
                  <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg p-1.5 text-[#8e95a5] hover:bg-[#202433] hover:text-white transition-colors"
              title="Đóng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'bugs' ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left: Submit Bug Form */}
              <form onSubmit={handleSubmitBug} className="space-y-4 lg:col-span-5">
                <div className="rounded-xl border border-[#2a2e3d] bg-[#161821] p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Gửi báo lỗi mới</h3>
                    <button
                      type="button"
                      onClick={() => window.electronAPI?.openLogFolder?.()}
                      className="flex items-center gap-1 text-[11px] text-[#8e95a5] hover:text-white transition-colors"
                      title="Mở thư mục chứa file gamevault.log"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>Mở log</span>
                    </button>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#c9cfdc]">
                      Tiêu đề lỗi <span className="text-[#ff2a44]">*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="VD: Bấm xóa game bị đơ, không hiện ảnh bìa..."
                      maxLength={160}
                      className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white placeholder-[#6b7280] outline-none focus:border-[#ff2a44]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#c9cfdc]">Phân loại</label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as BugCategory)}
                        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-2 text-xs text-white outline-none focus:border-[#ff2a44]"
                      >
                        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#c9cfdc]">Mức độ</label>
                      <select
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value as BugSeverity)}
                        className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-2 text-xs text-white outline-none focus:border-[#ff2a44]"
                      >
                        <option value="low">Nhẹ</option>
                        <option value="medium">Trung bình</option>
                        <option value="high">Nghiêm trọng</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#c9cfdc]">
                      Mô tả chi tiết &amp; cách tái hiện <span className="text-[#ff2a44]">*</span>
                    </label>
                    <textarea
                      rows={5}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Mô tả bạn đã thao tác gì trước khi gặp lỗi, lỗi hiển thị ra sao..."
                      maxLength={4000}
                      className="w-full resize-none rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white placeholder-[#6b7280] outline-none focus:border-[#ff2a44]"
                    />
                  </div>

                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[#2a2e3d] bg-[#0e1015]/70 p-2.5 text-[11px] text-[#9aa3b8]">
                    <input
                      type="checkbox"
                      checked={includeLogs}
                      onChange={(e) => setIncludeLogs(e.target.checked)}
                      className="mt-0.5 accent-[#ff2a44]"
                    />
                    <span>
                      Tự động đính kèm file log chẩn đoán (<code className="text-white">gamevault.log</code>) và thông tin OS/GPU để dễ tìm &amp; sửa lỗi nhanh hơn.
                    </span>
                  </label>

                  {formError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-300">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {formSuccess && (
                    <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-300">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{formSuccess}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#ff2a44] px-4 py-2.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50 transition-all"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    <span>{submitting ? 'Đang gửi báo lỗi...' : 'Gửi báo lỗi'}</span>
                  </button>
                </div>
              </form>

              {/* Right: Bug Reports List */}
              <div className="flex flex-col lg:col-span-7">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">Theo dõi tiến độ sửa lỗi</h3>
                    <div className="flex rounded-lg border border-[#2a2e3d] bg-[#161821] p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setBugScope('mine')}
                        className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                          bugScope === 'mine' ? 'bg-[#2a2e3d] text-white' : 'text-[#8e95a5] hover:text-white'
                        }`}
                      >
                        Của tôi
                      </button>
                      <button
                        type="button"
                        onClick={() => setBugScope('all')}
                        className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                          bugScope === 'all' ? 'bg-[#2a2e3d] text-white' : 'text-[#8e95a5] hover:text-white'
                        }`}
                      >
                        Tất cả
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => loadBugs(bugScope)}
                    disabled={loadingBugs}
                    className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-2.5 py-1.5 text-[11px] font-semibold text-[#c9cfdc] hover:bg-[#202433] disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingBugs ? 'animate-spin' : ''}`} />
                    <span>Làm mới</span>
                  </button>
                </div>

                {bugsError ? (
                  <div className="rounded-xl border border-[#2a2e3d] bg-[#161821] p-6 text-center text-xs text-[#9aa3b8]">
                    {bugsError}
                  </div>
                ) : loadingBugs && bugs.length === 0 ? (
                  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-[#2a2e3d] bg-[#161821]">
                    <Loader2 className="h-6 w-6 animate-spin text-[#ff2a44]" />
                  </div>
                ) : bugs.length === 0 ? (
                  <div className="rounded-xl border border-[#2a2e3d] bg-[#161821] p-8 text-center text-xs text-[#8e95a5]">
                    Chưa có báo lỗi nào được ghi nhận.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {bugs.map((bug) => {
                      const st = STATUS_META[bug.status] || STATUS_META.open;
                      const sev = SEVERITY_LABELS[bug.severity] || SEVERITY_LABELS.medium;
                      return (
                        <div
                          key={bug.id}
                          className="rounded-xl border border-[#2a2e3d] bg-[#161821] p-3.5 transition-colors hover:border-[#3a4054]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-[10px] text-[#8e95a5]">#{bug.id}</span>
                                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${st.cls}`}>
                                  {st.label}
                                  {bug.status === 'fixed' && bug.fixed_in_version
                                    ? ` (${bug.fixed_in_version.startsWith('v') ? bug.fixed_in_version : `v${bug.fixed_in_version}`})`
                                    : ''}
                                </span>
                                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${sev.cls}`}>
                                  {sev.label}
                                </span>
                                <span className="rounded bg-[#222638] px-1.5 py-0.5 text-[10px] text-[#9aa3b8]">
                                  {CATEGORY_LABELS[bug.category] || bug.category}
                                </span>
                                {bug.app_version && (
                                  <span className="font-mono text-[10px] text-[#8e95a5]">v{bug.app_version}</span>
                                )}
                              </div>
                              <h4 className="mt-1.5 text-xs font-bold text-white">{bug.title}</h4>
                            </div>
                            <span className="text-[10px] text-[#8e95a5]">
                              {bug.created_at ? bug.created_at.slice(0, 16).replace('T', ' ') : ''}
                            </span>
                          </div>

                          <p className="mt-1.5 whitespace-pre-line text-[11px] leading-relaxed text-[#b4bccb]">
                            {bug.description}
                          </p>

                          {bug.admin_note && (
                            <div className="mt-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
                              <span className="font-bold text-emerald-300">Phản hồi: </span>
                              {bug.admin_note}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Tab 2: Updates & Changelog */
            <div className="space-y-5">
              {/* Post-Update Celebration Banner */}
              {postUpdateInfo?.justUpdated && (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          Đã cập nhật lên GameVault v{postUpdateInfo.currentVersion}!
                        </h3>
                        <p className="text-[11px] text-emerald-200/80">
                          {postUpdateInfo.previousVersion
                            ? `Nâng cấp từ v${postUpdateInfo.previousVersion} → v${postUpdateInfo.currentVersion}. Dưới đây là những gì đã được sửa và nâng cấp.`
                            : 'Dưới đây là những thay đổi mới nhất trong phiên bản này.'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAcknowledgePostUpdate?.(postUpdateInfo.currentVersion)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      Đã hiểu
                    </button>
                  </div>
                </div>
              )}

              {/* App Update Status Card */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#2a2e3d] bg-[#161821] p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-sky-400" />
                    <span className="text-sm font-bold text-white">Kiểm tra &amp; Cài đặt cập nhật</span>
                    <span className="rounded bg-[#222638] px-2 py-0.5 font-mono text-[11px] text-[#9aa3b8]">
                      v{updateStatus?.currentVersion || currentVersion}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#9aa3b8]">
                    {updateStatus?.message || 'Tự động kiểm tra bản cập nhật mới từ GitHub Releases.'}
                  </p>
                  {updateStatus?.state === 'downloading' && typeof updateStatus.percent === 'number' && (
                    <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#242838]">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.max(4, updateStatus.percent)}%` }}
                      />
                    </div>
                  )}
                  {updateStatus?.releaseNotes && (
                    <div className="mt-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5 text-[11px] text-sky-100 whitespace-pre-line">
                      <strong className="block mb-1 text-sky-300">
                        Ghi chú bản v{updateStatus.latestVersion}:
                      </strong>
                      {updateStatus.releaseNotes}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {updateStatus?.state === 'downloaded' ? (
                    <button
                      type="button"
                      onClick={() => window.electronAPI?.installUpdate?.()}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors"
                    >
                      Cập nhật &amp; Khởi động lại
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => window.electronAPI?.checkForUpdates?.()}
                      disabled={updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'}
                      className="flex items-center gap-1.5 rounded-lg border border-[#2e3446] bg-[#1f2433] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#2a3044] disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${updateStatus?.state === 'checking' ? 'animate-spin' : ''}`}
                      />
                      <span>{updateStatus?.state === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Changelog List */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <Wrench className="h-4 w-4 text-emerald-400" />
                    <span>Nhật ký thay đổi &amp; Lỗi đã sửa (Changelog)</span>
                  </h3>
                  {loadingReleases && (
                    <span className="flex items-center gap-1 text-[11px] text-[#8e95a5]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Đang đồng bộ GitHub Releases...
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {mergedChangelog.map((entry, idx) => {
                    const isCurrent = entry.version === currentVersion.replace(/^v/i, '');
                    return (
                      <div
                        key={entry.version}
                        className={`rounded-xl border p-4 ${
                          isCurrent
                            ? 'border-emerald-500/40 bg-[#161821]'
                            : 'border-[#2a2e3d] bg-[#161821]/70'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-[#222638] px-2 py-0.5 font-mono text-xs font-bold text-white">
                              v{entry.version}
                            </span>
                            {isCurrent && (
                              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                Đang sử dụng
                              </span>
                            )}
                            {idx === 0 && !isCurrent && (
                              <span className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                                Mới nhất
                              </span>
                            )}
                          </div>
                          {entry.date && <span className="text-[11px] text-[#8e95a5]">{entry.date}</span>}
                        </div>

                        <p className="mt-2 text-xs font-semibold text-[#e2e8f0]">{entry.summary}</p>

                        {entry.rawBody ? (
                          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-[#b4bccb]">
                            {entry.rawBody}
                          </p>
                        ) : (
                          <div className="mt-3 space-y-2.5 text-xs">
                            {entry.fixes && entry.fixes.length > 0 && (
                              <div>
                                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                                  Đã sửa lỗi (Fixed)
                                </div>
                                <ul className="space-y-1 pl-4 text-[#cbd5e1] list-disc">
                                  {entry.fixes.map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {entry.features && entry.features.length > 0 && (
                              <div>
                                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-400">
                                  Tính năng mới
                                </div>
                                <ul className="space-y-1 pl-4 text-[#cbd5e1] list-disc">
                                  {entry.features.map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {entry.improvements && entry.improvements.length > 0 && (
                              <div>
                                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-400">
                                  Cải thiện
                                </div>
                                <ul className="space-y-1 pl-4 text-[#cbd5e1] list-disc">
                                  {entry.improvements.map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
