import { Injectable } from '@nestjs/common';
import { ChainCursorRepositoryPort, type ChainCursorRow } from '../../../application/ports/economy/chain-event.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { ChainEventMapper } from '../mappers/chain-event.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

/** The watcher's bookmark(s): one row per key, moved with an upsert. */
@Injectable()
export class ChainCursorPrismaRepository extends ChainCursorRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async get(key: string, tx?: TransactionHandle): Promise<ChainCursorRow | null> {
    const row = await clientFor(this.prisma, tx).chainCursor.findUnique({ where: { key } });
    return row ? ChainEventMapper.cursorToDomain(row) : null;
  }

  async set(row: ChainCursorRow, tx?: TransactionHandle): Promise<void> {
    const data = { signature: row.signature, slot: row.slot === null ? null : BigInt(row.slot), at: row.at };
    await clientFor(this.prisma, tx).chainCursor.upsert({ where: { key: row.key }, create: { key: row.key, ...data }, update: data });
  }
}
