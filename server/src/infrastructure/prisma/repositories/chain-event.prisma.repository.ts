import { Injectable } from '@nestjs/common';
import type { ChainEventRow } from '../../../domain/economy/chain-events.js';
import { ChainEventRepositoryPort } from '../../../application/ports/economy/chain-event.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { ChainEventMapper } from '../mappers/chain-event.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

/** ChainEvent rows. A duplicate (signature, index) is skipped with ON CONFLICT DO NOTHING – never a unique violation, which would abort the caller's transaction. */
@Injectable()
export class ChainEventPrismaRepository extends ChainEventRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(signature: string, index: number, tx?: TransactionHandle): Promise<ChainEventRow | null> {
    const row = await clientFor(this.prisma, tx).chainEvent.findUnique({ where: { signature_index: { signature, index } } });
    return row ? ChainEventMapper.toDomain(row) : null;
  }

  async record(row: ChainEventRow, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).chainEvent.createMany({ data: [ChainEventMapper.toCreateData(row)], skipDuplicates: true });
    return count === 1;
  }

  async recentOfPool(poolId: number, limit: number, tx?: TransactionHandle): Promise<ChainEventRow[]> {
    const rows = await clientFor(this.prisma, tx).chainEvent.findMany({ where: { poolId }, orderBy: [{ at: 'desc' }, { signature: 'desc' }, { index: 'desc' }], take: limit });
    return rows.map((r) => ChainEventMapper.toDomain(r));
  }

  async listUnfinalized(limit: number, tx?: TransactionHandle): Promise<ChainEventRow[]> {
    const rows = await clientFor(this.prisma, tx).chainEvent.findMany({
      where: { outcome: { in: ['settled', 'applied'] }, finalizedAt: null }, orderBy: [{ at: 'asc' }, { signature: 'asc' }, { index: 'asc' }], take: limit,
    });
    return rows.map((r) => ChainEventMapper.toDomain(r));
  }

  async markFinalized(signature: string, at: Date, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).chainEvent.updateMany({ where: { signature, finalizedAt: null }, data: { finalizedAt: at } });
  }

  async markDropped(signature: string, detail: string, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).chainEvent.updateMany({ where: { signature }, data: { outcome: 'dropped', detail } });
  }
}
