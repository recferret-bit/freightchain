import { ReferralRepositoryPort } from '../../../src/application/ports/referral/referral.repository.port.js';
import type { ReferralCodeRecord, ReferralRecord } from '../../../src/domain/referral/referral-rules.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import type { MemoryDb } from './memory-db.js';

/** ReferralRepositoryPort's in-memory twin. Unique codes and one row per referee, like the primary keys. */
export class MemoryReferralRepository extends ReferralRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async codeByWallet(wallet: string): Promise<ReferralCodeRecord | null> {
    return this.db.referralCodes.get(wallet) ?? null;
  }

  async codeByCode(code: string): Promise<ReferralCodeRecord | null> {
    return [...this.db.referralCodes.values()].find((r) => r.code === code) ?? null;
  }

  async insertCode(row: ReferralCodeRecord): Promise<boolean> {
    if (this.db.referralCodes.has(row.wallet) || [...this.db.referralCodes.values()].some((r) => r.code === row.code)) return false;
    this.db.referralCodes.set(row.wallet, { ...row });
    return true;
  }

  async setGift(wallet: string, gift: string): Promise<void> {
    const row = this.db.referralCodes.get(wallet);
    if (row) row.gift = gift;
  }

  async referralOf(referee: string): Promise<ReferralRecord | null> {
    const row = this.db.referrals.get(referee);
    return row ? { ...row } : null;
  }

  async invitesOf(referrer: string): Promise<ReferralRecord[]> {
    return [...this.db.referrals.values()].filter((r) => r.referrer === referrer).sort((a, b) => b.boundAt.getTime() - a.boundAt.getTime()).map((r) => ({ ...r }));
  }

  async expireDue(referrer: string, now: Date): Promise<number> {
    let n = 0;
    for (const row of this.db.referrals.values()) {
      if (row.referrer === referrer && row.status === 'pending' && row.expiresAt.getTime() < now.getTime()) { row.status = 'expired'; n++; }
    }
    return n;
  }

  async insertReferral(row: ReferralRecord): Promise<boolean> {
    if (this.db.referrals.has(row.referee)) return false;
    this.db.referrals.set(row.referee, { ...row });
    return true;
  }

  async saveReferral(row: ReferralRecord): Promise<void> {
    if (this.db.referrals.has(row.referee)) this.db.referrals.set(row.referee, { ...row });
  }

  async weeklyFreeGrants(referrer: string, since: Date): Promise<number> {
    return [...this.db.referrals.values()].filter((r) => r.referrer === referrer && r.freeGranted && r.qualifiedAt && r.qualifiedAt.getTime() >= since.getTime()).length;
  }

  async verifiedPaidShifts(wallet: string): Promise<number> {
    return [...this.db.rides.values()].filter((r) => r.props.wallet === wallet && r.props.status === RideStatus.Completed && r.props.tier !== 'free' && this.db.verdicts.get(r.props.id)?.status === VerdictStatus.Verified).length;
  }

  async hasStartedRide(wallet: string): Promise<boolean> {
    return [...this.db.rides.values()].some((r) => r.props.wallet === wallet && r.props.startedAt !== null);
  }
}
