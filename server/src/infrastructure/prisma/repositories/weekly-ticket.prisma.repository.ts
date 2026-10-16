import { Injectable } from '@nestjs/common';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import { WeeklyTicketRepositoryPort, type WeeklyTicketRecord } from '../../../application/ports/prize/weekly-ticket.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class WeeklyTicketPrismaRepository extends WeeklyTicketRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async ensure(row: { wallet: string; weekId: string; tier: PaidTierId; expiresAt: Date; now: Date }, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).$executeRaw`
      INSERT INTO "player"."WeeklyTicket" ("wallet", "weekId", "tier", "expiresAt", "rideId", "createdAt")
      VALUES (${row.wallet}, ${row.weekId}, ${row.tier}, ${row.expiresAt}, NULL, ${row.now})
      ON CONFLICT ("wallet", "weekId") DO NOTHING`;
  }

  async current(wallet: string, now: Date, tx?: TransactionHandle): Promise<WeeklyTicketRecord | null> {
    const row = await clientFor(this.prisma, tx).weeklyTicket.findFirst({
      where: { wallet, rideId: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? { wallet: row.wallet, weekId: row.weekId, tier: row.tier as PaidTierId, expiresAt: row.expiresAt, rideId: row.rideId, createdAt: row.createdAt } : null;
  }

  async claim(wallet: string, tier: PaidTierId, rideId: string, now: Date, tx: TransactionHandle): Promise<boolean> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<{ weekId: string }[]>`
      UPDATE "player"."WeeklyTicket" SET "rideId" = ${rideId}
      WHERE "wallet" = ${wallet} AND "tier" = ${tier} AND "rideId" IS NULL AND "expiresAt" > ${now}
      RETURNING "weekId"`;
    return rows.length > 0;
  }
}
