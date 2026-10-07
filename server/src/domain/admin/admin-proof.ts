import { AuthChallenge } from '../auth/auth-challenge.entity.js';

/* What an admin's wallet signs. Pending challenges share the rider sign-in's store (one per key), under their own keys so an admin sign-in never
   replaces a rider sign-in of the same wallet, and a message of one kind can never be consumed as the other. */
export const adminSignInKey = (wallet: string): string => `admin:${wallet}`;

export const ADMIN_SIGNIN_STATEMENT = 'ADMIN sign-in to Freight Chain (the admin page). This request will not trigger a transaction or cost any fees.';

export interface AdminSignInInput {
  wallet: string;
  /** the admin page's host / origin (admin.<apex>): wallets compare the message's domain with the page that asks */
  domain: string;
  origin: string;
  nonce: string;
  now: Date;
  ttlMs: number;
}

/** The admin sign-in message (Sign-In-With-Solana format, the admin host as its domain), stored under the admin key. */
export function adminSignInChallenge(input: AdminSignInInput): AuthChallenge {
  const c = AuthChallenge.issue({ ...input, statement: ADMIN_SIGNIN_STATEMENT });
  return new AuthChallenge(adminSignInKey(input.wallet), c.message, c.expiresAt);
}
