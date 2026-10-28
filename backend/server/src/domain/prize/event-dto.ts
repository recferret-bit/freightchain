import type { EventBoardRow } from './event-settlement.js';
import { EVENT_MIN_TRUST, EVENT_SANCTIONS_MAX_AGE_MS } from './event-settlement.js';
import type { EventPhase } from '../settings/preseason-event.js';

export type EventGeoAccess = 'eligible' | 'play_only_no_prizes' | 'no_prizes';

/** One row of the admin review list (§14): everything the checklist needs next to the place it would get. */
export interface EventCandidateDto extends EventBoardRow {
  country: string | null;
  region: string | null;
  geoAccess: EventGeoAccess;
  trustScore: number;
  /** the payout (never the place) is blocked below `EVENT_MIN_TRUST` */
  trustBlocked: boolean;
  attempts: number;
  endedAt: number;
  /** 8-char prefixes of the wallet's sign-in subnet HMACs (never an address) */
  ipPrefixHmac: string[];
  /** other listed wallets that signed in from the same subnet: a second signal is needed before disqualifying (rule D10) */
  ipOverlaps: string[];
  disqualified: boolean;
  prizeEligibleOverride: false | null;
  note: string | null;
  sanctionsCheckedAt: number | null;
  sanctionsClean: boolean | null;
  sanctionsFresh: boolean;
}

export interface EventWinnerDto { wallet: string; place: number; amountCents: number; bps: number; rideId: string; txSignature: string | null; paidAt: number | null }

export interface AdminEventDto {
  eventId: string;
  phase: EventPhase;
  now: number;
  reviewEnd: number | null;
  appealsEnd: number | null;
  prizeTableCents: number[];
  tableIsDefault: boolean;
  /** the final list is locked: flags and the table can no longer change, payouts may be recorded */
  locked: boolean;
  lockedAt: number | null;
  paidCents: number;
  organizerCents: number;
  /** ranked candidates (top 35 plus every disqualified wallet) */
  candidates: EventCandidateDto[];
  /** the frozen list with its manual USDC records, empty until the lock */
  winners: EventWinnerDto[];
}

export interface PublicEventRowDto { rank: number; place: number | null; wallet: string; bps: number; amountCents: number; prizeEligible: boolean; txSignature: string | null; solscanUrl: string | null }

export interface PublicEventBoardDto {
  eventId: string;
  /** pending = nothing public yet; preliminary = after the review end; final = the locked list */
  phase: EventPhase;
  reviewEnd: number | null;
  appealsEnd: number | null;
  rows: PublicEventRowDto[];
}

/** `AbCd…wXyZ` – enough to find yourself, not enough to be a lookup key for others. */
export const shortWallet = (wallet: string): string => (wallet.length > 10 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet);
export const solscanTxUrl = (signature: string): string => `https://solscan.io/tx/${signature}`;

/** Sanctions evidence is usable for a payout only when it says clean and is at most 24 h old (and not from the future). */
export function sanctionsFresh(review: { sanctionsClean: boolean | null; sanctionsCheckedAt: Date | null } | null, now: Date): boolean {
  if (!review || review.sanctionsClean !== true || !review.sanctionsCheckedAt) return false;
  const age = now.getTime() - review.sanctionsCheckedAt.getTime();
  return age >= 0 && age <= EVENT_SANCTIONS_MAX_AGE_MS;
}

export const trustBlocked = (score: number): boolean => score < EVENT_MIN_TRUST;
