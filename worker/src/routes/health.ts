import type { RouteHandler } from '../types.ts';
import { jsonResponse } from '../utils.ts';

export const handleHealth: RouteHandler = async () => {
  return jsonResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'game-vault-worker',
  });
};
