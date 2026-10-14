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
      sealSlot: row.sealSlot !== null ? Number(row.sealSlot) : null,
      winnersRoot: row.winnersRoot,
      committedAt: row.committedAt,
      payFrom: row.payFrom,
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
      slot: s.slot !== null && s.slot !== undefined ? BigInt(s.slot) : null,
      sealSlot: s.sealSlot !== null && s.sealSlot !== undefined ? BigInt(s.sealSlot) : null,
      winnersRoot: s.winnersRoot ?? null,
      committedAt: s.committedAt ?? null,
      payFrom: s.payFrom ?? null,
    };
  }
}
