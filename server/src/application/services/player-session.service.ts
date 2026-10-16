import { Injectable } from '@nestjs/common';
import { Player } from '../../domain/players/player.entity.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { GameSettingsService } from './game-settings.service.js';
import { withVersionRetry } from './version-retry.js';

/** First sight of a wallet creates the player. The stored free-ride numbers are not a balance: training rides are unlimited, and this no longer grants a daily credit. */
@Injectable()
export class PlayerSessionService {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly clock: ClockPort,
  ) {}

  /** `guest` is stored only when this call inserts the row. An existing wallet is never flipped. */
  async touch(wallet: string, at?: Date, opts?: { guest?: boolean }): Promise<Player> {
    const now = at ?? this.clock.now();
    const settings = await this.settings.current();
    let inserted = false;
    const player = await withVersionRetry(async () => {
      let row = await this.players.findByWallet(wallet);
      if (!row) {
        inserted = inserted || await this.players.insertIfAbsent(Player.register(wallet, now, settings.freeOnSignup, settings.freeRidesDailyMax, opts?.guest === true));
        row = await this.players.findByWallet(wallet);
      }
      if (!row) throw new Error(`player ${wallet} vanished right after being created`);
      return row;
    });
    player.markNewPlayer(inserted);
    return player;
  }
}
