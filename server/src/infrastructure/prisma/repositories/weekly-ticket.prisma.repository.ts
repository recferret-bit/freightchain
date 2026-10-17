import { Injectable } from '@nestjs/common';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import { WeeklyTicketRepositoryPort, type WeeklyTicketRecord } from '../../../application/ports/prize/weekly-ticket.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const TIER_ORDER: Record<string, number> = { '1h': 0, '4h': 1, '8h': 2 };

@Injectable()
export class WeeklyTicketPrismaRepository extends WeeklyTicketRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async ensure(row: { wallet: string; weekId: string; tier: PaidTierId; periodStart: Date; expiresAt: Date; now: Date }, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).$executeRaw`
      INSERT INTO "player"."WeeklyTicket" ("wallet", "weekId", "tier", "periodStart", "expiresAt", "rideId", "createdAt")
      VALUES (${row.wallet}, ${row.weekId}, ${row.tier}, ${row.periodStart}, ${row.expiresAt}, NULL, ${row.now})
      ON CONFLICT ("wallet", "tier", "periodStart") DO NOTHING`;
  }

  async live(wallet: string, now: Date, tx?: TransactionHandle): Promise<WeeklyTicketRecord[]> {
    const rows = await clientFor(this.prisma, tx).weeklyTicket.findMany({
      where: { wallet, rideId: null, expiresAt: { gt: now } },
    });
    return rows
      .map((row) => ({ wallet: row.wallet, weekId: row.weekId, tier: row.tier as PaidTierId, periodStart: row.periodStart, expiresAt: row.expiresAt, rideId: row.rideId, createdAt: row.createdAt }))
      .sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || a.periodStart.getTime() - b.periodStart.getTime());
  }

  async hasPeriod(wallet: string, tier: PaidTierId, periodStart: Date, tx?: TransactionHandle): Promise<boolean> {
    const row = await clientFor(this.prisma, tx).weeklyTicket.findFirst({ where: { wallet, tier, periodStart }, select: { wallet: true } });
    return row !== null;
  }

  async claim(wallet: string, tier: PaidTierId, rideId: string, now: Date, tx: TransactionHandle): Promise<boolean> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<{ periodStart: Date }[]>`
      UPDATE "player"."WeeklyTicket" SET "rideId" = ${rideId}
      WHERE "wallet" = ${wallet} AND "tier" = ${tier} AND "rideId" IS NULL AND "expiresAt" > ${now}
        AND "periodStart" = (
          SELECT "periodStart" FROM "player"."WeeklyTicket"
          WHERE "wallet" = ${wallet} AND "tier" = ${tier} AND "rideId" IS NULL AND "expiresAt" > ${now}
          ORDER BY "periodStart" ASC
          LIMIT 1
        )
      RETURNING "periodStart"`;
    return rows.length > 0;
  }
}
