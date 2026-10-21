import type { TransactionHandle } from '../ports/shared/transaction.port.js';
import type { ConvoyStatus } from './convoy-rules.js';

export interface ConvoyRow {
  referee: string;
  referrer: string;
  status: ConvoyStatus;
  boundAt: Date;
  expiresAt: Date;
  activatedAt: Date | null;
  qualifyExpiresAt: Date | null;
  m1At: Date | null;
  m2At: Date | null;
}

export interface ConvoyLedgerRow {
  id: string;
  kind: 'promo_1h' | 'm1' | 'm2';
  wallet: string;
  referrer: string;
  referee: string;
  amount: number;
  unit: 'ride' | 'ten4';
  at: Date;
  dayKey: string;
  weekKey: string;
  /** Null while the TEN4 credit is inside the 48 h trust hold. Absent on a promo ride credit, which is not held. */
  releasedAt?: Date | null;
}

export interface ConvoyRideRow {
  rideId: string;
  wallet: string;
  at: Date;
  trip: string | null;
  counted: boolean;
}

export interface HiddenRead {
  /** False when `player.convoyHidden` is not a column. Callers must not treat `hidden` as that column. */
  columnPresent: boolean;
  hidden: boolean;
}

export interface ReferrerCounts {
  referrer: string;
  qualified: number;
  active: number;
}

/** Convoy rows, the TEN4/ride ledger, and the optional privacy column. Not the legacy `Referral` table. */
export abstract class ConvoyRepositoryPort {
  abstract privacyColumn(): 'present' | 'missing';
  abstract getByReferee(referee: string, tx?: TransactionHandle): Promise<ConvoyRow | null>;
  abstract listByReferrer(referrer: string, tx?: TransactionHandle): Promise<ConvoyRow[]>;
  abstract insert(row: ConvoyRow, tx?: TransactionHandle): Promise<boolean>;
  abstract save(row: ConvoyRow, tx?: TransactionHandle): Promise<void>;
  abstract deleteReferee(referee: string, tx?: TransactionHandle): Promise<boolean>;
  abstract listPendingExpired(now: Date, tx?: TransactionHandle): Promise<ConvoyRow[]>;
  abstract listActivePast(now: Date, tx?: TransactionHandle): Promise<ConvoyRow[]>;
  abstract insertLedger(row: ConvoyLedgerRow, tx?: TransactionHandle): Promise<boolean>;
  /** Marks a held TEN4 row released. False when the id is missing or already released. */
  releaseLedger(id: string, at: Date, tx?: TransactionHandle): Promise<boolean> { void id; void at; void tx; return Promise.resolve(false); }
  abstract ledger(tx?: TransactionHandle): Promise<ConvoyLedgerRow[]>;
  abstract recordRide(row: ConvoyRideRow, tx?: TransactionHandle): Promise<void>;
  abstract ridesOf(wallet: string, tx?: TransactionHandle): Promise<ConvoyRideRow[]>;
  abstract referrerCounts(tx?: TransactionHandle): Promise<ReferrerCounts[]>;
  abstract readHidden(wallet: string, tx?: TransactionHandle): Promise<HiddenRead>;
  abstract writeHidden(wallet: string, hidden: boolean, tx?: TransactionHandle): Promise<HiddenRead>;
}
