import { Injectable } from '@nestjs/common';
import type { Player } from '../../domain/players/player.entity.js';
import { toMeDto, type MeDto } from '../../domain/players/player.dto.js';
import { readyFreeRideOf } from '../../domain/rides/ride.dto.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
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
  ) {}

  /** `now`: the instant the caller touched the player at (so the grant and `nextFreeRideAt` agree) */
  async of(player: Player, now: Date): Promise<MeDto> {
    const rules = this.rules.get(), wallet = player.wallet;
    const [tickets, open] = await Promise.all([this.tickets.balances(wallet, now), this.rides.listOpenByWallet(wallet)]);
    return toMeDto(player, now, isDemoWallet(rules, wallet), demoScaleOf(rules), tickets, readyFreeRideOf(open));
  }
}
