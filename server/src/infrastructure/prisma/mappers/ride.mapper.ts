import { Prisma, type Ride as RideRow, type RideStatus as RideStatusRow } from '@prisma/client';
import { parseLoadout } from '../../../domain/economy/cosmetics.js';
import { Ride, type RideProps } from '../../../domain/rides/ride.entity.js';
import { parseChallenges } from '../../../domain/rides/ride-challenge.js';
import { RideStatus } from '../../../domain/rides/ride-status.js';
import type { RideTierId } from '../../../domain/rides/ride-tier.js';

/** Row ⇄ entity. Lamports are BigInt in the database and plain numbers in the domain (SOL amounts stay far below 2^53). */
export class RideMapper {
  static toDomain(row: RideRow): Ride {
    return Ride.restore({
      id: row.id, wallet: row.wallet, tier: row.tier as RideTierId, seed: row.seed, minSeconds: row.minSeconds, completeDist: row.completeDist,
      trafficVersion: row.trafficVersion, status: row.status as unknown as RideStatus, createdAt: row.createdAt, timeScale: row.timeScale, priceUsd: row.priceUsd, lamports: Number(row.lamports),
      solUsd: row.solUsd, quoteExpiresAt: row.quoteExpiresAt, roundId: row.roundId, poolId: row.poolId, paidAt: row.paidAt, route: row.route, startHour: row.startHour, loadout: parseLoadout(row.loadout), trip: row.trip, tutorial: row.tutorial, assist: row.assist, nightSeconds: row.nightSeconds, crashesVehicle: row.crashesVehicle, crashesBuilding: row.crashesBuilding,
      paused: row.paused, startedAt: row.startedAt, lastHbAt: row.lastHbAt, lastS: row.lastS, lastT: row.lastT, driveSeconds: row.driveSeconds,
      hull: row.hull, endedAt: row.endedAt, reason: row.reason, challenges: parseChallenges(row.challenges), nextChallengeAt: row.nextChallengeAt, version: row.version, paymentReference: row.paymentReference,
      seedCommitment: row.seedCommitment, blockhash: row.blockhash, slot: row.slot,
      ranked: row.ranked, cleanMetres: row.cleanMetres, prizeCountry: row.prizeCountry, prizeRegion: row.prizeRegion, promoCode: row.promoCode, weeklyGrant: row.weeklyGrant,
    });
  }

  static toCreateData(ride: Ride) {
    const p = ride.snapshot();
    return { ...RideMapper.mutableData(p), id: p.id, wallet: p.wallet, tier: p.tier, seed: p.seed,
      createdAt: p.createdAt, timeScale: p.timeScale, priceUsd: p.priceUsd, lamports: BigInt(p.lamports), solUsd: p.solUsd, quoteExpiresAt: p.quoteExpiresAt, poolId: p.poolId, version: p.version,
      seedCommitment: p.seedCommitment ?? null, blockhash: p.blockhash ?? null, slot: p.slot !== null && p.slot !== undefined ? BigInt(p.slot) : null };
  }

  /** The columns that change during a ride's life (everything else is fixed at creation). minSeconds / completeDist / trip: a READY free ride re-chosen at another level (Ride.chooseFree). */
  static mutableData(p: RideProps) {
    return {
      trafficVersion: p.trafficVersion ?? 0, minSeconds: p.minSeconds, completeDist: p.completeDist, status: p.status as unknown as RideStatusRow, roundId: p.roundId, paidAt: p.paidAt, route: p.route, startHour: p.startHour, loadout: p.loadout ?? Prisma.DbNull, trip: p.trip, tutorial: p.tutorial, assist: p.assist, nightSeconds: p.nightSeconds, crashesVehicle: p.crashesVehicle, crashesBuilding: p.crashesBuilding, paused: p.paused,
      startedAt: p.startedAt, lastHbAt: p.lastHbAt, lastS: p.lastS, lastT: p.lastT, driveSeconds: p.driveSeconds, hull: p.hull, endedAt: p.endedAt, reason: p.reason,
      challenges: p.challenges.length ? (p.challenges as unknown as Prisma.InputJsonValue) : Prisma.DbNull, nextChallengeAt: p.nextChallengeAt, paymentReference: p.paymentReference ?? null,
      ranked: p.ranked === true, cleanMetres: p.cleanMetres ?? null, prizeCountry: p.prizeCountry ?? null, prizeRegion: p.prizeRegion ?? null, promoCode: p.promoCode ?? null, weeklyGrant: p.weeklyGrant === true,
    };
  }
}
