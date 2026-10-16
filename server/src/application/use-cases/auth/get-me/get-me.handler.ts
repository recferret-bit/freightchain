import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { MeDto } from '../../../../domain/players/player.dto.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { MeProfileService } from '../../../services/me-profile.service.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { WeeklyTicketService } from '../../../services/weekly-ticket.service.js';
import { GetMeQuery } from './get-me.query.js';

/** Who am I. A prize-eligible wallet is issued this week's granted ticket here (lazy, not a midnight job).
    `readyFreeRide`: the free ride ordered but not started (read only – a stale running ride is left to the sweeper / the next order). */
@QueryHandler(GetMeQuery)
export class GetMeHandler implements IQueryHandler<GetMeQuery, MeDto> {
  constructor(
    private readonly sessions: PlayerSessionService,
    private readonly clock: ClockPort,
    private readonly profile: MeProfileService,
    @Optional() private readonly weekly?: WeeklyTicketService,
  ) {}

  async execute(query: GetMeQuery): Promise<MeDto> {
    const now = this.clock.now();
    const player = await this.sessions.touch(query.wallet, now);
    const ticket = this.weekly ? await this.weekly.offer(player, query.headers, now) : null;
    return this.profile.of(player, now, ticket);
  }
}
