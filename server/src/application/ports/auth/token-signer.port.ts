import type { SignedToken } from '../../../domain/auth/auth-challenge.entity.js';

export abstract class TokenSignerPort {
  abstract sign(wallet: string): Promise<SignedToken>;
  /** The wallet a valid, unexpired session token belongs to; null otherwise. */
  abstract verify(token: string): Promise<string | null>;
}
