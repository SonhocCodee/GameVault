// Standalone definitions for Cloudflare D1 & R2 ensuring hermetic builds & test compatibility

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1Result<T = any> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: any;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  all<T = any>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2Object {
  key: string;
  version?: string;
  size: number;
  etag: string;
  httpEtag: string;
  customMetadata?: Record<string, string>;
  httpMetadata?: R2HTTPMetadata;
  uploaded?: Date;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = any>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions
  ): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  head(key: string): Promise<R2Object | null>;
  list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ objects: R2Object[]; truncated: boolean }>;
}

export interface Env {
  DB: D1Database;
  IMAGES_BUCKET?: R2Bucket;
  ASSETS?: { fetch: (request: Request | string) => Promise<Response> };
  GOOGLE_CLIENT_ID?: string;
  WEB_GOOGLE_CLIENT_ID?: string;
  SESSION_SECRET: string;
  ENVIRONMENT?: string;
  ALLOW_MOCK_AUTH?: string;
  GOOGLE_TOKENINFO_URL?: string;
  ADMIN_EMAILS?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
}

export interface AuthUser {
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string;
  gpu?: string;
  cpu?: string;
  ramGb?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface HardwareProfile {
  gpu: string;
  cpu: string;
  ramGb: number;
}

export interface CloudReview {
  id?: string;
  uid: string;
  gameKey: string;
  gameTitle: string;
  coverUrl?: string | null;
  score: number;
  review: string;
  dropped: boolean;
  dropReason?: string | null;
  playtimeMinutes: number;
  fps?: number | null;
  updatedAt: string;
  authorName?: string;
  authorPhoto?: string;
  authorHw?: HardwareProfile | null;
}

export interface LeaderboardEntry {
  gameKey: string;
  gameTitle: string;
  coverUrl?: string | null;
  avgScore: number;
  reviewCount: number;
  dropRate: number;
  totalPlaytimeMinutes: number;
  guMatchScore?: number | null;
  myScore?: number | null;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface CommunityPick {
  month: string;
  gameKey: string;
  gameTitle: string;
  coverUrl?: string | null;
  votes: Record<string, string>;
  state: 'voting' | 'playing' | 'done';
}

export type GameLibraryStatus = 'playing' | 'completed' | 'paused' | 'dropped' | 'backlog';

export interface UserLibraryItem {
  gameKey: string;
  title: string;
  steamId?: number | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  status: GameLibraryStatus;
  playtimeMinutes: number;
  lastPlayed?: string | null;
  completedAt?: string | null;
  userScore?: number | null;
  userNotes?: string | null;
  isDeleted?: boolean;
  clientUpdatedAt?: string;
  serverUpdatedAt?: string;
  masterCoverUpdatedAt?: string | null;
}

export interface LibrarySyncStats {
  total: number;
  completed: number;
  playing: number;
  backlog: number;
  paused: number;
  dropped: number;
  totalPlaytimeMinutes: number;
}

export interface LibrarySyncResponse {
  games: UserLibraryItem[];
  syncedAt: string;
  stats: LibrarySyncStats;
}

export interface GameCoverRecord {
  gameKey: string;
  title: string;
  steamId?: number | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CoverCachePayload {
  gameKey: string;
  title: string;
  steamId?: number | null;
  sourcePosterUrl?: string | null;
  sourceBannerUrl?: string | null;
}

export interface CoverCacheResponse {
  gameKey: string;
  title: string;
  steamId?: number | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  fromCache: boolean;
}

export interface RouteContext {
  params: Record<string, string>;
  url: URL;
  user?: AuthUser | null;
  executionCtx?: any;
}

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: RouteContext
) => Promise<Response> | Response;
