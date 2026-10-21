import { Injectable } from '@nestjs/common';
import { FinishRulesPort } from '../../application/rides/finish-rules.port.js';
import type { TransactionHandle } from '../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma/prisma-client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Writes `ride.Ride.finishRulesVersion` when Lane 1 has added the column. */
@Injectable()
export class PrismaFinishRulesRepository extends FinishRulesPort {
  private columnReady = false;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async stamp(rideId: string, finishRulesVersion: number, tx?: TransactionHandle): Promise<boolean> {
    const db = clientFor(this.prisma, tx);
    if (!this.columnReady) {
      const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'ride' AND table_name = 'Ride' AND column_name = 'finishRulesVersion'`;
      if (!rows.length) return false;
      this.columnReady = true;
    }
    await db.$executeRaw`UPDATE ride."Ride" SET "finishRulesVersion" = ${finishRulesVersion} WHERE id = ${rideId}`;
    return true;
  }
}
