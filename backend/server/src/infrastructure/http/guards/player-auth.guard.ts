import { RideRepositoryPort } from '../../../application/ports/rides/ride.repository.port.js';
import { apiPath } from '../api-path.js';
import { Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UnauthorizedError } from '../../../domain/shared/errors.js';
import { assertTermsCurrent } from '../../../domain/players/terms.js';
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
    @Optional() private readonly rides?: RideRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    if (!readCookie(request.headers.cookie, this.env.sessionCookie)) throw new UnauthorizedError('not signed in');
    const wallet = await sessionWallet(request, this.tokens, this.env.sessionCookie); // already verified by the rate limiter for this request – not twice
    if (!wallet) throw new UnauthorizedError('session expired');
    const player = this.players ? await this.players.findByWallet(wallet) : null;
    request.player = { wallet, termsVersion: player ? player.termsVersion : null, privacyVersion: player ? player.privacyVersion : null };
    request.termsExempt = await this.exempt(request, wallet);
    if (!request.termsExempt) assertTermsCurrent(request.player.termsVersion, request.player.privacyVersion);
    return true;
  }
  private async exempt(request: RequestWithPlayer, wallet: string): Promise<boolean> {
    const path = apiPath(request.path || request.originalUrl || ''), method = request.method?.toUpperCase() ?? 'GET';
    if (['HEAD', 'OPTIONS'].includes(method)) return true;
    if (method === 'GET') return !(/^\/api\/pools\/[^/]+\/payout$/.test(path) || /\/payment$/.test(path));
    if (path === '/api/profile/terms' || path === '/api/profile/agreements' || path === '/api/auth/logout' || /^\/api\/auth\/pair\//.test(path) || path === '/api/me/privacy') return true;
    // Recording/end and already-sent money reconciliation must survive a legal-version change mid-ride.
    if (/^\/api\/rides\/[^/]+\/(heartbeat|batches|end|confirm|reconcile|appeal)$/.test(path) || /^\/api\/rides\/[^/]+\/minigames\//.test(path)) return true;
    if (/^\/api\/tickets\/orders\/[^/]+\/(confirm|reconcile)$/.test(path) || /\/donation-orders\/[^/]+\/(confirm|reconcile)$/.test(path) || path === '/api/chain/settle') return true;
    if (path === '/api/rides' && (!request.body?.tier || request.body.tier === 'free')) return true;
    const start = path.match(/^\/api\/rides\/([^/]+)\/start$/);
    if (start && this.rides) {
      const ride = await this.rides.findById(start[1]!);
      if (ride?.wallet === wallet && ride.isFree && !ride.isPromo) return true;
    }
    return false;
  }

}
