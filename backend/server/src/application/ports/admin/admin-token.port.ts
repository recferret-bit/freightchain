import type { SignedToken } from '../../../domain/auth/auth-challenge.entity.js';
import type { SurfaceTokenClaims } from '../../../domain/auth/surface-token.js';

/** The admin session: its own token (own key, own audience, short life) – a player's session token is never an admin token, and the other way round. */
export abstract class AdminTokenPort {
  abstract sign(wallet: string): Promise<SignedToken>;
  /** The wallet a valid, unexpired ADMIN token belongs to; null otherwise (a player token included). */
  abstract verify(token: string): Promise<string | null>;
  /** Wallet, jti and expiry. The default is "no claims" so a test double that only implements verify stays closed. */
  verifyClaims(_token: string): Promise<SurfaceTokenClaims | null> {
    return Promise.resolve(null);
  }
}
