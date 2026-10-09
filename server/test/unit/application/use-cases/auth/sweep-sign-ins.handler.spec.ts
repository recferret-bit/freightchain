import { SweepSignInsHandler } from '../../../../../src/application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.handler.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('SweepSignInsHandler', () => {
  it('deletes sign-in rows older than SIGNIN_RETENTION_DAYS, keeps the rest; idempotent', async () => {
    const ctx = unitContext(unitRules({ signInRetentionDays: 30 }));
    await ctx.signIns.insert({ wallet: 'w', at: ctx.now(), ip: '1.1.1.1', userAgent: 'old' });
    ctx.clock.advance(20 * 86_400);
    await ctx.signIns.insert({ wallet: 'w', at: ctx.now(), ip: '2.2.2.2', userAgent: 'recent' });
    ctx.clock.advance(11 * 86_400);
    const handler = new SweepSignInsHandler(ctx.signIns, ctx.rules, ctx.clock);
    expect(await handler.execute()).toEqual({ cutoff: ctx.clock.ms - 30 * 86_400_000, deleted: 1 });
    expect((await ctx.signIns.recent(10)).map((s) => s.userAgent)).toEqual(['recent']);
    expect(await handler.execute()).toMatchObject({ deleted: 0 });
  });

  it('SIGNIN_RETENTION_DAYS=0 keeps everything', async () => {
    const ctx = unitContext(unitRules({ signInRetentionDays: 0 }));
    await ctx.signIns.insert({ wallet: 'w', at: ctx.now(), ip: null, userAgent: null });
    ctx.clock.advance(1000 * 86_400);
    expect(await new SweepSignInsHandler(ctx.signIns, ctx.rules, ctx.clock).execute()).toEqual({ cutoff: null, deleted: 0 });
    expect(await ctx.signIns.recent(10)).toHaveLength(1);
  });
});
