import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { TokenSignerPort } from '../../application/ports/auth/token-signer.port.js';
import { EnvService } from '../config/env.service.js';
import { sessionWallet } from './session-cookie.js';

export const THROTTLE_WINDOW_MS = 60_000;

const pathOf = (context: ExecutionContext): string => context.switchToHttp().getRequest<Request>().path;
const isAuthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/auth/');
const isHealthRoute = (context: ExecutionContext): boolean => pathOf(context).startsWith('/api/health/');

/**
 * Two per-minute budgets, both from the environment (like every @nestjs/throttler budget, counted per ROUTE and per tracker):
 *  - 'default' (THROTTLE_LIMIT) on every route but health: per signed-in WALLET when the session cookie verifies, otherwise per IP – so riders behind one
 *    NAT or proxy don't share a bucket, and a forged cookie gains nothing (it falls back to the IP).
 *  - 'auth' (THROTTLE_AUTH_LIMIT) on /api/auth/* only, per IP (nobody is signed in yet).
 * Per IP needs `TRUST_PROXY` set right behind a reverse proxy (production requires it to be set explicitly).
 */
export function throttlerOptions(env: EnvService, tokens: TokenSignerPort): ThrottlerModuleOptions {
  const byWalletOrIp = async (req: Record<string, unknown>): Promise<string> => {
    const request = req as unknown as Request;
    const wallet = await sessionWallet(request, tokens); // cached on the request: PlayerAuthGuard reuses it
    return wallet ? `wallet:${wallet}` : `ip:${request.ip ?? 'unknown'}`;
  };
  return [
    { name: 'default', ttl: THROTTLE_WINDOW_MS, limit: env.throttleLimit, getTracker: byWalletOrIp, skipIf: isHealthRoute },
    { name: 'auth', ttl: THROTTLE_WINDOW_MS, limit: env.throttleAuthLimit, skipIf: (context) => !isAuthRoute(context) },
  ];
}
