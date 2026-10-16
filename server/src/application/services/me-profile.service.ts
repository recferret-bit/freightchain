import { Injectable, Optional } from '@nestjs/common';
import type { Player } from '../../domain/players/player.entity.js';
import { toMeDto, type MeDto, type WeeklyTicketDto } from '../../domain/players/player.dto.js';
import type { WeeklyTicketRecord } from '../ports/prize/weekly-ticket.repository.port.js';
import { readyFreeRideOf } from '../../domain/rides/ride.dto.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { NameServicePort } from '../ports/sns/name-service.port.js';
import { demoScaleOf, isDemoWallet } from './demo.js';
import { PoolTicketsService } from './pool-tickets.service.js';

/** The signed-in rider's profile – one answer for GET /api/me and the sign-in (VerifySignIn): the player (already touched by the caller), its ticket
    balances and the ready free ride (ordered, not started – read only: a stale running ride is left to the sweeper / the next order). */
@Injectable()
export class MeProfileService {
  constructor(
    private readonly rules: RulesConfigPort,
    private readonly tickets: PoolTicketsService,
    private readonly rides: RideRepositoryPort,
    @Optional() private readonly nameService?: NameServicePort,
  ) {}

  /** `now`: the instant the caller touched the player at. `ticket` is this week's grant when GET /api/me issued it. */
  async of(player: Player, now: Date, ticket: WeeklyTicketRecord | null = null): Promise<MeDto> {
    const rules = this.rules.get(), wallet = player.wallet;
    const [tickets, open, sns] = await Promise.all([
      this.tickets.balances(wallet, now),
      this.rides.listOpenByWallet(wallet),
      this.nameService ? this.nameService.reverse(wallet) : Promise.resolve(undefined),
    ]);
    const weeklyTicket: WeeklyTicketDto | null = ticket ? { tier: ticket.tier, expiresAt: ticket.expiresAt.getTime(), rideId: ticket.rideId } : null;
    return toMeDto(player, now, isDemoWallet(rules, wallet), demoScaleOf(rules), tickets, readyFreeRideOf(open), sns, weeklyTicket);
  }
}
