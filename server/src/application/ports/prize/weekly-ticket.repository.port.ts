import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** One granted paid ticket. `rideId` null means it has not been ordered. It expires at the prize week's close and does not roll over. */
export interface WeeklyTicketRecord {
  wallet: string;
  weekId: string;
  tier: PaidTierId;
  expiresAt: Date;
  rideId: string | null;
  createdAt: Date;
}

export abstract class WeeklyTicketRepositoryPort {
  /** Insert this week's row if the wallet does not have one. A second call in the same week does nothing. */
  abstract ensure(row: { wallet: string; weekId: string; tier: PaidTierId; expiresAt: Date; now: Date }, tx?: TransactionHandle): Promise<void>;
  /** The unspent ticket that has not expired, if any. */
  abstract current(wallet: string, now: Date, tx?: TransactionHandle): Promise<WeeklyTicketRecord | null>;
  /** Mark the unspent, unexpired ticket of this tier as spent on `rideId`. False when there is nothing to take. */
  abstract claim(wallet: string, tier: PaidTierId, rideId: string, now: Date, tx: TransactionHandle): Promise<boolean>;
}
