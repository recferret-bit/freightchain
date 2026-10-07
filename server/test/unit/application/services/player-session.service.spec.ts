import { PlayerRepositoryPort } from '../../../../src/application/ports/players/player.repository.port.js';
import { PlayerSessionService } from '../../../../src/application/services/player-session.service.js';
import { Player } from '../../../../src/domain/players/player.entity.js';
import { VersionConflictError } from '../../../../src/domain/shared/errors.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { RecordingAnalytics } from '../../../support/recording-analytics.js';
import { FixedRules, unitContext } from '../../../support/unit-context.js';

describe('PlayerSessionService', () => {
  it('first sight registers the wallet with the signup credits; same-day sights change nothing', async () => {
    const ctx = unitContext();
    expect(await ctx.sessions.touch('w')).toMatchObject({ wallet: 'w', freeRides: 5, version: 1 });
    expect(await ctx.sessions.touch('w')).toMatchObject({ freeRides: 5, version: 1 });
  });

  it('the next UTC day grants one credit, once – and not above the cap', async () => {
    const ctx = unitContext();
    await ctx.sessions.touch('w');
    ctx.clock.advance(86_400);
    expect((await ctx.sessions.touch('w')).freeRides).toBe(5); // already full
    const spent = await ctx.storedPlayer('w');
    spent.spendFreeRide();
    await ctx.players.save(spent);
    ctx.clock.advance(86_400);
    expect((await ctx.sessions.touch('w')).freeRides).toBe(5);
    expect((await ctx.sessions.touch('w')).freeRides).toBe(5);
  });

  it('after losing the lock to a concurrent grant it re-reads and does not grant again', async () => {
    const clock = new FakeClock();
    class Racing extends PlayerRepositoryPort {
      stored = Player.register('w', new Date(clock.ms - 86_400_000), 5, 5);
      saves = 0;
      async findByWallet() { return Player.restore(this.stored.snapshot()); }
      async findByWalletForUpdate() { return this.findByWallet(); }
      async insertIfAbsent() { return false; }
      async grantDailyFreeRides() { return 0; }
      async save(p: Player): Promise<Player> {
        this.saves++;
        this.stored = Player.restore({ ...p.snapshot(), version: p.version + 1 }); // the competitor's identical grant lands first…
        throw new VersionConflictError(); // …so ours loses
      }
    }
    const players = new Racing();
    const player = await new PlayerSessionService(players, new FixedRules(), clock, new RecordingAnalytics()).touch('w');
    expect(players.saves).toBe(1);
    expect(player.freeRides).toBe(5);
  });

  it('gives up with the conflict when it keeps losing', async () => {
    const clock = new FakeClock();
    let day = 0;
    class AlwaysLosing extends PlayerRepositoryPort {
      async findByWallet() { return Player.register('w', new Date(clock.ms - (++day + 1) * 86_400_000), 5, 5); } // always "yesterday or older"
      async findByWalletForUpdate() { return this.findByWallet(); }
      async insertIfAbsent() { return false; }
      async grantDailyFreeRides() { return 0; }
      async save(): Promise<Player> { throw new VersionConflictError(); }
    }
    await expect(new PlayerSessionService(new AlwaysLosing(), new FixedRules(), clock, new RecordingAnalytics()).touch('w')).rejects.toBeInstanceOf(VersionConflictError);
  });
});
