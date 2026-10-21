import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ReplayAccessService } from '../../../live/replay-access.service.js';
import { roadPlanFor, type RoadPlanDto } from '../../../../domain/road/road-plan.js';
import { GetRoadPlanQuery } from './get-road-plan.query.js';

/**
 * The obstacle plan of a public replay – the holes the server rebuilt from the seed. Same visibility as the watch page: a running ride,
 * a training ride, and a pool ride before payout (except to its driver) are 404. Nothing before the ride started: the seed is not handed out early.
 */
@QueryHandler(GetRoadPlanQuery)
export class GetRoadPlanHandler implements IQueryHandler<GetRoadPlanQuery, RoadPlanDto> {
  constructor(private readonly access: ReplayAccessService) {}

  async execute({ rideId, from, to, caller }: GetRoadPlanQuery): Promise<RoadPlanDto> {
    const ride = await this.access.requireWatchable(rideId, caller);
    return roadPlanFor(ride.seed, ride.trip).window(ride.id, from, to);
  }
}
