import type { NextFunction, Request, Response } from 'express';
import { ACTION_VERSION, DEVNET_BLOCKCHAIN_ID } from '../../../domain/actions/action-card.js';
import { apiPath } from '../api-path.js';

/** Discovery files and the action API. Query strings are ignored. */
const ACTION_PATH = /^\/(?:actions\.json|\.well-known\/actions\.json|api\/actions(?:\/|$))/;

export function isActionRequest(req: { originalUrl?: string; url?: string }): boolean {
  return ACTION_PATH.test(apiPath(req.originalUrl ?? req.url ?? ''));
}

/** Blink clients are arbitrary origins. No credentials, so `*` is legal. OPTIONS ends here, before the allowlist CORS.
    Allow-Headers is `ACTIONS_CORS_HEADERS` of @solana/actions: a client that sends X-Accept-* fails the preflight without them.
    `/.well-known/actions.json` is rewritten onto `/actions.json`: a leading-dot path does not register as a Nest route. */
export function actionHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.originalUrl ?? req.url ?? '';
  const path = raw.split('?')[0] ?? '';
  if (path === '/.well-known/actions.json') {
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    req.url = `/actions.json${query}`;
    req.originalUrl = req.url;
  }
  if (!isActionRequest(req)) { next(); return; }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids');
  res.setHeader('Access-Control-Expose-Headers', 'X-Action-Version, X-Blockchain-Ids, X-Request-Id');
  res.setHeader('X-Action-Version', ACTION_VERSION);
  res.setHeader('X-Blockchain-Ids', DEVNET_BLOCKCHAIN_ID);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
}
