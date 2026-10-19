import { Injectable } from '@nestjs/common';
import { ReferralRepositoryPort } from '../../../application/ports/referral/referral.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import type { ReferralCodeRecord, ReferralRecord, ReferralStatus } from '../../../domain/referral/referral-rules.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const statusOf = (s: string): ReferralStatus => (s === 'qualified' || s === 'expired' ? s : 'pending');

const toCode = (r: { wallet: string; code: string; gift: string; createdAt: Date }): ReferralCodeRecord => ({ wallet: r.wallet, code: r.code, gift: r.gift, createdAt: r.createdAt });

const toReferral = (r: { referee: string; referrer: string; status: string; boundAt: Date; expiresAt: Date; qualifiedAt: Date | null; rideId: string | null; freeGranted: boolean; badgeCounted: boolean }): ReferralRecord => ({
  referee: r.referee, referrer: r.referrer, status: statusOf(r.status), boundAt: r.boundAt, expiresAt: r.expiresAt, qualifiedAt: r.qualifiedAt, rideId: r.rideId, freeGranted: r.freeGranted, badgeCounted: r.badgeCounted,
});

@Injectable()
export class ReferralPrismaRepository extends ReferralRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async codeByWallet(wallet: string, tx?: TransactionHandle): Promise<ReferralCodeRecord | null> {
    const row = await clientFor(this.prisma, tx).referralCode.findUnique({ where: { wallet } });
    return row ? toCode(row) : null;
  }

  async codeByCode(code: string, tx?: TransactionHandle): Promise<ReferralCodeRecord | null> {
    const row = await clientFor(this.prisma, tx).referralCode.findUnique({ where: { code } });
    return row ? toCode(row) : null;
  }

  async insertCode(row: ReferralCodeRecord, tx?: TransactionHandle): Promise<boolean> {
    try {
      await clientFor(this.prisma, tx).referralCode.create({ data: row });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false; // the caller's transaction is aborted – it retries a new one
      throw error;
    }
  }

  async setGift(wallet: string, gift: string, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).referralCode.update({ where: { wallet }, data: { gift } });
  }

  async referralOf(referee: string, tx?: TransactionHandle): Promise<ReferralRecord | null> {
    const row = await clientFor(this.prisma, tx).referral.findUnique({ where: { referee } });
    return row ? toReferral(row) : null;
  }

  async invitesOf(referrer: string, tx?: TransactionHandle): Promise<ReferralRecord[]> {
    const rows = await clientFor(this.prisma, tx).referral.findMany({ where: { referrer }, orderBy: { boundAt: 'desc' } });
    return rows.map(toReferral);
  }

  async expireDue(referrer: string, now: Date, tx?: TransactionHandle): Promise<number> {
    const r = await clientFor(this.prisma, tx).referral.updateMany({ where: { referrer, status: 'pending', expiresAt: { lt: now } }, data: { status: 'expired' } });
    return r.count;
  }

  async insertReferral(row: ReferralRecord, tx?: TransactionHandle): Promise<boolean> {
    try {
      await clientFor(this.prisma, tx).referral.create({ data: row });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async saveReferral(row: ReferralRecord, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).referral.update({ where: { referee: row.referee }, data: { status: row.status, qualifiedAt: row.qualifiedAt, rideId: row.rideId, freeGranted: row.freeGranted, badgeCounted: row.badgeCounted } });
  }

  async weeklyFreeGrants(referrer: string, since: Date, tx?: TransactionHandle): Promise<number> {
    return clientFor(this.prisma, tx).referral.count({ where: { referrer, freeGranted: true, qualifiedAt: { gte: since } } });
  }

  async verifiedPaidShifts(wallet: string, tx?: TransactionHandle): Promise<number> {
    return clientFor(this.prisma, tx).ride.count({ where: { wallet, status: 'completed', tier: { not: 'free' }, verdict: { status: 'verified' } } });
  }

  async hasStartedRide(wallet: string, tx?: TransactionHandle): Promise<boolean> {
    const n = await clientFor(this.prisma, tx).ride.count({ where: { wallet, startedAt: { not: null } } });
    return n > 0;
  }
}
