import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { GetRideQuery } from './get-ride.query.js';

@QueryHandler(GetRideQuery)
export class GetRideHandler implements IQueryHandler<GetRideQuery, RideDto> {
  constructor(private readonly lookup: RideLookupService) {}

  async execute({ wallet, rideId }: GetRideQuery): Promise<RideDto> {
    return toRideDto(await this.lookup.require(rideId, wallet));
  }
}
