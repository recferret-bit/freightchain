import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { GetRideQuery } from './get-ride.query.js';

@QueryHandler(GetRideQuery)
export class GetRideHandler implements IQueryHandler<GetRideQuery, RideDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly verdicts: RideVerdictRepositoryPort,
  ) {}

  async execute({ wallet, rideId }: GetRideQuery): Promise<RideDto> {
    const ride = await this.lookup.require(rideId, wallet);
    return toRideDto(ride, (await this.verdicts.findByRide(ride.id))?.toDto() ?? null);
  }
}
