import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { MeDto } from '../../../../domain/players/player.dto.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { MeProfileService } from '../../../services/me-profile.service.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { GetMeQuery } from './get-me.query.js';

/** Who am I. Seeing a wallet also applies the lazy daily grant (+1 free ride per UTC day) – that is intentional, not a read-side accident.
    `readyFreeRide`: the free ride ordered but not started (read only – a stale running ride is left to the sweeper / the next order). */
@QueryHandler(GetMeQuery)
export class GetMeHandler implements IQueryHandler<GetMeQuery, MeDto> {
  constructor(
    private readonly sessions: PlayerSessionService,
    private readonly clock: ClockPort,
    private readonly profile: MeProfileService,
  ) {}

  async execute(query: GetMeQuery): Promise<MeDto> {
    const now = this.clock.now();
    return this.profile.of(await this.sessions.touch(query.wallet, now), now);
  }
}
