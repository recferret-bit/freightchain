import type { Pledge as PledgeRow, Prisma } from '@prisma/client';
import { Pledge } from '../../../domain/economy/pledge.entity.js';
import type { PledgeStatus } from '../../../domain/economy/pledge.types.js';

export class PledgeMapper {
  static toDomain(row: PledgeRow): Pledge {
    return Pledge.restore({
      id: row.id,
      pdaAddress: row.pdaAddress,
      rideId: row.rideId,
      sponsor: row.sponsor,
      driver: row.driver,
      poolId: row.poolId,
      maxLamports: row.maxLamports,
      lamportsPerKm: row.lamportsPerKm,
      targetKm: row.targetKm,
      status: row.status as PledgeStatus,
      createSignature: row.createSignature,
      settled: row.settled,
      earnedLamports: row.earnedLamports,
      refundedLamports: row.refundedLamports,
      createdAt: row.createdAt,
      settledAt: row.settledAt,
      signature: row.signature,
      slot: row.slot,
      blockhash: row.blockhash,
    });
  }

  static toData(pledge: Pledge): Prisma.PledgeUncheckedCreateInput {
    const s = pledge.snapshot();
    return {
      id: s.id,
      pdaAddress: s.pdaAddress,
      rideId: s.rideId,
      sponsor: s.sponsor,
      driver: s.driver,
      poolId: s.poolId,
      maxLamports: s.maxLamports,
      lamportsPerKm: s.lamportsPerKm,
      targetKm: s.targetKm,
      status: s.status,
      createSignature: s.createSignature,
      settled: s.settled,
      earnedLamports: s.earnedLamports,
      refundedLamports: s.refundedLamports,
      createdAt: s.createdAt,
      settledAt: s.settledAt,
      signature: s.signature,
      slot: s.slot,
      blockhash: s.blockhash ?? null,
    };
  }
}
