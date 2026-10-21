import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { TokenSignerPort } from '../../application/ports/auth/token-signer.port.js';
import type { EditorTokenPort } from '../../application/ports/editor/editor-token.port.js';
import type { JobTokenPort } from '../../application/ports/editor/job-token.port.js';
import { EnvService } from '../config/env.service.js';
import { EDITOR_COOKIE, editorWallet, sessionWallet } from './session-cookie.js';
import { apiPath } from './api-path.js';

export const THROTTLE_WINDOW_MS = 60_000;
export const THROTTLE_RPS_WINDOW_MS = 1_000;

const pathOf = (context: ExecutionContext): string => apiPath(context.switchToHttp().getRequest<Request>().path);
const isAuthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/auth/');
const isPromoRedeem = (context: ExecutionContext): boolean => pathOf(context) === '/api/promo/redeem';
const isHealthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/health/');
const isEntitiesRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/entities/');
const isMcpRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/editor/mcp/');
const isEditorRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/editor/') && !isMcpRoute(context);
const isEditorAuthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/editor/auth/');
const isAdminAuthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/admin/auth/');

/**
 * Per-minute budgets (counted per route and per tracker) plus a per-second cap on the routes a stranger can hammer:
 *  - 'default' (THROTTLE_LIMIT) on every route but health, entities, editor and the MCP callbacks: per signed-in wallet, else per IP.
 *  - 'auth' (THROTTLE_AUTH_LIMIT) and 'auth-rps' (THROTTLE_AUTH_RPS) on /api/auth/* and /api/editor/auth/*, per IP.
 *  - 'promo' (THROTTLE_PROMO_LIMIT) on POST /api/promo/redeem, per IP.
 *  - 'entities' (THROTTLE_ENTITIES_LIMIT, per minute) and 'entities-rps' (THROTTLE_ENTITIES_RPS) on /api/entities/*, per IP.
 *  - 'editor' (THROTTLE_EDITOR_LIMIT, per editor wallet else per IP, per minute) and 'editor-rps' (THROTTLE_EDITOR_RPS, per IP) on /api/editor/*.
 *  - 'mcp' and 'mcp-rps' on /api/editor/mcp/* per verified JOB. An unverified token shares one bucket – the id inside it is not trusted.
 *    A request that came through nginx (X-Forwarded-For / X-Real-IP) is counted per IP; McpJobGuard 404s it.
 * When `storage` is set (REDIS_URL), every bucket is that Redis. Otherwise Nest keeps the counters in this process.
 * Per IP needs TRUST_PROXY set to the number of reverse-proxy hops.
 */
export function throttlerOptions(env: EnvService, tokens: TokenSignerPort, editorTokens?: EditorTokenPort, jobs?: JobTokenPort, storage?: ThrottlerStorage | null): ThrottlerModuleOptions {
  const byWalletOrIp = async (req: Record<string, unknown>): Promise<string> => {
    const request = req as unknown as Request;
    const wallet = await sessionWallet(request, tokens, env.sessionCookie);
    return wallet ? `wallet:${wallet}` : `ip:${request.ip ?? 'unknown'}`;
  };
  const byEditorOrIp = async (req: Record<string, unknown>): Promise<string> => {
    const request = req as unknown as Request;
    const wallet = editorTokens ? await editorWallet(request, editorTokens, env.editorCookie || EDITOR_COOKIE) : null;
    return wallet ? `editor:${wallet}` : `ip:${request.ip ?? 'unknown'}`;
  };
  const byIp = (req: Record<string, unknown>): string => `ip:${(req as unknown as Request).ip ?? 'unknown'}`;
  const byJob = async (req: Record<string, unknown>): Promise<string> => {
    const request = req as unknown as Request;
    if (request.headers['x-forwarded-for'] !== undefined || request.headers['x-real-ip'] !== undefined) return `ip:${request.ip ?? 'unknown'}`;
    const raw = request.headers['x-fc-job'];
    if (typeof raw !== 'string' || !raw || !jobs) return 'job:unverified';
    try {
      const claims = await jobs.verify(raw);
      return claims ? `job:${claims.jobId}` : 'job:unverified';
    } catch { return 'job:unverified'; }
  };
  const throttlers = [
    { name: 'default', ttl: THROTTLE_WINDOW_MS, limit: env.throttleLimit, getTracker: byWalletOrIp, skipIf: (context: ExecutionContext) => isHealthRoute(context) || isEntitiesRoute(context) || isEditorRoute(context) || isMcpRoute(context) },
    { name: 'auth', ttl: THROTTLE_WINDOW_MS, limit: env.throttleAuthLimit, getTracker: byIp, skipIf: (context: ExecutionContext) => !isAuthRoute(context) && !isEditorAuthRoute(context) },
    { name: 'admin-auth', ttl: THROTTLE_WINDOW_MS, limit: env.throttleAdminAuthLimit, getTracker: byIp, skipIf: (context: ExecutionContext) => !isAdminAuthRoute(context) },
    { name: 'auth-rps', ttl: THROTTLE_RPS_WINDOW_MS, limit: env.throttleAuthRps ?? 5, getTracker: byIp, skipIf: (context: ExecutionContext) => !isAuthRoute(context) && !isEditorAuthRoute(context) },
    { name: 'entities', ttl: THROTTLE_WINDOW_MS, limit: env.throttleEntitiesLimit, getTracker: byIp, skipIf: (context: ExecutionContext) => !isEntitiesRoute(context) },
    { name: 'entities-rps', ttl: THROTTLE_RPS_WINDOW_MS, limit: env.throttleEntitiesRps ?? 5, getTracker: byIp, skipIf: (context: ExecutionContext) => !isEntitiesRoute(context) },
    { name: 'editor', ttl: THROTTLE_WINDOW_MS, limit: env.throttleEditorLimit, getTracker: byEditorOrIp, skipIf: (context: ExecutionContext) => !isEditorRoute(context) },
    { name: 'editor-rps', ttl: THROTTLE_RPS_WINDOW_MS, limit: env.throttleEditorRps ?? 10, getTracker: byIp, skipIf: (context: ExecutionContext) => !isEditorRoute(context) },
    { name: 'mcp', ttl: THROTTLE_WINDOW_MS, limit: env.throttleMcpLimit ?? 600, getTracker: byJob, skipIf: (context: ExecutionContext) => !isMcpRoute(context) },
    { name: 'mcp-rps', ttl: THROTTLE_RPS_WINDOW_MS, limit: env.throttleMcpRps ?? 20, getTracker: byJob, skipIf: (context: ExecutionContext) => !isMcpRoute(context) },
    { name: 'promo', ttl: THROTTLE_WINDOW_MS, limit: env.throttlePromoLimit, getTracker: byIp, skipIf: (context: ExecutionContext) => !isPromoRedeem(context) },
  ];
  // Nest's default key includes the controller method: rotating endpoints would multiply each surface's budget.
  for (const t of throttlers) if (!['default', 'promo'].includes(t.name)) Object.assign(t, { generateKey: (_context: ExecutionContext, tracker: string, name: string) => createHash('sha256').update(`${name}:${tracker}`).digest('hex') });
  return storage ? { throttlers, storage } : throttlers;
}
