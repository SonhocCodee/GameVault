export interface CommunitySearchRequest {
  scope: "posts" | "players";
  query: string;
  sequence: number;
}
export interface PublicGame {
  gameKey: string;
  title: string;
  steamId?: number | null;
  coverUrl?: string | null;
}
export interface PublicProfile {
  uid: string;
  nickname: string;
  bio: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  avatarPreset?: string | null;
  bannerPreset?: string | null;
  defaultAvatarUrl?: string | null;
  defaultBannerUrl?: string | null;
  shareLibrary: boolean;
  suspended?: boolean;
  isAdmin?: boolean;
  blocked?: boolean;
  isFollowing?: boolean;
  followersCount?: number;
  followingCount?: number;
  totalGames?: number;
  completedGames?: number;
  playedGames?: number;
  totalMinutes?: number;
  recordedMinutes?: number;
  games?: SharedLibraryGame[];
}
export interface SharedLibraryGame extends PublicGame {
  status: string;
  playtimeMinutes: number;
  recordedPlaytimeMinutes?: number;
  bannerUrl?: string | null;
  localGameId?: number;
}
export interface PlayerRanking {
  uid: string;
  nickname: string;
  avatarUrl?: string | null;
  bio?: string;
  bannerUrl?: string | null;
  totalMinutes: number;
  recordedMinutes?: number;
  completedGames: number;
  totalGames: number;
  topGames?: SharedLibraryGame[];
}
export interface MonthlyPlayerRankings {
  month: string;
  currentMonth: string;
  firstMonth: string;
  timezone: string;
  state: "live" | "ended";
  updatedAt: string;
  items: PlayerRanking[];
  hasMore: boolean;
  nextOffset: number;
}
export interface GamePlayer {
  uid: string;
  nickname: string;
  avatarUrl?: string | null;
  status: string;
  playtimeMinutes: number | null;
  recordedPlaytimeMinutes?: number | null;
  performance: PerformanceReport | null;
}
export type PostKind =
  "photo" | "thought" | "question" | "completed" | "review";
export interface CommunityPost extends PublicGame {
  id: string;
  uid: string;
  nickname: string;
  avatarUrl?: string | null;
  kind: PostKind;
  body: string;
  spoiler: boolean;
  edited: boolean;
  createdAt: string;
  images: string[];
  likes: number;
  comments: number;
  liked: boolean;
  saved: boolean;
  reviewScore?: number | null;
  reviewDropped?: boolean;
  playtimeMinutes?: number | null;
}
export interface CommunityComment {
  id: string;
  postId: string;
  uid: string;
  nickname: string;
  avatarUrl?: string | null;
  body: string;
  createdAt: string;
}
export interface CommentHistory {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  gameTitle: string;
  spoiler: boolean;
}
export interface CommunityReview {
  id: string;
  uid: string;
  nickname: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  avatarPreset?: string | null;
  bannerPreset?: string | null;
  vipTier?: number | null;
  gameKey: string;
  score: number;
  review: string;
  spoiler: boolean;
  playtimeMinutes: number;
  dropped: boolean;
  updatedAt: string;
}
export interface GraphicsContext {
  width: number | null;
  height: number | null;
  preset: string;
  upscaling: string;
  frameGeneration: string;
  rayTracing: string;
  source: "manual" | "config";
}
export interface PerformanceReport extends PublicGame {
  id?: string;
  uid?: string;
  nickname?: string;
  completionStatus: "completed";
  cpu: string;
  gpu: string;
  ramGb: number;
  fpsAverage: number;
  fpsLow?: number | null;
  samples: number;
  graphics: GraphicsContext;
  source: "presentmon" | "manual";
  measuredAt: string;
  notes?: string;
}
export interface SteamRequirements extends PublicGame {
  description?: string | null;
  genres?: string[];
  developers?: string[];
  releaseDate?: string | null;
  minimum: string | null;
  recommended: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  available: boolean;
}
export interface GameRanking extends PublicGame {
  bannerUrl?: string | null;
  classification: "online" | "hybrid" | "offline" | "unknown";
  classificationSource?: string;
  classificationConfidence?: number;
  players: number;
  completedPlayers: number;
  totalMinutes: number;
  recordedMinutes?: number;
  averageScore: number | null;
  reviewCount: number;
}
export interface MonthlyGameRanking extends PublicGame {
  bannerUrl?: string | null;
  classification: "online" | "hybrid" | "offline" | "unknown";
  players: number;
  totalMinutes: number;
  averageScore: number | null;
  reviewCount: number;
  rankingScore: number | null;
}
export interface MonthlyRankings {
  month: string;
  currentMonth: string;
  firstMonth: string;
  timezone: string;
  state: "live" | "ended";
  updatedAt: string;
  scoring: { priorScore: number; priorWeight: number };
  online: MonthlyGameRanking[];
  singlePlayer: MonthlyGameRanking[];
  onlineCount: number;
  singlePlayerCount: number;
  unclassifiedCount: number;
}
export interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: number;
}
export interface CommunityNotification {
  id: string;
  postId: string;
  kind: "like" | "comment";
  nickname: string;
  read: boolean;
  createdAt: string;
}
export interface ModerationReport {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  createdAt: string;
  targetBody?: string;
}
export type CommunityRequest = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export interface CommunityAdapter {
  request: CommunityRequest;
  upload: (file: File) => Promise<{
    key: string;
  }>;
  publicBase: string;
  signIn: () => Promise<void>;
}
export interface ConfigCandidate {
  path: string;
  adapter: string;
  name: string;
  size: number;
  graphics: Partial<GraphicsContext>;
}
export interface PerformancePreview {
  game: PublicGame & {
    status: string;
  };
  context: GraphicsContext;
  reports: Array<
    PerformanceReport & {
      sessionId: number;
      snapshotAvailable: boolean;
    }
  >;
  candidates: ConfigCandidate[];
  supported: boolean;
}
