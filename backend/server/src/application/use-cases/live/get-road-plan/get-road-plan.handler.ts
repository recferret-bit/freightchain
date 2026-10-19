import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { roadPlanFor, type RoadPlanDto } from '../../../../domain/road/road-plan.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { GetRoadPlanQuery } from './get-road-plan.query.js';

/**
 * PUBLIC, like the watch page – the ride's OBSTACLE PLAN: where the holes of its road are, as the SERVER rebuilt them from the ride's seed. The driver's game
 * drives over these holes (client/js/road-plan.js; its own roll is only the fallback until a stretch arrives), a spectator's replay draws them, and the
 * verdict judges the recording against the same plan – so a game that leaves a hole out is still judged on the server's hole, and a replay shows it.
 * Nothing before the ride started: the seed is not handed out early (the same rule as the watch page).
 */
@QueryHandler(GetRoadPlanQuery)
export class GetRoadPlanHandler implements IQueryHandler<GetRoadPlanQuery, RoadPlanDto> {
  constructor(private readonly rides: RideRepositoryPort) {}

  async execute({ rideId, from, to }: GetRoadPlanQuery): Promise<RoadPlanDto> {
    const ride = await this.rides.findById(rideId);
    if (!ride || !ride.startedAt) throw new NotFoundError('ride not found');
    return roadPlanFor(ride.seed, ride.trip).window(ride.id, from, to);
  }
}
