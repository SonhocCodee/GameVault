import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DesktopCommunity } from '../community/DesktopCommunity.tsx';
import type { PublicGame } from '../../shared/community.ts';
import {
  Users,
  Trophy,
  Star,
  Loader2,
  LogIn,
  AlertCircle,
  RefreshCw,
  Heart,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Droplet,
  Gauge,
  ArrowLeft,
  Trash2,
  Send,
} from 'lucide-react';
import type { CloudReview, CommunityPick, Game, LeaderboardEntry } from '../../shared/types.js';

/** Mirrors cloud-db.ts computeGameKey — joins cloud reviews with local games. */
function computeGameKeyClient(game: Game): string {
  if (game.steam_id && Number(game.steam_id) > 0) {
    return String(Number(game.steam_id));
  }
  return `t_${game.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function formatPlaytimeMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h` : `${minutes}p`;
}

interface CommunityViewProps {
  initialGame?: PublicGame | null;
  onLocalGame?: (id: number) => void;
  onBack: () => void;
  authStatus?: import('../../shared/types.ts').AuthStatus | null;
}

export const LegacyCommunityView: React.FC<CommunityViewProps> = ({ onBack }) => {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [configPresent, setConfigPresent] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortByGu, setSortByGu] = useState<boolean>(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reviews, setReviews] = useState<CloudReview[] | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState<boolean>(false);
  const [games, setGames] = useState<Game[]>([]);
  const [pick, setPick] = useState<CommunityPick | null>(null);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Review composer state
  const [myScore, setMyScore] = useState<number>(8);
  const [myReview, setMyReview] = useState<string>('');
  const [myDropped, setMyDropped] = useState<boolean>(false);
  const [myDropReason, setMyDropReason] = useState<string>('');
  const [myFps, setMyFps] = useState<string>('');

  const authErrorMessage = (err: any) => {
    let msg = String(err?.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    if (msg.includes('access_denied') || msg.includes('Google trả về lỗi: access_denied')) {
      return 'Tài khoản chưa được cấp quyền (nếu app đang ở chế độ Testing trên Google Cloud, cần thêm email vào Test Users, hoặc chuyển app sang Publish/Production).';
    }
    return msg;
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await window.electronAPI.getAuthStatus();
      setLoggedIn(status.loggedIn);
      setConfigPresent(status.configPresent);
      if (status.loggedIn) {
        const [board, pickData, lib] = await Promise.all([
          window.electronAPI.getLeaderboard?.() ?? [],
          window.electronAPI.getCurrentPick?.().catch(() => null) ?? null,
          window.electronAPI.getGames(),
        ]);
        setEntries(board);
        setPick(pickData);
        setGames(lib);
      }
    } catch (err: any) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const loadReviews = useCallback(async (gameKey: string) => {
    setReviewsLoading(true);
    try {
      const list = (await window.electronAPI.getGameReviews?.(gameKey)) || [];
      setReviews(list);
    } catch (err: any) {
      setError(authErrorMessage(err));
      setReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  const handleSelectGame = (entry: LeaderboardEntry) => {
    if (selectedKey === entry.gameKey) {
      setSelectedKey(null);
      setReviews(null);
      return;
    }
    setSelectedKey(entry.gameKey);
    setReviews(null);
    if (entry.myScore != null) setMyScore(entry.myScore);
    loadReviews(entry.gameKey);
  };

  const selectedEntry = useMemo(
    () => entries.find((e) => e.gameKey === selectedKey) || null,
    [entries, selectedKey]
  );

  const localGameForKey = useCallback(
    (gameKey: string): Game | null => games.find((g) => computeGameKeyClient(g) === gameKey) || null,
    [games]
  );

  const handleLogin = async () => {
    setBusy('login');
    setError(null);
    try {
      await window.electronAPI.login();
      await loadAll();
    } catch (err: any) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async () => {
    setBusy('refresh');
    try {
      await loadAll();
      if (selectedKey) await loadReviews(selectedKey);
    } finally {
      setBusy(null);
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedEntry) return;
    const localGame = localGameForKey(selectedEntry.gameKey);
    if (!localGame) {
      setError('Game này chưa có trong thư viện máy bạn — thêm vào thư viện rồi đăng review nhé.');
      return;
    }
    setBusy('submit');
    setError(null);
    try {
      await window.electronAPI.submitReview?.(localGame.id, {
        score: myScore,
        review: myReview,
        dropped: myDropped,
        dropReason: myDropped ? myDropReason : undefined,
        fps: myFps ? parseInt(myFps) : undefined,
      });
      setMyReview('');
      setMyFps('');
      await loadAll();
      await loadReviews(selectedEntry.gameKey);
    } catch (err: any) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteMyReview = async () => {
    if (!selectedEntry) return;
    const localGame = localGameForKey(selectedEntry.gameKey);
    if (!localGame) return;
    setBusy('delete');
    try {
      await window.electronAPI.deleteMyReview?.(localGame.id);
      await loadAll();
      await loadReviews(selectedEntry.gameKey);
    } catch (err: any) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleVote = async (game: Game) => {
    setBusy('vote');
    setError(null);
    try {
      const updated = (await window.electronAPI.votePick?.(game.id)) ?? null;
      setPick(updated);
      setPickerOpen(false);
    } catch (err: any) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleUnvote = async () => {
    setBusy('vote');
    try {
      const updated = (await window.electronAPI.unvotePick?.()) ?? null;
      setPick(updated);
    } catch (err: any) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pickTally = useMemo(() => {
    if (!pick) return null;
    const counts = new Map<string, number>();
    for (const gameKey of Object.values(pick.votes || {})) {
      counts.set(gameKey, (counts.get(gameKey) || 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return { total: Object.keys(pick.votes || {}).length, top: sorted };
  }, [pick]);

  // ============ Not logged in ============
  if (loggedIn === false) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-2 text-xs font-semibold text-[#8e95a5] hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Thư viện
        </button>
        <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] p-10 text-center space-y-4">
          <Users className="mx-auto h-10 w-10 text-sky-400" />
          <h2 className="text-lg font-bold text-white">Cộng đồng GameVault</h2>
          <p className="text-xs leading-relaxed text-[#8e95a5]">
            Đăng nhập bằng Google để thấy bảng xếp hạng game do cộng đồng chấm, review thật của người chơi thật
            (kèm cấu hình máy + FPS), và bình chọn "Game tháng này".
          </p>
          {!configPresent && (
            <p className="mx-auto max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
              Chưa có cloud-config.json — người phân phối app cần hoàn tất SETUP.md trước khi login hoạt động.
            </p>
          )}
          <button
            onClick={handleLogin}
            disabled={busy !== null}
            className="mx-auto flex items-center gap-2.5 rounded-xl bg-white px-6 py-2.5 text-xs font-bold text-gray-900 shadow hover:bg-gray-100 disabled:opacity-50 transition-all cursor-pointer"
          >
            {busy === 'login' ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#4285F4]" />
            ) : (
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
            )}
            <span>{busy === 'login' ? 'Đang mở trình duyệt...' : 'Đăng nhập bằng tài khoản Google'}</span>
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  // ============ Main view ============
  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Users className="h-5 w-5 text-sky-400" />
          Cộng đồng
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortByGu((v) => !v)}
            disabled={entries.length === 0}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              sortByGu
                ? 'border-sky-400/50 bg-sky-500/10 text-sky-300'
                : 'border-[#2a2e3d] bg-[#161821] text-[#8e95a5] hover:text-white'
            } disabled:opacity-40`}
            title="Xếp theo điểm từ người có gu giống bạn nhất (cần bạn đã chấm ≥3 game trùng)"
          >
            <Heart className="h-3.5 w-3.5" />
            {sortByGu ? 'Sắp theo: Gần gu bạn' : 'Sắp theo: Nhiều review'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#161821] px-3 py-1.5 text-xs font-semibold text-[#8e95a5] transition hover:border-sky-400 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center text-sm text-[#8e95a5]">
          <Loader2 className="h-5 w-5 animate-spin" /> Đang tải bảng xếp hạng...
        </div>
      ) : (
        <div className="space-y-5">
          {/* Game tháng này */}
          <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <CalendarDays className="h-4 w-4 text-amber-400" />
                Game tháng này
              </h3>
              {pick && (
                <span className="rounded bg-[#2a2e3d] px-2 py-0.5 text-[10px] font-mono text-[#8e95a5]">
                  {pick.month} · {pickTally?.total || 0} vote
                </span>
              )}
            </div>
            {!pick || pickTally?.total === 0 ? (
              <p className="text-xs text-[#8e95a5]/70">
                Chưa ai bình chọn tháng này. Hãy là người đầu tiên chọn một game từ thư viện để cả nhóm cùng chơi!
              </p>
            ) : (
              <div className="space-y-1.5">
                {pickTally?.top.slice(0, 3).map(([gameKey, count], idx) => {
                  const local = localGameForKey(gameKey);
                  const entry = entries.find((e) => e.gameKey === gameKey);
                  return (
                    <div
                      key={gameKey}
                      className="flex items-center justify-between gap-3 rounded-lg bg-[#0e1015] px-3 py-2 border border-[#2a2e3d]/50"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {idx === 0 && <Trophy className="h-4 w-4 shrink-0 text-amber-400" />}
                        <span className="truncate text-xs font-semibold text-white">
                          {local?.title || entry?.gameTitle || gameKey}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {entry && (
                          <span className="font-mono text-[10px] text-amber-300">★ {entry.avgScore.toFixed(1)}</span>
                        )}
                        <span className="rounded bg-[#2a2e3d] px-2 py-0.5 text-[10px] text-[#8e95a5]">{count} vote</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              {pick && Object.keys(pick.votes || {}).length > 0 && (
                <button
                  onClick={handleUnvote}
                  disabled={busy !== null}
                  className="rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-[11px] font-semibold text-[#8e95a5] hover:text-white disabled:opacity-50"
                >
                  Bỏ bình chọn của tôi
                </button>
              )}
              <button
                onClick={() => setPickerOpen((v) => !v)}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-black shadow hover:brightness-110 disabled:opacity-50"
              >
                <Heart className="h-3.5 w-3.5" />
                Bình chọn từ thư viện
              </button>
            </div>
            {pickerOpen && (
              <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-2">
                {games
                  .filter((g) => g.status !== 'backlog')
                  .slice(0, 50)
                  .map((g) => (
                    <button
                      key={g.id}
                      onClick={() => handleVote(g)}
                      disabled={busy !== null}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs text-[#8e95a5] transition hover:bg-[#161821] hover:text-white disabled:opacity-50"
                    >
                      <span className="truncate">{g.title}</span>
                      {busy === 'vote' && <Loader2 className="h-3 w-3 animate-spin" />}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <div className="rounded-2xl border border-[#2a2e3d] bg-[#161821] p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <Trophy className="h-4 w-4 text-amber-400" />
              Bảng xếp hạng cộng đồng ({entries.length} game được review)
            </h3>
            {entries.length === 0 ? (
              <p className="py-3 text-xs text-[#8e95a5]/70">
                Chưa có review nào trên cloud. Hãy là người đầu tiên — vào một game trong thư viện và đăng review nhé!
              </p>
            ) : (
              <div className="space-y-1.5">
                {entries.map((entry) => {
                  const isSelected = selectedKey === entry.gameKey;
                  return (
                    <div key={entry.gameKey}>
                      <button
                        onClick={() => handleSelectGame(entry)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 border transition ${
                          isSelected
                            ? 'border-sky-400/50 bg-[#0e1015]'
                            : 'border-[#2a2e3d]/50 bg-[#0e1015] hover:border-[#2a2e3d]'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {entry.coverUrl ? (
                            <img
                              src={entry.coverUrl}
                              alt=""
                              className="h-10 w-7 shrink-0 rounded object-cover"
                              referrerPolicy="no-referrer"
                              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                            />
                          ) : (
                            <span className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-[#2a2e3d]">
                              <Star className="h-3 w-3 text-[#8e95a5]" />
                            </span>
                          )}
                          <div className="min-w-0 text-left">
                            <div className="truncate text-xs font-bold text-white">{entry.gameTitle}</div>
                            <div className="flex items-center gap-2 text-[10px] text-[#8e95a5]">
                              <span>{entry.reviewCount} review</span>
                              {entry.dropRate > 0 && (
                                <span className="flex items-center gap-0.5 text-amber-400/80">
                                  <Droplet className="h-2.5 w-2.5" />
                                  {Math.round(entry.dropRate * 100)}% drop
                                </span>
                              )}
                              <span>{formatPlaytimeMinutes(entry.totalPlaytimeMinutes)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {entry.guMatchScore != null && (
                            <span
                              className="rounded border border-sky-400/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300"
                              title="Độ gần gu với bạn (0-100)"
                            >
                              gần gu {entry.guMatchScore}
                            </span>
                          )}
                          {entry.myScore != null && (
                            <span className="rounded bg-[#2a2e3d] px-1.5 py-0.5 text-[10px] text-[#8e95a5]">
                              bạn: {entry.myScore}
                            </span>
                          )}
                          <span className="font-mono text-sm font-bold text-amber-300">★ {entry.avgScore.toFixed(1)}</span>
                          {isSelected ? (
                            <ChevronUp className="h-3.5 w-3.5 text-[#8e95a5]" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-[#8e95a5]" />
                          )}
                        </div>
                      </button>

                      {/* Reviews panel */}
                      {isSelected && (
                        <div className="mt-1.5 rounded-xl border border-[#2a2e3d] bg-[#0e1015] p-3 space-y-3">
                          {reviewsLoading ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-[#8e95a5]">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải review...
                            </div>
                          ) : (
                            <>
                              <div className="space-y-2">
                                {(reviews || []).map((r, i) => (
                                  <div
                                    key={`${r.uid}-${i}`}
                                    className="rounded-lg bg-[#161821] px-3 py-2 border border-[#2a2e3d]/50"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex min-w-0 items-center gap-2">
                                        {r.authorPhoto ? (
                                          <img
                                            src={r.authorPhoto}
                                            alt=""
                                            className="h-5 w-5 rounded-full object-cover"
                                            referrerPolicy="no-referrer"
                                          />
                                        ) : (
                                          <span className="h-5 w-5 rounded-full bg-[#2a2e3d]" />
                                        )}
                                        <span className="truncate text-xs font-semibold text-white">
                                          {r.authorName || 'Ẩn danh'}
                                        </span>
                                        {r.authorHw?.gpu && (
                                          <span
                                            className="flex items-center gap-0.5 rounded bg-[#2a2e3d] px-1.5 py-0.5 text-[9px] text-[#8e95a5]"
                                            title={`${r.authorHw.cpu || 'CPU?'} · ${r.authorHw.ramGb || '?'}GB RAM`}
                                          >
                                            <Gauge className="h-2.5 w-2.5" />
                                            {r.authorHw.gpu}
                                            {r.fps ? ` · ${r.fps} FPS` : ''}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex shrink-0 items-center gap-1.5">
                                        {r.dropped && (
                                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-400">
                                            thử rồi drop{r.dropReason ? `: ${r.dropReason}` : ''}
                                          </span>
                                        )}
                                        <span className="font-mono text-xs font-bold text-amber-300">★ {r.score}</span>
                                      </div>
                                    </div>
                                    {r.review && (
                                      <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[#c6cad4]">
                                        {r.review}
                                      </p>
                                    )}
                                    <div className="mt-1 text-right font-mono text-[9px] text-[#8e95a5]/60">
                                      {formatPlaytimeMinutes(r.playtimeMinutes)} chơi · {r.updatedAt.slice(0, 10)}
                                    </div>
                                  </div>
                                ))}
                                {(reviews || []).length === 0 && (
                                  <p className="py-1 text-xs text-[#8e95a5]/70">Chưa có review nào cho game này.</p>
                                )}
                              </div>

                              {/* Composer */}
                              {selectedEntry && localGameForKey(selectedEntry.gameKey) ? (
                                <div className="rounded-lg border border-[#2a2e3d] bg-[#161821] p-3 space-y-2.5">
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs font-semibold text-[#8e95a5]">Điểm của bạn:</span>
                                    <input
                                      type="range"
                                      min={1}
                                      max={10}
                                      step={0.5}
                                      value={myScore}
                                      onChange={(e) => setMyScore(Number(e.target.value))}
                                      className="flex-1 accent-amber-400"
                                    />
                                    <span className="font-mono text-sm font-bold text-amber-300">{myScore.toFixed(1)}</span>
                                  </div>
                                  <textarea
                                    value={myReview}
                                    onChange={(e) => setMyReview(e.target.value)}
                                    placeholder="Review ngắn gọn: gameplay, tối ưu, đáng tải không... (không spoiler)"
                                    className="w-full rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                                    rows={3}
                                  />
                                  <div className="flex flex-wrap items-center gap-3">
                                    <label className="flex items-center gap-1.5 text-xs text-[#8e95a5]">
                                      <input
                                        type="checkbox"
                                        checked={myDropped}
                                        onChange={(e) => setMyDropped(e.target.checked)}
                                        className="accent-amber-400"
                                      />
                                      Thử rồi drop
                                    </label>
                                    {myDropped && (
                                      <input
                                        value={myDropReason}
                                        onChange={(e) => setMyDropReason(e.target.value)}
                                        placeholder="Lý do (vd: tối ưu tệ)"
                                        className="flex-1 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2.5 py-1.5 text-xs text-white outline-none focus:border-amber-400"
                                      />
                                    )}
                                    <div className="flex items-center gap-1.5 text-xs text-[#8e95a5]">
                                      <Gauge className="h-3.5 w-3.5" />
                                      <input
                                        value={myFps}
                                        onChange={(e) => setMyFps(e.target.value.replace(/[^0-9]/g, ''))}
                                        placeholder="FPS"
                                        className="w-16 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-2 py-1.5 font-mono text-white outline-none focus:border-sky-400"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={handleDeleteMyReview}
                                      disabled={busy !== null}
                                      className="flex items-center gap-1.5 rounded-lg border border-[#2a2e3d] bg-[#0e1015] px-3 py-1.5 text-[11px] font-semibold text-[#8e95a5] transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
                                      title="Xóa review của tôi về game này khỏi cloud"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      Xóa review của tôi
                                    </button>
                                    <button
                                      onClick={handleSubmitReview}
                                      disabled={busy !== null}
                                      className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-[11px] font-bold text-white shadow hover:brightness-110 disabled:opacity-50"
                                    >
                                      {busy === 'submit' ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Send className="h-3 w-3" />
                                      )}
                                      Đăng lên cộng đồng
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-[11px] text-[#8e95a5]/70">
                                  Game này chưa có trong thư viện của bạn — thêm vào thư viện để đăng review.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const CommunityView: React.FC<CommunityViewProps> = ({ authStatus, initialGame, onLocalGame }) => <DesktopCommunity authStatus={authStatus} initialGame={initialGame} onLocalGame={onLocalGame} />;
