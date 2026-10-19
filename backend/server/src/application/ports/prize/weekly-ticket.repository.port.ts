import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** One granted paid ticket of one tier. `rideId` null means it has not been ordered. It does not roll into the next interval. */
export interface WeeklyTicketRecord {
  wallet: string;
  weekId: string;
  tier: PaidTierId;
  /** Start of the interval this row belongs to. One row per wallet, tier and start. */
  periodStart: Date;
  expiresAt: Date;
  rideId: string | null;
  createdAt: Date;
}

export abstract class WeeklyTicketRepositoryPort {
  /** Insert this interval's row if that (wallet, tier, period) does not exist. A second call does nothing. */
  abstract ensure(row: { wallet: string; weekId: string; tier: PaidTierId; periodStart: Date; expiresAt: Date; now: Date }, tx?: TransactionHandle): Promise<void>;
  /** Unspent tickets that have not expired, 1h then 4h then 8h. */
  abstract live(wallet: string, now: Date, tx?: TransactionHandle): Promise<WeeklyTicketRecord[]>;
  /** True when this interval already produced a row, spent or not. */
  abstract hasPeriod(wallet: string, tier: PaidTierId, periodStart: Date, tx?: TransactionHandle): Promise<boolean>;
  /** Mark one unspent, unexpired ticket of this tier as spent on `rideId`. False when there is nothing to take. */
  abstract claim(wallet: string, tier: PaidTierId, rideId: string, now: Date, tx: TransactionHandle): Promise<boolean>;
}
