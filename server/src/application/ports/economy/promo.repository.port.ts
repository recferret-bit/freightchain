import type { PromoCode } from '../../../domain/economy/promo-code.entity.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** One ride a `ride` promo granted. `rideId` null means the wallet has not ordered it yet. */
export interface PromoRideGrantRecord {
  code: string;
  wallet: string;
  n: number;
  tier: PaidTierId;
  rideId: string | null;
  createdAt: Date;
}

/** One use of a code by a wallet. */
export interface PromoRedemptionRecord {
  code: string;
  wallet: string;
  n: number;
  at: Date;
}

export abstract class PromoRepositoryPort {
  /** `code` must already be normalized (PromoCode.normalize). */
  abstract findByCode(code: string, tx?: TransactionHandle): Promise<PromoCode | null>;
  /** false when the code already exists. */
  abstract insert(promo: PromoCode, tx?: TransactionHandle): Promise<boolean>;
  /** Newest first. */
  abstract list(tx?: TransactionHandle): Promise<PromoCode[]>;
  /** false when there is no such code (disabling twice keeps the first date). */
  abstract disable(code: string, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /**
   * Takes ONE redemption in a single atomic statement – `UPDATE … SET redeemed = redeemed + 1 WHERE the code is enabled, started, not expired and below maxRedemptions` –
   * so two wallets can never both take the last one. false = nothing was left (or the code just expired / was disabled / has not started).
   */
  abstract takeRedemption(code: string, now: Date, tx: TransactionHandle): Promise<boolean>;
  /** Records the wallet's n-th redemption; the primary key (code, wallet, n) IS the per-wallet limit. false when that n is already taken. */
  abstract insertRedemption(code: string, wallet: string, n: number, now: Date, tx: TransactionHandle): Promise<boolean>;
  abstract countRedemptions(code: string, wallet: string, tx?: TransactionHandle): Promise<number>;
  /** Newest first; `code` / `wallet` narrow it. */
  abstract listRedemptions(filter: { code?: string; wallet?: string; limit: number }, tx?: TransactionHandle): Promise<PromoRedemptionRecord[]>;
  /** Writes the unspent ride that a redemption just granted. The (code, wallet, n) key matches the redemption. */
  abstract insertGrant(grant: PromoRideGrantRecord, tx: TransactionHandle): Promise<void>;
  abstract hasUnspent(wallet: string, tier: PaidTierId, tx?: TransactionHandle): Promise<boolean>;
  /** Claims the oldest unspent grant of this tier. Returns its code, or null when none is waiting. */
  abstract claimUnspent(wallet: string, tier: PaidTierId, rideId: string, tx: TransactionHandle): Promise<string | null>;
  abstract listUnspent(wallet: string, tx?: TransactionHandle): Promise<PromoRideGrantRecord[]>;
}
