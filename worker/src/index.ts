import { Router } from './router.ts';
import { corsHeaders, errorResponse } from './utils.ts';
import type { Env, RouteContext } from './types.ts';

// Routes
import { handleHealth } from './routes/health.ts';
import { handleGoogleAuth } from './auth.ts';
import { handleLeaderboard } from './routes/leaderboard.ts';
import { handleGetReviews, handleSubmitReview, handleDeleteReview } from './routes/reviews.ts';
import { handleGetUser, handleUpdateHardware } from './routes/users.ts';
import { handleGetCurrentPick, handleVotePick, handleUnvotePick } from './routes/picks.ts';
import { handleImageUpload, handleImageGet } from './routes/images.ts';
import { handleGetLibrary, handleSyncLibrary } from './routes/library.ts';

export const router = new Router();

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

// Images (R2)
router.post('/api/images/upload', handleImageUpload);
router.get('/api/images/:key', handleImageGet);

export default {
  async fetch(request: Request, env: Env, executionCtx?: any): Promise<Response> {
    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
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
      return errorResponse(err.message || 'Internal Server Error', 500);
    }
  },
};
