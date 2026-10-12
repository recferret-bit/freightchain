import type { Pool as PoolRow, PoolStatus as PoolStatusRow, Prisma } from '@prisma/client';
import { Pool } from '../../../domain/economy/pool.entity.js';
import type { PayoutState, PoolStatus } from '../../../domain/economy/pool.types.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';

export class PoolMapper {
  static toDomain(row: PoolRow): Pool {
    return Pool.restore({
      id: row.id, address: row.address, tier: row.tier as PaidTierId, label: row.label, priceLamports: Number(row.priceLamports),
      minTickets: row.minTickets, maxTickets: row.maxTickets, maxPerWallet: row.maxPerWallet, prepDeadline: row.prepDeadline, playDeadline: row.playDeadline, payoutAt: row.payoutAt,
      prizeBps: row.prizeBps, seedBps: row.seedBps, feeBps: row.feeBps, feeTreasury: row.feeTreasury, seedTreasury: row.seedTreasury,
      status: row.status as PoolStatus, ticketsSold: row.ticketsSold, buyers: row.buyers, vaultLamports: Number(row.vaultLamports), sponsored: Number(row.sponsored),
      roundId: row.roundId, rideSeed: row.rideSeed, createdAt: row.createdAt, syncedAt: row.syncedAt,
      payoutState: row.payoutState as PayoutState, payoutNote: row.payoutNote,
      hold: row.holdBy && row.holdAt ? { by: row.holdBy, at: row.holdAt, note: row.holdNote } : null,
      seedCommitment: row.seedCommitment,
      blockhash: row.blockhash,
      slot: row.slot,
      stakedLamports: row.stakedLamports,
      yieldEarned: row.yieldEarned,
    });
  }

  static toData(pool: Pool): Prisma.PoolUncheckedCreateInput {
    const { hold, ...s } = pool.snapshot();
    return {
      ...s,
      holdBy: hold?.by ?? null,
      holdAt: hold?.at ?? null,
      holdNote: hold?.note ?? null,
      status: s.status as PoolStatusRow,
      priceLamports: BigInt(s.priceLamports),
      vaultLamports: BigInt(s.vaultLamports),
      sponsored: BigInt(s.sponsored),
      stakedLamports: BigInt(s.stakedLamports ?? 0n),
      yieldEarned: BigInt(s.yieldEarned ?? 0n),
      slot: s.slot !== null && s.slot !== undefined ? BigInt(s.slot) : null,
    };
  }
}
