import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../../domain/shared/errors.js';
import { TokenSignerPort } from '../../../application/ports/auth/token-signer.port.js';
import { SESSION_COOKIE, readCookie, sessionWallet } from '../session-cookie.js';
import type { RequestWithPlayer } from '../types/http-request.js';

/** Requires the session cookie; puts the wallet on the request for @CurrentPlayer(). */
@Injectable()
export class PlayerAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenSignerPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    if (!readCookie(request.headers.cookie, SESSION_COOKIE)) throw new UnauthorizedError('not signed in');
    const wallet = await sessionWallet(request, this.tokens); // already verified by the rate limiter for this request – not twice
    if (!wallet) throw new UnauthorizedError('session expired');
    request.player = { wallet };
    return true;
  }
}
