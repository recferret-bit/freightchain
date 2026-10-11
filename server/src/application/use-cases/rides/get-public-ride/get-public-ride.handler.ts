import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toPublicRideDto, type PublicRideDto, type PublicRideVerdictDto } from '../../../../domain/rides/public-ride.dto.js';
import { DomainError } from '../../../../domain/shared/errors.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { GetPublicRideQuery } from './get-public-ride.query.js';

@QueryHandler(GetPublicRideQuery)
export class GetPublicRideHandler implements IQueryHandler<GetPublicRideQuery, PublicRideDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    @Optional() private readonly verdicts?: RideVerdictRepositoryPort,
  ) {}

  async execute({ rideId }: GetPublicRideQuery): Promise<PublicRideDto> {
    const ride = await this.rides.findById(rideId);
    if (!ride) throw DomainError.notFound('ride_not_found', 'Ride not found');

    let verdict: PublicRideVerdictDto | null = null;
    const v = (ride as any).verdict ?? (this.verdicts ? await this.verdicts.findByRide(ride.id) : null);
    if (v) {
      const dto = typeof v.toDto === 'function' ? v.toDto() : v;
      if (dto.status === 'verified' || dto.status === 'flagged' || dto.status === 'rejected') {
        verdict = {
          status: dto.status,
          reasons: (dto.reasons ?? []).map((r: any) => (typeof r === 'string' ? r : (r.code ?? String(r)))),
        };
      }
    }

    return toPublicRideDto(ride, verdict);
  }
}
