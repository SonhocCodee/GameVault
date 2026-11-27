import { Router } from './router.ts';
import { corsHeaders, errorResponse } from './utils.ts';
import type { Env, RouteContext } from './types.ts';
import { registerCommunityRoutes } from './routes/community.ts';
import { registerDiscoveryRoutes } from './routes/discovery.ts';

// Routes
import { handleHealth } from './routes/health.ts';
import { handleGoogleAuth } from './auth.ts';
import { handleLeaderboard } from './routes/leaderboard.ts';
import { handleGetReviews, handleSubmitReview, handleDeleteReview } from './routes/reviews.ts';
import { handleGetUser, handleUpdateHardware } from './routes/users.ts';
import { handleGetCurrentPick, handleVotePick, handleUnvotePick } from './routes/picks.ts';
import { handleImageUpload, handleImageGet } from './routes/images.ts';
import { handleGetLibrary, handleSyncLibrary } from './routes/library.ts';
import { handleSubmitClientLog, handleAdminGetClientLogs } from './routes/logs.ts';
import {
  handleGetCover,
  handleCacheCover,
  handleUploadCover,
  handleAdminConfig,
  handleAdminMe,
  handleAdminGetCovers,
  handleAdminUpdateCover,
  handleAdminUploadCover,
  handleAdminDiscoverGames,
  handleAdminIgdbSearch,
  handleAdminHealthCheck,
  handleAdminBatchIngest,
  handleAdminSyncAll,
  handleAdminDeleteCover,
} from './routes/covers.ts';

export const router = new Router();
registerCommunityRoutes(router);
registerDiscoveryRoutes(router);

// Health checks
router.get('/health', handleHealth);
router.get('/api/health', handleHealth);

// Auth
router.post('/api/auth/google', handleGoogleAuth);

// Leaderboard
router.get('/api/leaderboard', handleLeaderboard);

// Game reviews CRUD
router.get('/api/games/:gameKey/reviews', handleGetReviews);
router.post('/api/games/:gameKey/reviews', handleSubmitReview);
router.delete('/api/games/:gameKey/reviews', handleDeleteReview);

// Users & Hardware
router.get('/api/users/:uid', handleGetUser);
router.put('/api/users/me/hardware', handleUpdateHardware);

// Community picks & voting
router.get('/api/picks/current', handleGetCurrentPick);
router.post('/api/picks/vote', handleVotePick);
router.delete('/api/picks/vote', handleUnvotePick);

// Multi-device game library sync
router.get('/api/library', handleGetLibrary);
router.post('/api/library/sync', handleSyncLibrary);

// Client diagnostic logs
router.post('/api/logs', handleSubmitClientLog);
router.get('/api/admin/logs', handleAdminGetClientLogs);

// Images (R2 / D1)
router.post('/api/images/upload', handleImageUpload);
router.get('/api/images/:key', handleImageGet);

// Central Game Covers Catalog (Single Source of Truth)
router.get('/api/covers/:gameKey', handleGetCover);
router.post('/api/covers/cache', handleCacheCover);
router.post('/api/covers/upload', handleUploadCover);

// Admin Portal & Game Covers Management
router.get('/api/admin/config', handleAdminConfig);
router.get('/api/admin/me', handleAdminMe);
router.get('/api/admin/covers', handleAdminGetCovers);
router.post('/api/admin/covers/discover', handleAdminDiscoverGames);
router.post('/api/admin/covers/igdb-search', handleAdminIgdbSearch);
router.post('/api/admin/covers/health-check', handleAdminHealthCheck);
router.post('/api/admin/covers/batch-ingest', handleAdminBatchIngest);
router.post('/api/admin/covers/sync-all', handleAdminSyncAll);
router.post('/api/admin/covers/:gameKey/upload', handleAdminUploadCover);
router.put('/api/admin/covers/:gameKey', handleAdminUpdateCover);
router.delete('/api/admin/covers/:gameKey', handleAdminDeleteCover);

async function serveAdminAsset(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!env.ASSETS || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return null;
  }

  if (url.pathname === '/community') return Response.redirect(`${url.origin}/community/${url.search}`, 302);
  if (url.pathname.startsWith('/community/')) {
    const subPath = url.pathname.slice('/community/'.length);
    const assetPath = /\.[a-zA-Z0-9]+$/.test(subPath) ? `/community/${subPath}` : '/community/index.html';
    return env.ASSETS.fetch(new Request(new URL(assetPath + url.search, url.origin), { method: request.method, headers: request.headers }));
  }

  // Redirect /admin -> /admin/ so relative or base paths stay consistent
  if (url.pathname === '/admin') {
    return Response.redirect(`${url.origin}/admin/${url.search}`, 302);
  }

  if (url.pathname.startsWith('/admin/')) {
    const subPath = url.pathname.slice('/admin'.length) || '/';
    const hasFileExt = /\.[a-zA-Z0-9]+$/.test(subPath);
    const assetPath = hasFileExt ? subPath : '/index.html';
    const assetUrl = new URL(assetPath + url.search, url.origin);
    const assetRes = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
      method: request.method,
      headers: request.headers,
    }));
    if (assetRes.status !== 404 || !hasFileExt) {
      return assetRes;
    }
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env, executionCtx?: any): Promise<Response> {
    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);

      // Serve standalone Admin Web Dashboard under /admin
      const adminAssetResponse = await serveAdminAsset(request, env, url);
      if (adminAssetResponse) {
        return adminAssetResponse;
      }

      const match = router.match(request.method, url.pathname);

      if (!match) {
        return errorResponse(`Route not found: ${request.method} ${url.pathname}`, 404);
      }

      const ctx: RouteContext = {
        params: match.params,
        url,
        executionCtx,
      };

      const response = await match.handler(request, env, ctx);

      // Ensure CORS headers are attached to every response
      const finalHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        if (!finalHeaders.has(key)) {
          finalHeaders.set(key, value);
        }
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: finalHeaders,
      });
    } catch (err: any) {
      console.error('[Worker Error]', err);
      return errorResponse('Internal Server Error', 500);
    }
  },
};
