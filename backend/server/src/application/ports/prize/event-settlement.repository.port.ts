import type { TransactionHandle } from '../shared/transaction.port.js';

/** One wallet's qualifying event attempt: a completed, ranked 1h ride with the reserved promo code whose verdict is `verified`, ended inside the window. */
export interface EventCandidateRow {
  wallet: string;
  rideId: string;
  /** 0..10000 – the shared floor `cleanBps` */
  bps: number;
  country: string | null;
  region: string | null;
  trustScore: number;
  endedAt: Date;
  /** how many qualifying rides the wallet has (1 by design; more is an anomaly the reviewer should see) */
  attempts: number;
}

export interface EventReviewRecord {
  wallet: string;
  disqualified: boolean;
  /** null = geo decides; false = an admin removed the prize. A wallet cannot be forced INTO the prizes. */
  prizeEligibleOverride: false | null;
  note: string | null;
  sanctionsCheckedAt: Date | null;
  sanctionsClean: boolean | null;
  sanctionsRef: string | null;
  updatedBy: string;
  updatedAt: Date;
}

export interface EventWinnerRecord {
  wallet: string;
  place: number;
  amountCents: number;
  bps: number;
  rideId: string;
  lockedAt: Date;
  txSignature: string | null;
  paidAt: Date | null;
  recordedBy: string | null;
}

export interface EventStateRecord {
  /** null = the code default table */
  prizeTableCents: readonly number[] | null;
  lockedAt: Date | null;
  lockedBy: string | null;
}

export type PayoutOutcome = 'recorded' | 'already_paid' | 'signature_used' | 'not_a_winner';

/** `economy.EventConfig` / `EventReview` / `EventWinner` and the read of the qualifying rides. Writers run in the caller's transaction. */
export abstract class EventSettlementRepositoryPort {
  /** Best qualifying attempt per wallet (highest bps, then the earliest end). `window.end` is the event end: a ride that ended after it does not count. */
  abstract listCandidates(window: { start: Date; end: Date }, tx?: TransactionHandle): Promise<EventCandidateRow[]>;
  abstract reviews(eventId: string, tx?: TransactionHandle): Promise<EventReviewRecord[]>;
  abstract review(eventId: string, wallet: string, tx?: TransactionHandle): Promise<EventReviewRecord | null>;
  abstract saveReview(eventId: string, record: EventReviewRecord, tx: TransactionHandle): Promise<void>;
  abstract state(eventId: string, tx?: TransactionHandle): Promise<EventStateRecord>;
  /** False (nothing written) once the list is locked. */
  abstract setPrizeTable(eventId: string, cents: readonly number[], at: Date, tx: TransactionHandle): Promise<boolean>;
  /** Writes the winners and the lock in one step. False (nothing written) when it was already locked. */
  abstract lock(eventId: string, by: string, at: Date, winners: readonly EventWinnerRecord[], tx: TransactionHandle): Promise<boolean>;
  abstract winners(eventId: string, tx?: TransactionHandle): Promise<EventWinnerRecord[]>;
  /** One atomic step: the winner's row takes the signature only while it has none, and a signature belongs to one winner. */
  abstract recordPayout(eventId: string, wallet: string, txSignature: string, by: string, at: Date, tx: TransactionHandle): Promise<PayoutOutcome>;
}
