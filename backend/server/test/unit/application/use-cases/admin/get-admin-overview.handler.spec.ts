import { COUNTS_TTL_SECONDS, GetAdminOverviewHandler } from '../../../../../src/application/use-cases/admin/get-admin-overview/get-admin-overview.handler.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('GetAdminOverviewHandler', () => {
  it('counts across the app, sign-ins of the last 24 h, and the verified-play switches as set', async () => {
    const ctx = unitContext(unitRules({ verdictEnforce: false, telemetryRetentionDays: 30 }));
    await judgedRide(ctx, 'alice');                     // verified, 6 batches
    await judgedRide(ctx, 'bob', { inputs: 'none' });  // rejected (moved without inputs)
    await ctx.freeRide('carol', true);                   // running
    await ctx.signIns.insert({ wallet: 'alice', at: new Date(ctx.clock.ms - 2 * 86_400_000), ipHash: null });
    await ctx.signIns.insert({ wallet: 'bob', at: ctx.now(), ipHash: '1.1.1.1' });
    const o = await new GetAdminOverviewHandler(ctx.adminQuery, ctx.signIns, ctx.rules, ctx.clock, ctx.cache).execute();
    expect(o).toMatchObject({
      now: ctx.clock.ms, players: 3, running: 1, signIns24h: 1, rides: { completed: 2, running: 1 }, verdicts: { verified: 1, rejected: 1 }, underReview: 0,   // free rides: only a flagged one would wait for review
      payments: { count: 0, lamports: 0 }, config: { verdictEnforce: false, telemetryRetentionDays: 30 },
    });
    expect(o.telemetry.batches).toBe(8);
    expect(o.telemetry.bytes).toBeGreaterThan(0);
  });

  it('the table-scanning counts are cached for 15 s (a second open does not scan again); sign-ins stay live', async () => {
    const ctx = unitContext();
    await ctx.player('alice');
    let scans = 0;
    const counting = Object.create(ctx.adminQuery, { counts: { value: () => { scans++; return ctx.adminQuery.counts(); } } });
    const h = new GetAdminOverviewHandler(counting, ctx.signIns, ctx.rules, ctx.clock, ctx.cache);
    expect((await h.execute()).players).toBe(1);
    await ctx.player('bob');
    await ctx.signIns.insert({ wallet: 'bob', at: ctx.now(), ipHash: null });
    const again = await h.execute();
    expect([scans, again.players, again.signIns24h]).toEqual([1, 1, 1]);
    ctx.clock.advance(COUNTS_TTL_SECONDS + 1);
    expect([(await h.execute()).players, scans]).toEqual([2, 2]);
    // the review-queue number is never the cached one: a decision shows at once
    await judgedRide(ctx, 'carol', { inputs: 'bot', seconds: 180 }, 180, 2400);
    const stale = Object.create(ctx.adminQuery, { counts: { value: async () => ({ ...(await ctx.adminQuery.counts()), verdicts: {} }) } });
    expect((await new GetAdminOverviewHandler(stale, ctx.signIns, ctx.rules, ctx.clock, ctx.cache).execute()).verdicts.flagged).toBe(1);
  });
});
