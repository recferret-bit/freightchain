import { ListAdminSessionsHandler, SESSIONS_LIMIT } from '../../../../../src/application/use-cases/admin/list-admin-sessions/list-admin-sessions.handler.js';
import { ListAdminSessionsQuery } from '../../../../../src/application/use-cases/admin/list-admin-sessions/list-admin-sessions.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListAdminSessionsHandler', () => {
  it('one row per wallet that signed in inside the window: newest sign-in, how many, from where; older ones are out', async () => {
    const ctx = unitContext();
    const DAY = 86_400;
    await ctx.signIns.insert({ wallet: 'old', at: ctx.now(), ip: '9.9.9.9', userAgent: null });
    ctx.clock.advance(8 * DAY);
    await ctx.signIns.insert({ wallet: 'alice', at: ctx.now(), ip: '1.1.1.1', userAgent: 'Safari' });
    ctx.clock.advance(60);
    await ctx.signIns.insert({ wallet: 'bob', at: ctx.now(), ip: null, userAgent: null });
    ctx.clock.advance(60);
    await ctx.signIns.insert({ wallet: 'alice', at: ctx.now(), ip: '2.2.2.2', userAgent: 'Chrome' });
    const h = new ListAdminSessionsHandler(ctx.adminDirectory, ctx.clock);
    const week = await h.execute(new ListAdminSessionsQuery(7));
    expect(week.truncated).toBe(false);
    expect(week.rows).toEqual([
      { wallet: 'alice', lastAt: ctx.clock.ms, signIns: 2, ip: '2.2.2.2', userAgent: 'Chrome' },
      { wallet: 'bob', lastAt: ctx.clock.ms - 60_000, signIns: 1, ip: null, userAgent: null },
    ]);
    expect((await h.execute(new ListAdminSessionsQuery(30))).rows.map((r) => r.wallet)).toEqual(['alice', 'bob', 'old']);
  });

  it('a sign-in exactly `days` old is still inside the window; one second older is out', async () => {
    const ctx = unitContext();
    await ctx.signIns.insert({ wallet: 'past', at: new Date(ctx.clock.ms - 7 * 86_400_000 - 1000), ip: null, userAgent: null });
    await ctx.signIns.insert({ wallet: 'edge', at: new Date(ctx.clock.ms - 7 * 86_400_000), ip: null, userAgent: null });
    expect((await new ListAdminSessionsHandler(ctx.adminDirectory, ctx.clock).execute(new ListAdminSessionsQuery(7))).rows.map((r) => r.wallet)).toEqual(['edge']);
  });

  it('says so when more wallets signed in than one answer lists (the oldest are left out)', async () => {
    const ctx = unitContext();
    for (let i = 0; i < SESSIONS_LIMIT; i++) { await ctx.signIns.insert({ wallet: `w${i}`, at: ctx.now(), ip: null, userAgent: null }); ctx.clock.advance(1); }
    const h = new ListAdminSessionsHandler(ctx.adminDirectory, ctx.clock);
    const d = await h.execute(new ListAdminSessionsQuery(7));
    expect(d.truncated).toBe(false);
    expect(d.rows).toHaveLength(SESSIONS_LIMIT);
    await ctx.signIns.insert({ wallet: 'one-more', at: ctx.now(), ip: null, userAgent: null });
    const more = await h.execute(new ListAdminSessionsQuery(7));
    expect(more.truncated).toBe(true);
    expect(more.rows).toHaveLength(SESSIONS_LIMIT);
    expect(more.rows[0]!.wallet).toBe('one-more');
    expect(more.rows.some((r) => r.wallet === 'w0')).toBe(false);
  });
});
