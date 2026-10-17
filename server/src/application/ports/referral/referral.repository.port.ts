import type { ReferralCodeRecord, ReferralRecord } from '../../../domain/referral/referral-rules.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** One referrer per wallet, ever. Writes run under the player row locks of the wallets they touch (address order when there are two). */
export abstract class ReferralRepositoryPort {
  abstract codeByWallet(wallet: string, tx?: TransactionHandle): Promise<ReferralCodeRecord | null>;
  abstract codeByCode(code: string, tx?: TransactionHandle): Promise<ReferralCodeRecord | null>;
  /** false = the code (or the wallet) was taken. A unique violation aborts a Postgres transaction – the caller retries a new one. */
  abstract insertCode(row: ReferralCodeRecord, tx?: TransactionHandle): Promise<boolean>;
  abstract setGift(wallet: string, gift: string, tx?: TransactionHandle): Promise<void>;
  abstract referralOf(referee: string, tx?: TransactionHandle): Promise<ReferralRecord | null>;
  abstract invitesOf(referrer: string, tx?: TransactionHandle): Promise<ReferralRecord[]>;
  /** pending rows of this referrer whose window has closed become expired (the slot returns; the referee cannot bind again). */
  abstract expireDue(referrer: string, now: Date, tx?: TransactionHandle): Promise<number>;
  abstract insertReferral(row: ReferralRecord, tx?: TransactionHandle): Promise<boolean>;
  abstract saveReferral(row: ReferralRecord, tx?: TransactionHandle): Promise<void>;
  /** qualified rows of this referrer whose free-ride grant landed at or after `since`. */
  abstract weeklyFreeGrants(referrer: string, since: Date, tx?: TransactionHandle): Promise<number>;
  /** completed paid shifts whose verdict is verified. */
  abstract verifiedPaidShifts(wallet: string, tx?: TransactionHandle): Promise<number>;
  /** a ride that was started, including one that was later abandoned. */
  abstract hasStartedRide(wallet: string, tx?: TransactionHandle): Promise<boolean>;
}
