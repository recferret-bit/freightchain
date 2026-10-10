import { Injectable } from '@nestjs/common';
import { DailySeedRepositoryPort } from '../../../application/ports/rides/daily-seed.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import { PrismaService } from '../prisma.service.js';
import { clientFor } from '../prisma-client.js';

@Injectable()
export class DailySeedPrismaRepository extends DailySeedRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** INSERT … ON CONFLICT DO NOTHING, then read: a racing first insert blocks on the primary key until the other commits, and the read (a new statement) sees it. */
  async claim(tier: PaidTierId, day: string, candidate: number, at: Date, tx?: TransactionHandle): Promise<number> {
    const db = clientFor(this.prisma, tx);
    await db.dailySeed.createMany({ data: [{ tier, day, seed: candidate, createdAt: at }], skipDuplicates: true });
    const row = await db.dailySeed.findUnique({ where: { tier_day: { tier, day } } });
    if (!row) throw new Error(`daily seed ${tier} ${day} vanished after its insert`);
    return row.seed;
  }
}
