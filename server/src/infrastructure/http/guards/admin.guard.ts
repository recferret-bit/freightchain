import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { TokenSignerPort } from '../../../application/ports/auth/token-signer.port.js';
import { ForbiddenError, NotFoundError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';
import { sessionWallet } from '../session-cookie.js';
import type { RequestWithPlayer } from '../types/http-request.js';

/** Mutating admin calls must carry this header: a cross-site form or a plain link cannot set it, so a stolen click cannot override a verdict (CSRF). */
export const ADMIN_HEADER = 'x-fc-admin';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The request's Host header without the port. NOT req.hostname: with TRUST_PROXY Express prefers X-Forwarded-Host, which nginx passes on from the client
 *  untouched – while Host is set by nginx itself (`proxy_set_header Host $host`, and nginx picked the server block by it). */
const hostOf = (request: RequestWithPlayer): string => String(request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();

/**
 * The admin surface (/api/admin/*): the session wallet must be in ADMIN_WALLETS. To everybody else – signed out, signed in, or with ADMIN_WALLETS empty –
 * it does not exist (404, not 401/403: nothing to probe). On a split deployment it answers only on admin.<apex> (EnvService.adminHost), the nginx site
 * behind basic auth – so api.<apex>/api/admin/* is a 404 even for an admin wallet. Puts the wallet on the request for @CurrentPlayer().
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenSignerPort,
    private readonly env: EnvService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    const adminHost = this.env.adminHost;
    if (adminHost && hostOf(request) !== adminHost) throw new NotFoundError('not found');
    const wallet = await sessionWallet(request, this.tokens);
    if (!wallet || !this.env.adminWallets.has(wallet)) throw new NotFoundError('not found');
    if (!SAFE_METHODS.has(request.method) && request.headers[ADMIN_HEADER] !== '1') throw new ForbiddenError(`admin changes need the ${ADMIN_HEADER} header`);
    request.player = { wallet };
    return true;
  }
}
