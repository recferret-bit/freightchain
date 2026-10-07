import { AchievementRepositoryPort } from '../../../../src/application/ports/achievements/achievement.repository.port.js';
import { AchievementService } from '../../../../src/application/services/achievement.service.js';
import type { AchievementUnlock } from '../../../../src/domain/achievements/achievement-unlock.entity.js';
import type { Facts } from '../../../../src/domain/achievements/achievements.js';
import { unitContext } from '../../../support/unit-context.js';

const facts = (over: Partial<Facts>): Facts => ({ started: 0, completed: 0, totalMetres: 0, completedAtNight: false, cleanRun: false, completedSiberia: false, ...over });

describe('AchievementService', () => {
  it('persists only the NEW unlocks, in one insert, and never removes one', async () => {
    const ctx = unitContext();
    let inserts = 0;
    class Counting extends AchievementRepositoryPort {
      insertAll = async (u: readonly AchievementUnlock[]) => { inserts++; return ctx.unlocks.insertAll(u); };
      listByWallet = (w: string) => ctx.unlocks.listByWallet(w);
    }
    const service = new AchievementService(new Counting(), ctx.rideQuery, ctx.clock);
    expect(await service.evaluate('w', 'r1', facts({ started: 1, completed: 1, cleanRun: true }))).toEqual(['first-mile', 'shift-complete', 'clean-run']);
    expect(inserts).toBe(1);
    expect(await service.evaluate('w', 'r2', facts({ started: 2, completed: 2, cleanRun: true }))).toEqual([]);
    expect(inserts).toBe(1); // nothing new → no insert at all
    expect(await service.evaluate('w', null, facts({}))).toEqual([]); // weaker facts later never remove
    expect((await ctx.unlocks.listByWallet('w')).map((u) => u.rideId)).toEqual(['r1', 'r1', 'r1']);
  });

  it('reads the facts itself when the caller has none', async () => {
    const ctx = unitContext();
    await ctx.freeRide('w', true);
    expect(await ctx.achievements.evaluate('w')).toEqual(['first-mile']);
  });

  it('lists the whole catalogue with the unlock times; top 20 is marked "awarded at round close"', async () => {
    const ctx = unitContext();
    await ctx.achievements.evaluate('w', null, facts({ started: 1 }));
    const list = await ctx.achievements.list('w');
    expect(list).toHaveLength(7);
    expect(list.find((a) => a.id === 'first-mile')?.earnedAt).toBe(ctx.clock.ms);
    expect(list.find((a) => a.id === 'top-20')).toMatchObject({ earnedAt: null, awardedAtRoundClose: true });
  });
});
