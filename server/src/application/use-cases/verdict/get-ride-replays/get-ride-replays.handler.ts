import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ForbiddenError, NotFoundError } from '../../../../domain/shared/errors.js';
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
    if (!ride) throw new NotFoundError('ride not found');
    if (query.wallet !== null && ride.wallet !== query.wallet) throw new ForbiddenError('not your ride');
    const rows = await this.replays.listByRide(ride.id);
    return {
      rideId: ride.id,
      replays: rows.map((r) => r.toDto()),
    };
  }
}
