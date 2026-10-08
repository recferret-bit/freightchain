import type { SignedToken } from '../../../domain/auth/auth-challenge.entity.js';

/** The admin session: its own token (own key, own audience, short life) – a player's session token is never an admin token, and the other way round. */
export abstract class AdminTokenPort {
  abstract sign(wallet: string): Promise<SignedToken>;
  /** The wallet a valid, unexpired ADMIN token belongs to; null otherwise (a player token included). */
  abstract verify(token: string): Promise<string | null>;
}
