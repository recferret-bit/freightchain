import { Injectable } from '@nestjs/common';
import { replayDenial, type ReplaySubject } from '../../domain/live/replay-visibility.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import { NotFoundError } from '../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';

/** The one gate for a public replay: watch, the road plan, a tip, a receipt, a blink. Reads only. */
@Injectable()
export class ReplayAccessService {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  /** Started, finished, and visible to `caller`. A missing or unstarted ride is `not_found` (no seed). Anything else hidden is 404 with the denial code. */
  async requireWatchable(rideId: string, caller: string | null): Promise<Ride> {
    const ride = await this.rides.findById(rideId);
    if (!ride || !ride.startedAt) throw new NotFoundError('ride not found');
    const subject = await this.subject(ride);
    const denial = replayDenial(subject, caller, this.clock.now());
    if (denial) throw new NotFoundError(denial.message, denial.code);
    return ride;
  }

  private async subject(ride: Ride): Promise<ReplaySubject> {
    const [player, pool, verdict] = await Promise.all([
      this.players.findByWallet(ride.wallet),
      ride.poolId === null ? Promise.resolve(null) : this.pools.findById(ride.poolId),
      this.verdicts.findByRide(ride.id),
    ]);
    return {
      status: ride.status, tier: ride.tier, tutorial: ride.tutorial, assist: ride.assist, guest: player?.guest === true, wallet: ride.wallet,
      poolId: ride.poolId, payoutAt: pool?.payoutAt ?? null, verdict: verdict?.status ?? null,
    };
  }
}
