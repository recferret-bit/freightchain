import { Injectable } from '@nestjs/common';
import { Player } from '../../domain/players/player.entity.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { withVersionRetry } from './version-retry.js';

/** First sight of a wallet creates the player (with the signup free rides); every sight applies the lazy daily grant (+1 free ride per UTC day, up to the cap) – the fallback for the midnight job. */
@Injectable()
export class PlayerSessionService {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  /** `at`: the instant the caller reads for its own answer (so the grant and e.g. `nextFreeRideAt` agree). A lost optimistic lock means another request granted today's ride first: re-read and look again (it will find the day granted). */
  touch(wallet: string, at?: Date): Promise<Player> {
    const now = at ?? this.clock.now();
    return withVersionRetry(async () => {
      let player = await this.players.findByWallet(wallet);
      if (!player) {
        await this.players.insertIfAbsent(Player.register(wallet, now, this.rules.get().freeOnSignup, this.rules.get().freeRidesMax));
        player = await this.players.findByWallet(wallet);
      }
      if (!player) throw new Error(`player ${wallet} vanished right after being created`);
      return player.applyDailyGrant(now) ? this.players.save(player) : player;
    });
  }
}
