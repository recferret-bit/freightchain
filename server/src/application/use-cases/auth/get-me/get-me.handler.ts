import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toMeDto, type MeDto } from '../../../../domain/players/player.dto.js';
import { readyFreeRideOf } from '../../../../domain/rides/ride.dto.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { demoScaleOf, isDemoWallet } from '../../../services/demo.js';
import { GetMeQuery } from './get-me.query.js';

/** Who am I. Seeing a wallet also applies the lazy daily grant (+1 free ride per UTC day) – that is intentional, not a read-side accident.
    `readyFreeRide`: the free ride ordered but not started (read only – a stale running ride is left to the sweeper / the next order). */
@QueryHandler(GetMeQuery)
export class GetMeHandler implements IQueryHandler<GetMeQuery, MeDto> {
  constructor(
    private readonly sessions: PlayerSessionService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly tickets: PoolTicketsService,
    private readonly rides: RideRepositoryPort,
  ) {}

  async execute(query: GetMeQuery): Promise<MeDto> {
    const now = this.clock.now();
    const player = await this.sessions.touch(query.wallet, now);
    const rules = this.rules.get();
    const [tickets, open] = await Promise.all([this.tickets.balances(query.wallet, now), this.rides.listOpenByWallet(query.wallet)]);
    return toMeDto(player, now, isDemoWallet(rules, query.wallet), demoScaleOf(rules), tickets, readyFreeRideOf(open));
  }
}
