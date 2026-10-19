import { Injectable } from '@nestjs/common';
import type { Round } from '../../../domain/economy/round.entity.js';
import { RoundRepositoryPort, type RoundEntries } from '../../../application/ports/economy/round.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RoundMapper } from '../mappers/round.mapper.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RoundPrismaRepository extends RoundRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findContaining(at: Date, tx?: TransactionHandle): Promise<Round | null> {
    const row = await clientFor(this.prisma, tx).round.findFirst({ where: { startsAt: { lte: at }, endsAt: { gt: at } }, orderBy: { id: 'desc' } });
    return row ? RoundMapper.toDomain(row) : null;
  }

  async findLatest(tx?: TransactionHandle): Promise<Round | null> {
    const row = await clientFor(this.prisma, tx).round.findFirst({ orderBy: { startsAt: 'desc' } });
    return row ? RoundMapper.toDomain(row) : null;
  }

  /** The unique `startsAt` makes "the first request of the week" race-safe: the loser gets null and re-reads the winner's round. */
  async insert(round: Round, tx?: TransactionHandle): Promise<Round | null> {
    try {
      return RoundMapper.toDomain(await clientFor(this.prisma, tx).round.create({ data: RoundMapper.toCreateData(round) }));
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async save(round: Round, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).round.update({ where: { id: round.id }, data: { status: round.status as 'open' | 'closed' } });
  }

  async entriesOf(roundId: number, tx?: TransactionHandle): Promise<RoundEntries> {
    const agg = await clientFor(this.prisma, tx).payment.aggregate({ where: { roundId }, _sum: { lamports: true }, _count: { _all: true } });
    return { lamports: Number(agg._sum.lamports ?? 0n), count: agg._count._all };
  }

  async lockOpen(roundId: number, tx: TransactionHandle): Promise<boolean> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "economy"."Round" WHERE id = ${roundId} FOR UPDATE`;
    return rows[0]?.status === 'open';
  }
}
