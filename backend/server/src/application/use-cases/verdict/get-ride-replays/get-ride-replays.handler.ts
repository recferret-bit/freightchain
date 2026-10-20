import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import type { RideReplaysDto } from '../../../../domain/verdict/ride-replay.entity.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { RideReplayRepositoryPort } from '../../../ports/verdict/ride-replay.repository.port.js';
import { GetRideReplaysQuery } from './get-ride-replays.query.js';

@QueryHandler(GetRideReplaysQuery)
export class GetRideReplaysHandler implements IQueryHandler<GetRideReplaysQuery, RideReplaysDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly replays: RideReplayRepositoryPort,
  ) {}

  async execute(query: GetRideReplaysQuery): Promise<RideReplaysDto> {
    const ride = await this.rides.findById(query.rideId);
    // wallet null is the in-process admin read. A signed-in stranger gets the same 404 as a missing id (no existence leak).
    if (!ride || (query.wallet !== null && ride.wallet !== query.wallet)) throw new NotFoundError('ride not found');
    const rows = await this.replays.listByRide(ride.id);
    return {
      rideId: ride.id,
      replays: rows.map((r) => r.toDto()),
    };
  }
}
