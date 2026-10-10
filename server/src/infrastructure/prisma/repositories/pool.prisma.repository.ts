import { Injectable } from '@nestjs/common';
import type { Pool as PoolRow, Prisma } from '@prisma/client';
import type { Pool } from '../../../domain/economy/pool.entity.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import { PoolRepositoryPort } from '../../../application/ports/economy/pool.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { PoolMapper } from '../mappers/pool.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const LIVE: Prisma.PoolWhereInput = { status: { in: ['open', 'active'] } };
const SOONEST: Prisma.PoolOrderByWithRelationInput[] = [{ playDeadline: 'asc' }, { id: 'asc' }];

@Injectable()
export class PoolPrismaRepository extends PoolRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: number, tx?: TransactionHandle): Promise<Pool | null> {
    const row = await clientFor(this.prisma, tx).pool.findUnique({ where: { id } });
    return row ? PoolMapper.toDomain(row) : null;
  }

  async findByAddress(address: string, tx?: TransactionHandle): Promise<Pool | null> {
    const row = await clientFor(this.prisma, tx).pool.findUnique({ where: { address } });
    return row ? PoolMapper.toDomain(row) : null;
  }

  /** One statement: read the row AND lock it until the transaction ends. */
  async findByIdForUpdate(id: number, tx: TransactionHandle): Promise<Pool | null> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<PoolRow[]>`SELECT * FROM "economy"."Pool" WHERE id = ${id} FOR UPDATE`;
    return rows[0] ? PoolMapper.toDomain(rows[0]) : null;
  }

  async findMany(ids: number[], tx?: TransactionHandle): Promise<Pool[]> {
    if (ids.length === 0) return [];
    const rows = await clientFor(this.prisma, tx).pool.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    return rows.map(PoolMapper.toDomain);
  }

  async listLive(tx?: TransactionHandle): Promise<Pool[]> {
    const rows = await clientFor(this.prisma, tx).pool.findMany({ where: LIVE, orderBy: SOONEST });
    return rows.map(PoolMapper.toDomain);
  }

  async listLiveOfTier(tier: PaidTierId, tx?: TransactionHandle): Promise<Pool[]> {
    const rows = await clientFor(this.prisma, tx).pool.findMany({ where: { ...LIVE, tier }, orderBy: SOONEST });
    return rows.map(PoolMapper.toDomain);
  }

  async listOpenPastDeadline(now: Date, tx?: TransactionHandle): Promise<Pool[]> {
    const rows = await clientFor(this.prisma, tx).pool.findMany({ where: { status: 'open', prepDeadline: { lte: now } }, orderBy: [{ prepDeadline: 'asc' }, { id: 'asc' }] });
    return rows.map(PoolMapper.toDomain);
  }

  async upsert(pool: Pool, tx?: TransactionHandle): Promise<void> {
    const data = PoolMapper.toData(pool);
    const { id, rideSeed: _set_once, ...update } = data; // the ride seed is written with the row and never again: two first syncs racing must not leave the pool's riders on two roads
    await clientFor(this.prisma, tx).pool.upsert({ where: { id }, create: data, update });
  }
}
