import { Injectable } from '@nestjs/common';
import { Player } from '../../domain/players/player.entity.js';
import { utcDay } from '../../domain/shared/time.js';
import { AnalyticsPort } from '../ports/analytics/analytics.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { freeRideGranted } from './analytics-events.js';
import { emitAnalytics } from './analytics-emit.js';
import { isDemoWallet } from './demo.js';
import { GameSettingsService } from './game-settings.service.js';
import { withVersionRetry } from './version-retry.js';

/** First sight of a wallet creates the player (signup rides from `player.GameSetting`); every sight applies the live daily cap and the lazy daily grant – the fallback for the midnight job. */
@Injectable()
export class PlayerSessionService {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  /** `at`: the instant the caller reads for its own answer (so the grant and e.g. `nextFreeRideAt` agree). A lost optimistic lock means another request granted today's ride first: re-read and look again (it will find the day granted). */
  async touch(wallet: string, at?: Date): Promise<Player> {
    const now = at ?? this.clock.now();
    const settings = await this.settings.current();
    let inserted = false;
    const outcome = await withVersionRetry(async () => {
      let player = await this.players.findByWallet(wallet);
      if (!player) {
        inserted = inserted || await this.players.insertIfAbsent(Player.register(wallet, now, settings.freeOnSignup, settings.freeRidesDailyMax));
        player = await this.players.findByWallet(wallet);
      }
      if (!player) throw new Error(`player ${wallet} vanished right after being created`);
      const capChanged = player.setDailyCap(settings.freeRidesDailyMax);
      const granted = player.applyDailyGrant(now);
      return { player: granted || capChanged ? await this.players.save(player) : player, granted };
    });
    outcome.player.markNewPlayer(inserted);
    if (outcome.granted) {
      const day = utcDay(now);
      emitAnalytics(this.analytics, () => freeRideGranted(wallet, day, isDemoWallet(this.rules.get(), wallet), now));
    }
    return outcome.player;
  }
}
