import type { LiveTotalsByRide } from '../../../domain/live/live.dto.js';
import type { RideEvent } from '../../../domain/live/ride-event.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** One confirmed tip (a feed row, not a still-pending order) for GET /api/me/donations. */
export interface TipHistoryRow {
  id: number;
  rideId: string;
  fromWallet: string;
  toWallet: string;
  lamports: number;
  note: string | null;
  signature: string | null;
  at: Date;
}

export abstract class RideEventRepositoryPort {
  /** Stores a new line and returns it numbered; null = refused: its bucket (rideId, slotKey, slot) is taken, or – `minGapMs` set (game effects) – the
      ride's last game effect is less than that old. The gap check and the insert run under a per-ride advisory lock, so racing posts never both pass. */
  abstract insert(event: RideEvent, minGapMs?: number): Promise<RideEvent | null>;
  /** when the ride's last game effect was posted (null = none) – for the 429's wait */
  abstract lastEffectAt(rideId: string): Promise<Date | null>;
  /** events of the ride whose applied stamp is newer than `since`, oldest stamp first */
  abstract listAppliedSince(rideId: string, since: Date, limit: number): Promise<RideEvent[]>;
  abstract findById(id: number, tx?: TransactionHandle): Promise<RideEvent | null>;
  /** the paid donation this transfer paid (null = none) */
  abstract findBySignature(signature: string): Promise<RideEvent | null>;
  /** The driver's game applied it: stores the stamp unless one is there already (first wins). True = this call stored it. */
  abstract saveApplied(event: RideEvent, tx?: TransactionHandle): Promise<boolean>;
  /** The ride's feed after event id `afterId`, oldest first, at most `limit`. */
  abstract listAfter(rideId: string, afterId: number, limit: number, tx?: TransactionHandle): Promise<RideEvent[]>;
  abstract totals(rideId: string): Promise<LiveTotalsByRide>;
  /** Confirmed tips this wallet sent, and tips whose ride it drove. Newest first, at most `limit` each. */
  abstract tipsFor(wallet: string, limit: number): Promise<{ sent: TipHistoryRow[]; received: TipHistoryRow[] }>;
  /** Replay chat lines this wallet posted on the ride since `since` (the 5 / 60 s window). */
  abstract countRecentChat(rideId: string, wallet: string, since: Date): Promise<number>;
  /** Hide a chat line. False when the id is not a message. */
  abstract hideMessage(id: number): Promise<boolean>;
  /** Delete chat lines older than `cutoff`. Donations stay. Returns how many rows went. */
  abstract purgeMessagesBefore(cutoff: Date): Promise<number>;
}
