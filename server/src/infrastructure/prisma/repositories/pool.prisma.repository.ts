import { Injectable } from '@nestjs/common';
import type { Pool as PoolRow, Prisma } from '@prisma/client';
import type { Pool } from '../../../domain/economy/pool.entity.js';
import type { PayoutState, PoolHold } from '../../../domain/economy/pool.types.js';
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

  async listSettled(limit: number, tx?: TransactionHandle): Promise<Pool[]> {
    const rows = await clientFor(this.prisma, tx).pool.findMany({ where: { status: 'settled' }, orderBy: [{ payoutAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map(PoolMapper.toDomain);
  }

  async listPayable(now: Date, tx?: TransactionHandle): Promise<Pool[]> {
    // program v4: the winners are committed at the PLAY deadline (public for the review lock, then paid) – the job takes a pool from there
    const rows = await clientFor(this.prisma, tx).pool.findMany({ where: { status: 'active', playDeadline: { lte: now } }, orderBy: [{ playDeadline: 'asc' }, { id: 'asc' }] });
    return rows.map(PoolMapper.toDomain);
  }

  async upsert(pool: Pool, tx?: TransactionHandle): Promise<void> {
    const data = PoolMapper.toData(pool);
    // the ride seed is written with the row and never again: two first syncs racing must not leave the pool's riders on two roads; the payout state and the
    // admin's hold are the server's own and change only through savePayout / saveHold (a sync holding a stale copy must not erase a hold)
    const { id, rideSeed: _set_once, payoutState: _p, payoutNote: _n, holdBy: _hb, holdAt: _ha, holdNote: _hn, ...update } = data;
    // …except once: a pool registered before its road was sealed (program v4, L4) takes the road from the commitment when it first appears – conditional on
    // the row having none, in one statement, so racing syncs (they derive the same seed from the same commitment) never move it twice
    if (data.seedCommitment) {
      await clientFor(this.prisma, tx).pool.updateMany({ where: { id, seedCommitment: null }, data: { rideSeed: data.rideSeed, seedCommitment: data.seedCommitment, blockhash: data.blockhash, slot: data.slot } });
    }
    await clientFor(this.prisma, tx).pool.upsert({ where: { id }, create: data, update });
  }

  async savePayout(poolId: number, state: PayoutState, note: string | null, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).pool.update({ where: { id: poolId }, data: { payoutState: state, payoutNote: note } });
  }

  async saveHold(poolId: number, hold: PoolHold | null, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).pool.update({ where: { id: poolId }, data: { holdBy: hold?.by ?? null, holdAt: hold?.at ?? null, holdNote: hold?.note ?? null } });
  }
}
