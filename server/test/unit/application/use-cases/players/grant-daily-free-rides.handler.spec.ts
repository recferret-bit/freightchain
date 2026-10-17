import { GrantDailyFreeRidesHandler } from '../../../../../src/application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.handler.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GrantDailyFreeRidesHandler', () => {
  it('is retired: it grants nobody and does not move a stored balance', async () => {
    const ctx = unitContext();
    const handler = new GrantDailyFreeRidesHandler(ctx.clock);
    for (const w of ['a', 'b', 'c']) await ctx.player(w);
    const before = async (w: string) => (await ctx.storedPlayer(w)).freeRides;
    const start = [await before('a'), await before('b'), await before('c')];
    ctx.clock.advance(86_400);
    expect(await handler.execute()).toEqual({ day: '2036-10-09', players: 0 });
    expect(await handler.execute()).toEqual({ day: '2036-10-09', players: 0 });
    expect([await before('a'), await before('b'), await before('c')]).toEqual(start);
  });
});
