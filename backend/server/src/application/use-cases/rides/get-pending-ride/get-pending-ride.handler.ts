import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toRideDto, type PendingRideDto } from '../../../../domain/rides/ride.dto.js';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetPendingRideQuery } from './get-pending-ride.query.js';

/** A paid order the wallet may still be owed: paid but never started, or unpaid / lapsed within 24 h (a payment could be in flight). */
@QueryHandler(GetPendingRideQuery)
export class GetPendingRideHandler implements IQueryHandler<GetPendingRideQuery, PendingRideDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet }: GetPendingRideQuery): Promise<PendingRideDto> {
    const ride = await this.rides.findPendingPaid(wallet, new Date(this.clock.now().getTime() - DAY_MS));
    return { ride: ride ? toRideDto(ride) : null };
  }
}
