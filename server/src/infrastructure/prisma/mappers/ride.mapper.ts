import type { Ride as RideRow, RideStatus as RideStatusRow } from '@prisma/client';
import { Ride, type RideProps } from '../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../domain/rides/ride-status.js';
import type { RideTierId } from '../../../domain/rides/ride-tier.js';

/** Row ⇄ entity. Lamports are BigInt in the database and plain numbers in the domain (SOL amounts stay far below 2^53). */
export class RideMapper {
  static toDomain(row: RideRow): Ride {
    return Ride.restore({
      id: row.id, wallet: row.wallet, tier: row.tier as RideTierId, seed: row.seed, minSeconds: row.minSeconds, completeDist: row.completeDist,
      status: row.status as unknown as RideStatus, createdAt: row.createdAt, timeScale: row.timeScale, priceUsd: row.priceUsd, lamports: Number(row.lamports),
      solUsd: row.solUsd, quoteExpiresAt: row.quoteExpiresAt, roundId: row.roundId, poolId: row.poolId, paidAt: row.paidAt, route: row.route, cabin: row.cabin, nightSeconds: row.nightSeconds,
      paused: row.paused, startedAt: row.startedAt, lastHbAt: row.lastHbAt, lastS: row.lastS, lastT: row.lastT, driveSeconds: row.driveSeconds,
      hull: row.hull, endedAt: row.endedAt, reason: row.reason, version: row.version,
    });
  }

  static toCreateData(ride: Ride) {
    const p = ride.snapshot();
    return { ...RideMapper.mutableData(p), id: p.id, wallet: p.wallet, tier: p.tier, seed: p.seed, minSeconds: p.minSeconds, completeDist: p.completeDist,
      createdAt: p.createdAt, timeScale: p.timeScale, priceUsd: p.priceUsd, lamports: BigInt(p.lamports), solUsd: p.solUsd, quoteExpiresAt: p.quoteExpiresAt, poolId: p.poolId, version: p.version };
  }

  /** The columns that change during a ride's life (everything else is fixed at creation). */
  static mutableData(p: RideProps) {
    return {
      status: p.status as unknown as RideStatusRow, roundId: p.roundId, paidAt: p.paidAt, route: p.route, cabin: p.cabin, nightSeconds: p.nightSeconds, paused: p.paused,
      startedAt: p.startedAt, lastHbAt: p.lastHbAt, lastS: p.lastS, lastT: p.lastT, driveSeconds: p.driveSeconds, hull: p.hull, endedAt: p.endedAt, reason: p.reason,
    };
  }
}
