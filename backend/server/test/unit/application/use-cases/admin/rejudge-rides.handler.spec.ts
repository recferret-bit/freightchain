import { RejudgeRidesHandler } from '../../../../../src/application/use-cases/admin/rejudge-rides/rejudge-rides.handler.js';
import { RejudgeRidesCommand } from '../../../../../src/application/use-cases/admin/rejudge-rides/rejudge-rides.command.js';
import { RULES_VERSION } from '../../../../../src/domain/verdict/verdict-rules.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

/* The bulk re-judge after a threshold change: every selected completed shift judged again at the current rules, an admin's decision kept, a swept recording skipped. */
describe('RejudgeRidesHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new RejudgeRidesHandler(ctx.rideQuery, ctx.verdicts, ctx.adminActions, ctx.clock);
    return { ctx, run: (verdict: 'unjudged' | 'verified' | 'flagged' | 'rejected' | 'all' = 'all', dryRun = false, since: Date | null = null) => handler.execute(new RejudgeRidesCommand({ verdict, since, limit: 100 }, dryRun, 'cli')) };
  };

  it('judges every selected completed shift again, reports the ones whose status changed, and audits one row', async () => {
    const { ctx, run } = setup();
    const human = await judgedRide(ctx, 'a');
    const bot = await judgedRide(ctx, 'b', { inputs: 'bot', seconds: 180 }, 180, 2400);
    expect([human.verdict?.status, bot.verdict?.status]).toEqual([VerdictStatus.Verified, VerdictStatus.Flagged]);
    // the bot's recording "improves" (a late batch of a human one replaced nothing – here the stored verdict is stale on purpose)
    const { RideVerdict } = await import('../../../../../src/domain/verdict/ride-verdict.entity.js');
    await ctx.verdictRepo.save(RideVerdict.restore({ ...bot.verdict!.snapshot(), status: VerdictStatus.Verified, rulesVersion: RULES_VERSION - 1 }));
    const r = await run('all');
    expect(r).toMatchObject({ dryRun: false, scanned: 2, judged: 2, skipped: 0, rulesVersion: RULES_VERSION, changed: [{ id: bot.ride.id, from: 'verified', to: 'flagged' }] });
    expect((await ctx.verdictRepo.findByRide(bot.ride.id))?.snapshot()).toMatchObject({ status: VerdictStatus.Flagged, rulesVersion: RULES_VERSION });
    expect(ctx.db.adminActions).toHaveLength(1);
    expect(ctx.db.adminActions[0]).toMatchObject({ wallet: 'cli', action: 'verdict.rejudge-bulk', target: 'all', detail: { judged: 2, changed: [{ id: bot.ride.id }] } });
  });

  it('--dry-run only counts; the filters select by verdict and since', async () => {
    const { ctx, run } = setup();
    await judgedRide(ctx, 'a');
    ctx.clock.advance(3600);
    const later = await judgedRide(ctx, 'b', { inputs: 'bot', seconds: 180 }, 180, 2400);
    expect(await run('all', true)).toMatchObject({ dryRun: true, scanned: 2, judged: 0, changed: [] });
    expect(await run('flagged', true)).toMatchObject({ scanned: 1 });
    expect(await run('verified', true)).toMatchObject({ scanned: 1 });
    expect(await run('rejected', true)).toMatchObject({ scanned: 0 });
    expect(await run('all', true, new Date(later.ride.startedAt!.getTime()))).toMatchObject({ scanned: 1 });
    expect(ctx.db.adminActions).toHaveLength(0); // a dry run is not audited
  });

  it("keeps an admin's decision and skips a ride whose recording the retention sweep deleted; a never-judged shift is judged", async () => {
    const { ctx, run } = setup();
    const decided = await judgedRide(ctx, 'a', { inputs: 'bot', seconds: 180 }, 180, 2400);
    await ctx.verdicts.override(decided.ride.id, VerdictStatus.Verified, 'admin', 'looked fine', null);
    const swept = await judgedRide(ctx, 'b');
    for (const key of [...ctx.db.batches.keys()]) if (key.startsWith(swept.ride.id)) ctx.db.batches.delete(key);
    const unjudged = await judgedRide(ctx, 'c');
    ctx.db.verdicts.delete(unjudged.ride.id);
    expect(await run('unjudged', true)).toMatchObject({ scanned: 1 });
    const r = await run('all');
    expect(r).toMatchObject({ scanned: 3, judged: 2, skipped: 1, changed: [{ id: unjudged.ride.id, from: null, to: 'verified' }] });
    expect((await ctx.verdictRepo.findByRide(decided.ride.id))?.status).toBe(VerdictStatus.Verified); // the override stands
    expect((await ctx.verdictRepo.findByRide(swept.ride.id))?.status).toBe(VerdictStatus.Verified); // not turned into 'no-recording'
  });
});
