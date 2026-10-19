import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminTokenPort } from '../../../application/ports/admin/admin-token.port.js';
import { ForbiddenError, NotFoundError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';
import { adminWallet } from '../session-cookie.js';
import type { RequestWithPlayer } from '../types/http-request.js';

/** Mutating admin calls must carry this header: a cross-site form or a plain link cannot set it, so a stolen click cannot override a verdict (CSRF). */
export const ADMIN_HEADER = 'x-fc-admin';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const ADMIN_PUBLIC = 'freight:admin-public';
/** An admin route reachable WITHOUT an admin session (the admin sign-in itself): host and header checks only; the handler checks the allowlist. */
export const AdminPublic = (): MethodDecorator => SetMetadata(ADMIN_PUBLIC, true);

/** The request's Host header without the port. NOT req.hostname: with TRUST_PROXY Express prefers X-Forwarded-Host, which nginx passes on from the client
 *  untouched – while Host is set by nginx itself (`proxy_set_header Host $host`, and nginx picked the server block by it). */
const hostOf = (request: RequestWithPlayer): string => String(request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();

/**
 * The admin surface (/api/admin/*). Needs, in this order: the admin host (on a split deployment only admin.<apex> – EnvService.adminHost – the nginx site
 * behind basic auth, so api.<apex>/api/admin/* is a 404), an ADMIN session (the fc_admin cookie from the admin sign-in – the player session grants nothing
 * here) whose wallet is STILL in ADMIN_WALLETS (removing a wallet ends its session on the next request), and on changes the X-FC-Admin header.
 * Every refusal but the header's is a 404: nothing to probe. Puts the wallet on the request for @CurrentPlayer().
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly tokens: AdminTokenPort,
    private readonly env: EnvService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    const adminHost = this.env.adminHost;
    if (adminHost && hostOf(request) !== adminHost) throw new NotFoundError('not found');
    const isPublic = this.reflector.getAllAndOverride<boolean>(ADMIN_PUBLIC, [context.getHandler(), context.getClass()]) === true;
    const wallet = isPublic ? null : await adminWallet(request, this.tokens);
    if (!isPublic && (!wallet || !this.env.adminWallets.has(wallet))) throw new NotFoundError('not found');
    if (!SAFE_METHODS.has(request.method) && request.headers[ADMIN_HEADER] !== '1') throw new ForbiddenError(`admin changes need the ${ADMIN_HEADER} header`);
    if (wallet) request.player = { wallet };
    return true;
  }
}
