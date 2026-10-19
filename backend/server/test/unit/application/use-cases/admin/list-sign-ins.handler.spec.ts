import { ListSignInsHandler } from '../../../../../src/application/use-cases/admin/list-sign-ins/list-sign-ins.handler.js';
import { ListSignInsQuery } from '../../../../../src/application/use-cases/admin/list-sign-ins/list-sign-ins.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListSignInsHandler', () => {
  it('the sign-in log newest first, optionally one wallet\'s, times as epoch ms', async () => {
    const ctx = unitContext();
    await ctx.signIns.insert({ wallet: 'alice', at: ctx.now(), ip: '1.1.1.1', userAgent: 'Safari' });
    ctx.clock.advance(60);
    await ctx.signIns.insert({ wallet: 'bob', at: ctx.now(), ip: null, userAgent: null });
    const h = new ListSignInsHandler(ctx.signIns);
    expect((await h.execute(new ListSignInsQuery(10))).rows).toEqual([
      { wallet: 'bob', at: ctx.clock.ms, ip: null, userAgent: null },
      { wallet: 'alice', at: ctx.clock.ms - 60_000, ip: '1.1.1.1', userAgent: 'Safari' },
    ]);
    expect((await h.execute(new ListSignInsQuery(10, 'alice'))).rows.map((r) => r.wallet)).toEqual(['alice']);
    expect((await h.execute(new ListSignInsQuery(1))).rows).toHaveLength(1);
  });
});
