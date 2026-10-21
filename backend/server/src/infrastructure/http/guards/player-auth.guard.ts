import { Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../../domain/shared/errors.js';
import { enforceRequestTerms } from '../../../domain/players/terms.js';
import { PlayerRepositoryPort } from '../../../application/ports/players/player.repository.port.js';
import { TokenSignerPort } from '../../../application/ports/auth/token-signer.port.js';
import { readCookie, sessionWallet } from '../session-cookie.js';
import { EnvService } from '../../config/env.service.js';
import type { RequestWithPlayer } from '../types/http-request.js';

/** Requires the session cookie; puts the wallet and the stored terms versions on the request for @CurrentPlayer(). Writes call the same terms check as TermsGuard. */
@Injectable()
export class PlayerAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenSignerPort,
    private readonly env: EnvService,
    @Optional() private readonly players?: PlayerRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    if (!readCookie(request.headers.cookie, this.env.sessionCookie)) throw new UnauthorizedError('not signed in');
    const wallet = await sessionWallet(request, this.tokens, this.env.sessionCookie); // already verified by the rate limiter for this request – not twice
    if (!wallet) throw new UnauthorizedError('session expired');
    const player = this.players ? await this.players.findByWallet(wallet) : null;
    request.player = { wallet, termsVersion: player ? player.termsVersion : null, privacyVersion: player ? player.privacyVersion : null };
    enforceRequestTerms(request.method, request.player);
    return true;
  }
}
