import { Injectable } from '@nestjs/common';
import { SponsoredTxRepositoryPort, type SponsoredTxRow } from '../../../application/ports/economy/sponsored-tx.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { ChainEventMapper } from '../mappers/chain-event.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

/** The gas sponsor's ledger. A duplicate signature is skipped (ON CONFLICT DO NOTHING), so recording inside the settle transaction never aborts it. */
@Injectable()
export class SponsoredTxPrismaRepository extends SponsoredTxRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async record(row: SponsoredTxRow, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).sponsoredTx.createMany({ data: [ChainEventMapper.sponsoredToCreateData(row)], skipDuplicates: true });
    return count === 1;
  }

  async countSince(wallet: string, since: Date, tx?: TransactionHandle): Promise<number> {
    return clientFor(this.prisma, tx).sponsoredTx.count({ where: { wallet, at: { gte: since } } });
  }
}
