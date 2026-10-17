import { Injectable } from '@nestjs/common';
import type { PromoCode } from '../../../domain/economy/promo-code.entity.js';
import { PromoRepositoryPort, type PromoRedemptionRecord, type PromoRideGrantRecord } from '../../../application/ports/economy/promo.repository.port.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { PromoMapper } from '../mappers/promo.mapper.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class PromoPrismaRepository extends PromoRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByCode(code: string, tx?: TransactionHandle): Promise<PromoCode | null> {
    const row = await clientFor(this.prisma, tx).promoCode.findUnique({ where: { code } });
    return row ? PromoMapper.toDomain(row) : null;
  }

  async insert(promo: PromoCode, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).promoCode.createMany({ data: [PromoMapper.toCreateData(promo)], skipDuplicates: true });
    return count === 1;
  }

  async list(tx?: TransactionHandle): Promise<PromoCode[]> {
    const rows = await clientFor(this.prisma, tx).promoCode.findMany({ orderBy: [{ createdAt: 'desc' }, { code: 'asc' }] });
    return rows.map(PromoMapper.toDomain);
  }

  async disable(code: string, now: Date, tx?: TransactionHandle): Promise<boolean> {
    const db = clientFor(this.prisma, tx);
    await db.promoCode.updateMany({ where: { code, disabledAt: null }, data: { disabledAt: now } });
    return (await db.promoCode.count({ where: { code } })) === 1;
  }

  /** The WHERE clause is the whole rule: a concurrent last redemption sees the incremented row (Postgres re-checks it after the row lock) and updates nothing. */
  async takeRedemption(code: string, now: Date, tx: TransactionHandle): Promise<boolean> {
    const n = await clientFor(this.prisma, tx).$executeRaw`UPDATE "economy"."PromoCode" SET redeemed = redeemed + 1
      WHERE code = ${code} AND "disabledAt" IS NULL AND "startsAt" <= ${now} AND ("expiresAt" IS NULL OR "expiresAt" > ${now}) AND ("maxRedemptions" IS NULL OR redeemed < "maxRedemptions")`;
    return n === 1;
  }

  async insertRedemption(code: string, wallet: string, n: number, now: Date, tx: TransactionHandle): Promise<boolean> {
    try {
      await clientFor(this.prisma, tx).promoRedemption.create({ data: { code, wallet, n, at: now } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false; // inside a transaction the caller must roll back – it throws a ConflictError
      throw error;
    }
  }

  async countRedemptions(code: string, wallet: string, tx?: TransactionHandle): Promise<number> {
    return clientFor(this.prisma, tx).promoRedemption.count({ where: { code, wallet } });
  }

  async listRedemptions({ code, wallet, limit }: { code?: string; wallet?: string; limit: number }, tx?: TransactionHandle): Promise<PromoRedemptionRecord[]> {
    return clientFor(this.prisma, tx).promoRedemption.findMany({ where: { ...(code ? { code } : {}), ...(wallet ? { wallet } : {}) }, orderBy: [{ at: 'desc' }, { code: 'asc' }, { n: 'desc' }], take: limit });
  }

  async insertGrant(grant: PromoRideGrantRecord, tx: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).promoRideGrant.create({ data: grant });
  }

  async hasUnspent(wallet: string, tier: PaidTierId, tx?: TransactionHandle): Promise<boolean> {
    const n = await clientFor(this.prisma, tx).promoRideGrant.count({ where: { wallet, tier, rideId: null } });
    return n > 0;
  }

  async claimUnspent(wallet: string, tier: PaidTierId, rideId: string, tx: TransactionHandle): Promise<string | null> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<{ code: string }[]>`
      UPDATE "economy"."PromoRideGrant" AS g SET "rideId" = ${rideId}
      WHERE g."rideId" IS NULL AND (g.code, g.wallet, g.n) = (
        SELECT code, wallet, n FROM "economy"."PromoRideGrant"
        WHERE wallet = ${wallet} AND tier = ${tier} AND "rideId" IS NULL
        ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE)
      RETURNING g.code`;
    return rows[0]?.code ?? null;
  }

  async listUnspent(wallet: string, tx?: TransactionHandle): Promise<PromoRideGrantRecord[]> {
    const rows = await clientFor(this.prisma, tx).promoRideGrant.findMany({ where: { wallet, rideId: null }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({ code: row.code, wallet: row.wallet, n: row.n, tier: row.tier as PaidTierId, rideId: row.rideId, createdAt: row.createdAt }));
  }
}
