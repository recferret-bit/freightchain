import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { decodeJwt } from 'jose';
import type { Request } from 'express';
import { TokenSignerPort } from '../../application/ports/auth/token-signer.port.js';
import type { EditorTokenPort } from '../../application/ports/editor/editor-token.port.js';
import { EnvService } from '../config/env.service.js';
import { editorWallet, sessionWallet } from './session-cookie.js';
import { apiPath } from './api-path.js';

export const THROTTLE_WINDOW_MS = 60_000;

const pathOf = (context: ExecutionContext): string => apiPath(context.switchToHttp().getRequest<Request>().path);   // as Express routes it (M9)
const isAuthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/auth/');
const isPromoRedeem = (context: ExecutionContext): boolean => pathOf(context) === '/api/promo/redeem';
const isHealthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/health/');
const isEntitiesRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/entities/');
const isMcpRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/editor/mcp/');
const isEditorRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/editor/') && !isMcpRoute(context);
/** the MCP's callbacks per job: a model turn may read and check a few times; this only stops a runaway loop */
export const THROTTLE_MCP_LIMIT = 600;
const isEditorAuthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/editor/auth/');

/**
 * Three per-minute budgets, both from the environment (like every @nestjs/throttler budget, counted per ROUTE and per tracker):
 *  - 'default' (THROTTLE_LIMIT) on every route but health: per signed-in WALLET when the session cookie verifies, otherwise per IP – so riders behind one
 *    NAT or proxy don't share a bucket, and a forged cookie gains nothing (it falls back to the IP).
 *  - 'auth' (THROTTLE_AUTH_LIMIT) on /api/auth/* only, per IP (nobody is signed in yet).
 *  - 'promo' (THROTTLE_PROMO_LIMIT) on POST /api/promo/redeem only, per IP: wallets are free to make, so a per-wallet budget alone would let one machine guess codes with a fresh wallet each.
 *  - 'entities' (THROTTLE_ENTITIES_LIMIT) on /api/entities/* only (the 3D model bundle every page loads once), per IP; 'default' skips it (nginx also limits + caches it).
 *  - 'editor' (THROTTLE_EDITOR_LIMIT) on /api/editor/* only, per editor wallet (the fc_editor cookie) else per IP; 'default' skips it. Its sign-in also counts in 'auth'.
 *  - 'mcp' (THROTTLE_MCP_LIMIT) on /api/editor/mcp/* only (the MCP's callbacks, from the internal network), per JOB (the id in its token); the others skip it.
 * Per IP needs `TRUST_PROXY` set right behind a reverse proxy (production requires it to be set explicitly).
 */
export function throttlerOptions(env: EnvService, tokens: TokenSignerPort, editorTokens?: EditorTokenPort): ThrottlerModuleOptions {
  const byWalletOrIp = async (req: Record<string, unknown>): Promise<string> => {
    const request = req as unknown as Request;
    const wallet = await sessionWallet(request, tokens, env.sessionCookie); // cached on the request: PlayerAuthGuard reuses it
    return wallet ? `wallet:${wallet}` : `ip:${request.ip ?? 'unknown'}`;
  };
  const byEditorOrIp = async (req: Record<string, unknown>): Promise<string> => {
    const request = req as unknown as Request;
    const wallet = editorTokens ? await editorWallet(request, editorTokens) : null;
    return wallet ? `editor:${wallet}` : `ip:${request.ip ?? 'unknown'}`;
  };
  const byJob = (req: Record<string, unknown>): Promise<string> => {
    const request = req as unknown as Request, raw = request.headers['x-fc-job'];
    // through nginx (the internet): the client's IP – an unverified token must not pick a fresh bucket per request (McpJobGuard 404s these anyway)
    if (request.headers['x-forwarded-for'] !== undefined || request.headers['x-real-ip'] !== undefined) return Promise.resolve(`ip:${request.ip ?? 'unknown'}`);
    let job = 'none';
    try { if (typeof raw === 'string' && raw) job = String(decodeJwt(raw).sub ?? 'none'); } catch { /* junk: one shared bucket – McpJobGuard 404s it anyway */ }
    return Promise.resolve(`job:${job}`);
  };
  return [
    { name: 'default', ttl: THROTTLE_WINDOW_MS, limit: env.throttleLimit, getTracker: byWalletOrIp, skipIf: (context) => isHealthRoute(context) || isEntitiesRoute(context) || isEditorRoute(context) || isMcpRoute(context) },
    { name: 'auth', ttl: THROTTLE_WINDOW_MS, limit: env.throttleAuthLimit, skipIf: (context) => !isAuthRoute(context) && !isEditorAuthRoute(context) },
    { name: 'entities', ttl: THROTTLE_WINDOW_MS, limit: env.throttleEntitiesLimit, skipIf: (context) => !isEntitiesRoute(context) },
    { name: 'editor', ttl: THROTTLE_WINDOW_MS, limit: env.throttleEditorLimit, getTracker: byEditorOrIp, skipIf: (context) => !isEditorRoute(context) },
    { name: 'mcp', ttl: THROTTLE_WINDOW_MS, limit: THROTTLE_MCP_LIMIT, getTracker: byJob, skipIf: (context) => !isMcpRoute(context) },
    { name: 'promo', ttl: THROTTLE_WINDOW_MS, limit: env.throttlePromoLimit, skipIf: (context) => !isPromoRedeem(context) },
  ];
}
