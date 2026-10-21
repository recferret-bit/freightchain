import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { HonkRepositoryPort } from '../../../ports/honk/honk.repository.port.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { MinigameSessionService } from '../../../services/minigame-session.service.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { GetRideQuery } from './get-ride.query.js';

@QueryHandler(GetRideQuery)
export class GetRideHandler implements IQueryHandler<GetRideQuery, RideDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly honk: HonkRepositoryPort,
    @Optional() private readonly minigames?: MinigameSessionService,
  ) {}

  async execute({ wallet, rideId }: GetRideQuery): Promise<RideDto> {
    const ride = await this.lookup.require(rideId, wallet);
    const verdict = (await this.verdicts.findByRide(ride.id))?.toDto() ?? null;
    const paid = (await this.honk.findMint(ride.id))?.released === true;
    const mgSalt = verdict && this.minigames ? await this.minigames.revealSalt(ride) : undefined;
    return toRideDto(ride, verdict, null, paid, mgSalt ? { mgSalt } : undefined);
  }
}
