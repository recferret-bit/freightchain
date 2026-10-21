/** No browser fingerprint. Login, a verified ride, a rejected ride, and a social bind are the only inputs. */
export const TRUST_INITIAL = 60;
export const TRUST_PAYOUT_MIN = 50;
export const GRANT_HOLD_MS = 48 * 60 * 60 * 1000;

export type TrustEvent = 'login' | 'verified' | 'rejected' | 'social';

const DELTA: Record<TrustEvent, number> = { login: 1, verified: 5, rejected: -15, social: 5 };

export function applyTrust(score: number, event: TrustEvent): number {
  return Math.max(0, Math.min(100, score + DELTA[event]));
}

export interface HoldParties {
  now: Date;
  heldAt: Date;
  trustA: number;
  trustB: number;
  rejectedA: number;
  rejectedB: number;
}

/** Convoy M1/M2 and airdrop TEN4 ledger credits. Both wallets must still clear the bar. */
export function grantReleasable(parties: HoldParties): boolean {
  if (parties.now.getTime() - parties.heldAt.getTime() < GRANT_HOLD_MS) return false;
  if (parties.trustA < TRUST_PAYOUT_MIN || parties.trustB < TRUST_PAYOUT_MIN) return false;
  return parties.rejectedA === 0 && parties.rejectedB === 0;
}
