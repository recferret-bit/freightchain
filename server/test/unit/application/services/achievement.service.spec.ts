import { AchievementRepositoryPort } from '../../../../src/application/ports/achievements/achievement.repository.port.js';
import { AchievementService } from '../../../../src/application/services/achievement.service.js';
import type { AchievementUnlock } from '../../../../src/domain/achievements/achievement-unlock.entity.js';
import type { Facts } from '../../../../src/domain/achievements/achievements.js';
import { unitContext, unitRules } from '../../../support/unit-context.js';
import { RideVerdict } from '../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { RULES_VERSION } from '../../../../src/domain/verdict/verdict-rules.js';
import { ACHIEVEMENTS, badgeRejected } from '../../../../src/domain/achievements/achievements.js';

const facts = (over: Partial<Facts>): Facts => ({ started: 0, paidShifts: 0, totalMetres: 0, nightShifts: 0, cleanRuns: 0, siberiaShifts: 0, freeUnassisted: 0, completedFreeLevels: [], qualifiedReferrals: 0, ...over });

describe('AchievementService', () => {
  it('persists only the NEW unlocks, in one insert, and never removes one', async () => {
    const ctx = unitContext();
    let inserts = 0;
    class Counting extends AchievementRepositoryPort {
      insertAll = async (u: readonly AchievementUnlock[]) => { inserts++; return ctx.unlocks.insertAll(u); };
      listByWallet = (w: string) => ctx.unlocks.listByWallet(w);
    }
    const service = new AchievementService(new Counting(), ctx.mints, ctx.rideQuery, ctx.clock, ctx.rules);
    const ids = (rows: { id: string }[]) => rows.map((u) => u.id);
    expect(ids(await service.evaluate('w', 'r1', facts({ started: 1, paidShifts: 1, cleanRuns: 1 })))).toEqual(['first-mile', 'shift-complete', 'clean-run']);
    expect(inserts).toBe(1);
    expect(ids(await service.evaluate('w', 'r2', facts({ started: 2, paidShifts: 2, cleanRuns: 1 })))).toEqual([]);
    expect(inserts).toBe(1); // nothing new → no insert at all
    expect(ids(await service.evaluate('w', null, facts({})))).toEqual([]); // weaker facts later never remove
    expect((await ctx.unlocks.listByWallet('w')).map((u) => u.rideId)).toEqual(['r1', 'r1', 'r1']);
  });

  it('returns only the ids this call inserted, so a concurrent insert is not emitted twice', async () => {
    const ctx = unitContext();
    class Partial extends AchievementRepositoryPort {
      insertAll = async (u: readonly AchievementUnlock[]) => u.filter((row) => row.achievementId !== 'shift-complete').map((row) => row.achievementId);
      listByWallet = () => ctx.unlocks.listByWallet('w');
    }
    const service = new AchievementService(new Partial(), ctx.mints, ctx.rideQuery, ctx.clock, ctx.rules);
    expect((await service.evaluate('w', 'r1', facts({ started: 1, paidShifts: 1 }))).map((u) => u.id)).toEqual(['first-mile']);
  });

  it('reads the facts itself when the caller has none', async () => {
    const ctx = unitContext();
    await ctx.freeRide('w', true);
    expect((await ctx.achievements.evaluate('w')).map((u) => u.id)).toEqual(['first-mile']);
  });

  it('lists the whole catalogue with the unlock times; top 20 is marked "awarded at round close"', async () => {
    const ctx = unitContext();
    await ctx.achievements.evaluate('w', null, facts({ started: 1 }));
    const list = await ctx.achievements.list('w', facts({ started: 1 }));
    expect(list).toHaveLength(ACHIEVEMENTS.length);
    expect(list.find((a) => a.id === 'first-mile-2')).toMatchObject({ earnedAt: null, family: 'road', tier: 2, tierName: 'Silver', progress: { value: 1, target: 10 }, nft: null });
    expect(list.find((a) => a.id === 'first-mile')?.earnedAt).toBe(ctx.clock.ms);
    expect(list.find((a) => a.id === 'top-20')).toMatchObject({ earnedAt: null, awardedAtRoundClose: true });
  });

  /* a ride completed on the EASY level (free-1), then judged with `status` / `codes` */
  async function judgedEasyRun(enforce: boolean, status: VerdictStatus | null, codes: string[]) {
    const ctx = unitContext(unitRules({ verdictEnforce: enforce }));
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(70);
    ride.applyReport({ s: 500, t: 70, hull: 100 } as never, ctx.clock.now(), ctx.rules.get());
    ride.finish('shift', null, ctx.clock.now());
    await ctx.rides.save(ride);
    if (status) await ctx.verdictRepo.save(RideVerdict.restore({ rideId: ride.id, status, reasons: codes.map((code) => ({ code, severity: status === VerdictStatus.Rejected ? 'reject' : 'flag', detail: '' })) as never, rulesVersion: RULES_VERSION, judgedAt: ctx.clock.now(), version: 1, scores: null as never }));
    return (await ctx.achievements.evaluate('w', ride.id)).map((u) => u.id);
  }

  it('while the verdict is ENFORCED a rejected recording earns no badge for its ride; a flagged / verified one does', async () => {
    expect(await judgedEasyRun(true, VerdictStatus.Rejected, ['obstacle-ignored'])).toEqual(['first-mile']);   // started counts – it is not a judged fact; its metres don't (Century)
    expect(await judgedEasyRun(true, VerdictStatus.Flagged, ['uniform-holds'])).toEqual(expect.arrayContaining(['free-easy', 'on-my-own']));
    expect(await judgedEasyRun(true, VerdictStatus.Verified, [])).toEqual(expect.arrayContaining(['free-easy']));
  });

  it('in shadow mode (VERDICT_ENFORCE=false, production today) the verdict changes no badge; a ride with NO recording is never "rejected" for badges', async () => {
    expect(await judgedEasyRun(false, VerdictStatus.Rejected, ['obstacle-ignored'])).toEqual(expect.arrayContaining(['free-easy']));
    expect(await judgedEasyRun(true, VerdictStatus.Rejected, ['no-recording'])).toEqual(expect.arrayContaining(['free-easy']));
    expect(await judgedEasyRun(true, null, [])).toEqual(expect.arrayContaining(['free-easy']));   // not judged (yet)
    expect(badgeRejected({ status: 'rejected', reasons: [{ code: 'no-recording' }, { code: 'teleport' }] })).toBe(true);
    expect(badgeRejected({ status: 'rejected', reasons: 'junk' })).toBe(true);
    expect(badgeRejected(null)).toBe(false);
  });
});
