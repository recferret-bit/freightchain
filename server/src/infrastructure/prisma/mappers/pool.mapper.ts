import type { Pool as PoolRow, PoolStatus as PoolStatusRow, Prisma } from '@prisma/client';
import { Pool } from '../../../domain/economy/pool.entity.js';
import type { PoolStatus } from '../../../domain/economy/pool.types.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';

export class PoolMapper {
  static toDomain(row: PoolRow): Pool {
    return Pool.restore({
      id: row.id, address: row.address, tier: row.tier as PaidTierId, label: row.label, priceLamports: Number(row.priceLamports),
      minTickets: row.minTickets, maxTickets: row.maxTickets, maxPerWallet: row.maxPerWallet, prepDeadline: row.prepDeadline, playDeadline: row.playDeadline,
      prizeBps: row.prizeBps, seedBps: row.seedBps, feeBps: row.feeBps, feeTreasury: row.feeTreasury, seedTreasury: row.seedTreasury,
      status: row.status as PoolStatus, ticketsSold: row.ticketsSold, buyers: row.buyers, vaultLamports: Number(row.vaultLamports), sponsored: Number(row.sponsored),
      roundId: row.roundId, rideSeed: row.rideSeed, createdAt: row.createdAt, syncedAt: row.syncedAt,
    });
  }

  static toData(pool: Pool): Prisma.PoolUncheckedCreateInput {
    const s = pool.snapshot();
    return {
      ...s, status: s.status as PoolStatusRow, priceLamports: BigInt(s.priceLamports), vaultLamports: BigInt(s.vaultLamports), sponsored: BigInt(s.sponsored),
    };
  }
}
