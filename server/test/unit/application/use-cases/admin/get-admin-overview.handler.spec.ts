import { GetAdminOverviewHandler } from '../../../../../src/application/use-cases/admin/get-admin-overview/get-admin-overview.handler.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('GetAdminOverviewHandler', () => {
  it('counts across the app, sign-ins of the last 24 h, and the verified-play switches as set', async () => {
    const ctx = unitContext(unitRules({ verdictEnforce: false, telemetryRetentionDays: 30 }));
    await judgedRide(ctx, 'alice');                     // verified, 6 batches
    await judgedRide(ctx, 'bob', { inputs: 'none' });  // rejected (moved without inputs)
    await ctx.freeRide('carol', true);                   // running
    await ctx.signIns.insert({ wallet: 'alice', at: new Date(ctx.clock.ms - 2 * 86_400_000), ip: null, userAgent: null });
    await ctx.signIns.insert({ wallet: 'bob', at: ctx.now(), ip: '1.1.1.1', userAgent: 'x' });
    const o = await new GetAdminOverviewHandler(ctx.adminQuery, ctx.signIns, ctx.rules, ctx.clock).execute();
    expect(o).toMatchObject({
      now: ctx.clock.ms, players: 3, running: 1, signIns24h: 1, rides: { completed: 2, running: 1 }, verdicts: { verified: 1, rejected: 1 },
      payments: { count: 0, lamports: 0 }, config: { verdictEnforce: false, telemetryRetentionDays: 30 },
    });
    expect(o.telemetry.batches).toBe(8);
    expect(o.telemetry.bytes).toBeGreaterThan(0);
  });
});
