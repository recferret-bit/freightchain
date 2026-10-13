import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { NotFoundError, UnauthorizedError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

/**
 * POST /api/chain/webhook (docs/agents/escrow.md): WEBHOOK_SECRET unset → 404 (the route does not exist); otherwise the secret must come in the
 * `x-webhook-secret` header (a QuickNode Streams custom header) or as the `Authorization` header, bare or `Bearer <secret>` (Helius' auth header) – else 401.
 * Compared in constant time (sha256 digests, so the length does not leak either). The body is never trusted anyway: only signatures are taken from it.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  constructor(private readonly env: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.env.webhookSecret;
    if (!secret) throw new NotFoundError('Cannot POST /api/chain/webhook');
    const { headers } = context.switchToHttp().getRequest<Request>();
    const given = header(headers[WEBHOOK_SECRET_HEADER]) ?? header(headers['authorization'])?.replace(/^Bearer\s+/i, '');
    if (given === undefined || !sameSecret(given, secret)) throw new UnauthorizedError('bad webhook secret');
    return true;
  }
}

const header = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));
