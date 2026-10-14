import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';
import type { RequestWithPlayer } from '../types/http-request.js';

const CROSS_ORIGIN_PUBLIC = 'freight:cross-origin-public';
/** A controller any site may POST to without a session (Solana Actions, Solana Pay, the chain webhook): the Origin check is skipped there. */
export const CrossOriginPublic = (): ClassDecorator & MethodDecorator => SetMetadata(CROSS_ORIGIN_PUBLIC, true);

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** the Host header without the port – set by nginx itself, never the client's X-Forwarded-Host (admin.guard.ts) */
const hostOf = (request: RequestWithPlayer): string => String(request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();

/**
 * Pentest H7 (login CSRF, a sibling host changing state with the shared session cookie): every state-changing request a BROWSER sends carries Origin, and
 * a sibling subdomain is the SAME site, so SameSite does not stop it and a form or text/plain POST is a CORS "simple" request the allowlist never sees.
 * So for POST / PUT / PATCH / DELETE: no Origin (a server, the CLI, a wallet app) passes; `Origin: null` (a sandboxed frame, a redirect chain – forceable)
 * never does; the request's own origin passes (the admin page, the apex's /api proxy, dev on localhost); otherwise only CORS_ORIGINS – and on the admin
 * host nothing but the admin host itself. Controllers marked @CrossOriginPublic() (blinks, Solana Pay, the webhook) are open to any origin by design.
 * (GET stays open: the only GETs with an effect are the presence "leave" keepalives, by design.)
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(private readonly reflector: Reflector, private readonly env: EnvService) {
    this.allowed = new Set(env.corsOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    if (!UNSAFE.has(request.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(CROSS_ORIGIN_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    let from: string;
    try { from = new URL(origin).host.toLowerCase(); } catch { throw new ForbiddenError('a request from this page is not accepted here', 'bad_origin'); }   // 'null' and junk
    const host = hostOf(request), sameOrigin = from === String(request.headers.host ?? '').toLowerCase();   // host AND port: another localhost port is another origin
    const adminHost = this.env.adminHost;
    if (adminHost && host === adminHost) { if (sameOrigin) return true; }
    else if (sameOrigin || this.allowed.has(origin.replace(/\/$/, ''))) return true;
    throw new ForbiddenError('a request from this page is not accepted here', 'bad_origin');
  }
}
