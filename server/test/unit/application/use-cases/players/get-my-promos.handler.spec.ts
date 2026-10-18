import { GetMyPromosHandler } from '../../../../../src/application/use-cases/players/get-my-promos/get-my-promos.handler.js';
import { GetMyPromosQuery } from '../../../../../src/application/use-cases/players/get-my-promos/get-my-promos.query.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPromo } from '../../../../support/promos.js';

describe('GetMyPromosHandler', () => {
  it('the codes this wallet redeemed, newest first, with what they gave and their description', async () => {
    const ctx = unitContext();
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'AAA', description: 'First' }));
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'BBB', effect: { kind: 'free_rides', count: 3 } }));
    await ctx.promos.insertRedemption('AAA', 'w', 1, ctx.now());
    ctx.clock.advance(5);
    await ctx.promos.insertRedemption('BBB', 'w', 1, ctx.now());
    await ctx.promos.insertRedemption('AAA', 'someone', 1, ctx.now());
    const { redemptions, grants } = await new GetMyPromosHandler(ctx.promos).execute(new GetMyPromosQuery('w'));
    expect(grants).toEqual([]);
    expect(redemptions).toEqual([
      { code: 'BBB', label: '3 free rides', description: null, kind: 'free_rides', at: ctx.clock.ms },
      { code: 'AAA', label: '2 × 1h ride tickets', description: 'First', kind: 'tickets', at: ctx.clock.ms - 5000 },
    ]);
  });
});
