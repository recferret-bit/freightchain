import { Injectable } from '@nestjs/common';
import type { PoolPayout as PoolPayoutRow } from '@prisma/client';
import type { PlannedPayout, PoolPayoutRecord, PoolPayoutStatus } from '../../../domain/economy/pool-payout.js';
import { PoolPayoutRepositoryPort } from '../../../application/ports/economy/pool-payout.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const toRecord = (r: PoolPayoutRow): PoolPayoutRecord => ({
  poolId: r.poolId, rank: r.rank, wallet: r.wallet, kind: r.kind === 'referrer' ? 'referrer' : 'rider', lamports: Number(r.lamports), status: r.status as PoolPayoutStatus, signature: r.signature,
  lastValidBlockHeight: r.lastValidBlockHeight, attempts: r.attempts, error: r.error, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

@Injectable()
export class PoolPayoutPrismaRepository extends PoolPayoutRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByPool(poolId: number, tx?: TransactionHandle): Promise<PoolPayoutRecord[]> {
    return (await clientFor(this.prisma, tx).poolPayout.findMany({ where: { poolId }, orderBy: { rank: 'asc' } })).map(toRecord);
  }

  async plan(rows: PlannedPayout[], now: Date, tx?: TransactionHandle): Promise<void> {
    if (!rows.length) return;
    await clientFor(this.prisma, tx).poolPayout.createMany({
      data: rows.map((r) => ({ poolId: r.poolId, rank: r.rank, wallet: r.wallet, kind: r.kind ?? 'rider', lamports: BigInt(r.lamports), status: r.status, createdAt: now, updatedAt: now })),
      skipDuplicates: true, // ON CONFLICT DO NOTHING – (pool, rank) or (pool, wallet, kind)
    });
  }

  async claimSent(poolId: number, rank: number, signature: string, lastValidBlockHeight: number, now: Date, tx?: TransactionHandle): Promise<boolean> {
    const r = await clientFor(this.prisma, tx).poolPayout.updateMany({
      where: { poolId, rank, status: 'planned' },
      data: { status: 'sent', signature, lastValidBlockHeight, attempts: { increment: 1 }, error: null, updatedAt: now },
    });
    return r.count === 1;
  }

  /** One UPDATE that also requires the pool to be off HOLD: a claim that starts after a HOLD committed sees it (READ COMMITTED takes a fresh snapshot per
      statement), so an acknowledged HOLD is never followed by a new 'sent' row. */
  async claimSentUnlessHeld(poolId: number, rank: number, signature: string, lastValidBlockHeight: number, now: Date): Promise<'claimed' | 'held' | 'lost'> {
    const n = await this.prisma.$executeRaw`
      UPDATE "economy"."PoolPayout" SET status = 'sent', signature = ${signature}, "lastValidBlockHeight" = ${lastValidBlockHeight}, attempts = attempts + 1, error = NULL, "updatedAt" = ${now}
      WHERE "poolId" = ${poolId} AND rank = ${rank} AND status = 'planned' AND EXISTS (SELECT 1 FROM "economy"."Pool" p WHERE p.id = ${poolId} AND p."holdBy" IS NULL FOR SHARE)`;   // FOR SHARE: waits for a HOLD in flight (it locks the row FOR UPDATE)
    if (n === 1) return 'claimed';
    const pool = await this.prisma.pool.findUnique({ where: { id: poolId }, select: { holdBy: true } });
    return pool?.holdBy ? 'held' : 'lost';
  }

  async markPaid(poolId: number, rank: number, signature: string, now: Date, tx?: TransactionHandle): Promise<boolean> {
    const r = await clientFor(this.prisma, tx).poolPayout.updateMany({ where: { poolId, rank, status: 'sent', signature }, data: { status: 'paid', error: null, updatedAt: now } });
    return r.count === 1;
  }

  async release(poolId: number, rank: number, signature: string, error: string, now: Date, tx?: TransactionHandle): Promise<boolean> {
    const r = await clientFor(this.prisma, tx).poolPayout.updateMany({
      where: { poolId, rank, status: 'sent', signature }, data: { status: 'planned', signature: null, lastValidBlockHeight: null, error, updatedAt: now },
    });
    return r.count === 1;
  }

  async markPaidElsewhere(poolId: number, rank: number, now: Date, tx?: TransactionHandle): Promise<boolean> {
    const r = await clientFor(this.prisma, tx).poolPayout.updateMany({ where: { poolId, rank, status: 'planned' }, data: { status: 'paid', error: 'paid outside the payout job', updatedAt: now } });
    return r.count === 1;
  }

  async discardPlan(poolId: number, tx?: TransactionHandle): Promise<boolean> {
    const n = await clientFor(this.prisma, tx).$executeRaw`
      DELETE FROM "economy"."PoolPayout" WHERE "poolId" = ${poolId}
        AND NOT EXISTS (SELECT 1 FROM "economy"."PoolPayout" WHERE "poolId" = ${poolId} AND status <> 'planned')`;
    return n > 0 || (await clientFor(this.prisma, tx).poolPayout.count({ where: { poolId } })) === 0;
  }

  async noteError(poolId: number, rank: number, error: string, now: Date, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).poolPayout.updateMany({ where: { poolId, rank }, data: { error: error.slice(0, 500), updatedAt: now } });
  }
}
