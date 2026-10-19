import { PlayerRepositoryPort } from '../../../../src/application/ports/players/player.repository.port.js';
import { GameSettingsService } from '../../../../src/application/services/game-settings.service.js';
import { PlayerSessionService } from '../../../../src/application/services/player-session.service.js';
import { Player } from '../../../../src/domain/players/player.entity.js';
import { VersionConflictError } from '../../../../src/domain/shared/errors.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { MemoryDb } from '../../../support/in-memory/memory-db.js';
import { MemorySettingsRepository } from '../../../support/in-memory/memory-settings.js';
import { unitContext } from '../../../support/unit-context.js';

const open = (players: PlayerRepositoryPort, clock: FakeClock) =>
  new PlayerSessionService(players, new GameSettingsService(new MemorySettingsRepository(new MemoryDb())), clock);

describe('PlayerSessionService', () => {
  it('first sight registers the wallet with 10 rides and a daily cap of 5; same-day sights change nothing', async () => {
    const ctx = unitContext();
    expect(await ctx.sessions.touch('w')).toMatchObject({ wallet: 'w', freeRides: 10, freeRidesMax: 5, version: 1 });
    expect(await ctx.sessions.touch('w')).toMatchObject({ freeRides: 10, version: 1 });
  });

  it('the next UTC day does not grant a credit and does not save', async () => {
    const ctx = unitContext();
    await ctx.sessions.touch('w');
    const spent = await ctx.storedPlayer('w');
    for (let i = 0; i < 6; i++) spent.spendFreeRide();
    await ctx.players.save(spent);
    ctx.clock.advance(86_400);
    expect((await ctx.sessions.touch('w')).freeRides).toBe(4);
    expect((await ctx.storedPlayer('w')).version).toBe(2);
  });

  it('an existing wallet is not saved again on sight', async () => {
    const clock = new FakeClock();
    class Racing extends PlayerRepositoryPort {
      stored = Player.register('w', new Date(clock.ms), 5, 5);
      saves = 0;
      async findByWallet() { return Player.restore(this.stored.snapshot()); }
      async findByWalletForUpdate() { return this.findByWallet(); }
      async insertIfAbsent() { return false; }
      async grantDailyFreeRides() { return 0; }
      async save(p: Player): Promise<Player> {
        this.saves++;
        this.stored = Player.restore({ ...p.snapshot(), version: p.version + 1 });
        throw new VersionConflictError();
      }
    }
    const players = new Racing();
    const player = await open(players, clock).touch('w');
    expect(players.saves).toBe(0);
    expect(player.freeRides).toBe(5);
  });
});
