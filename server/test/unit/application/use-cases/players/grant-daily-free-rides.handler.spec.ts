import { GrantDailyFreeRidesHandler } from '../../../../../src/application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.handler.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GrantDailyFreeRidesHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const analytics = new RecordingAnalytics();
    return { ctx, analytics, handler: new GrantDailyFreeRidesHandler(ctx.players, ctx.clock, analytics) };
  };
  const spend = async (ctx: ReturnType<typeof unitContext>, wallet: string, times: number) => {
    const p = await ctx.storedPlayer(wallet);
    for (let i = 0; i < times; i++) p.spendFreeRide();
    await ctx.players.save(p);
  };

  it('gives every player below the cap +1 at the new UTC day, and stops at the cap', async () => {
    const { ctx, analytics, handler } = setup();
    for (const w of ['a', 'b', 'c']) await ctx.player(w);
    await spend(ctx, 'a', 3); // 2
    await spend(ctx, 'b', 1); // 4
    ctx.clock.advance(86_400);
    const out = await handler.execute();
    expect(out).toEqual({ day: '2036-10-09', players: 3 });
    expect(analytics.named('free_rides_granted')).toHaveLength(1);
    expect(analytics.named('free_rides_granted')[0]).toMatchObject({ distinctId: 'freightchain', properties: { day: '2036-10-09', players: 3 } });
    expect([await ctx.storedPlayer('a'), await ctx.storedPlayer('b'), await ctx.storedPlayer('c')].map((p) => p.freeRides)).toEqual([3, 5, 5]);
  });

  it('is idempotent within a day and later lazy touches do not add a second credit', async () => {
    const { ctx, analytics, handler } = setup();
    await ctx.player('a');
    await spend(ctx, 'a', 2); // 3
    ctx.clock.advance(86_400);
    await handler.execute();
    expect(await handler.execute()).toMatchObject({ players: 0 });
    expect(analytics.named('free_rides_granted')).toHaveLength(1);
    expect((await ctx.sessions.touch('a')).freeRides).toBe(4);
  });

  it('a missed night still gives ONE credit (no backlog)', async () => {
    const { ctx, handler } = setup();
    await ctx.player('a');
    await spend(ctx, 'a', 4); // 1
    ctx.clock.advance(5 * 86_400);
    await handler.execute();
    expect((await ctx.storedPlayer('a')).freeRides).toBe(2);
  });

  it('respects a per-player cap and leaves an over-cap balance alone', async () => {
    const { ctx, handler } = setup();
    await ctx.player('a');
    await ctx.player('b');
    const row = (w: string) => ctx.db.players.get(w) as NonNullable<ReturnType<typeof ctx.db.players.get>>;
    ctx.db.players.set('a', { ...row('a'), freeRidesMax: 7 });
    ctx.db.players.set('b', { ...row('b'), freeRides: 9 });
    ctx.clock.advance(86_400);
    await handler.execute();
    expect((await ctx.storedPlayer('a')).freeRides).toBe(6);
    expect((await ctx.storedPlayer('b')).freeRides).toBe(9);
  });
});
