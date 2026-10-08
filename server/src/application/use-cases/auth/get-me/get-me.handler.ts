import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toMeDto, type MeDto } from '../../../../domain/players/player.dto.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { demoScaleOf, isDemoWallet } from '../../../services/demo.js';
import { GetMeQuery } from './get-me.query.js';

/** Who am I. Seeing a wallet also applies the lazy daily grant (+1 free ride per UTC day) – that is intentional, not a read-side accident. */
@QueryHandler(GetMeQuery)
export class GetMeHandler implements IQueryHandler<GetMeQuery, MeDto> {
  constructor(
    private readonly sessions: PlayerSessionService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly tickets: PoolTicketsService,
  ) {}

  async execute(query: GetMeQuery): Promise<MeDto> {
    const now = this.clock.now();
    const player = await this.sessions.touch(query.wallet, now);
    const rules = this.rules.get();
    return toMeDto(player, now, isDemoWallet(rules, query.wallet), demoScaleOf(rules), await this.tickets.balances(query.wallet, now));
  }
}
