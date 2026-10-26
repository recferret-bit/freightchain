import { Injectable } from '@nestjs/common';
import { SgtRepositoryPort, type SgtClaim } from '../../../application/trust/sgt.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { PrismaService } from '../prisma.service.js';
import { clientFor } from '../prisma-client.js';

@Injectable()
export class SgtPrismaRepository extends SgtRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }
  byWallet(wallet: string, tx?: TransactionHandle): Promise<SgtClaim | null> { return clientFor(this.prisma, tx).sgtTrustClaim.findUnique({ where: { wallet } }); }
  async claim(row: SgtClaim, tx: TransactionHandle): Promise<boolean> {
    return (await clientFor(this.prisma, tx).sgtTrustClaim.createMany({ data: [row], skipDuplicates: true })).count === 1;
  }
}
