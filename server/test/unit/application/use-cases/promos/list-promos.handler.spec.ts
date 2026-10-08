import { ListPromosHandler } from '../../../../../src/application/use-cases/promos/list-promos/list-promos.handler.js';
import { ListPromosQuery } from '../../../../../src/application/use-cases/promos/list-promos/list-promos.query.js';
import type { PromoState } from '../../../../../src/domain/economy/promo.types.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPromo } from '../../../../support/promos.js';

const HOUR = 3_600_000;

describe('ListPromosHandler', () => {
  const setup = async () => {
    const ctx = unitContext();
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'FIRST', maxRedemptions: null }));
    ctx.clock.advance(60);
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'SECOND', maxRedemptions: null, effect: { kind: 'free_rides', count: 3 } }));
    return { ctx, handler: new ListPromosHandler(ctx.promos, ctx.clock) };
  };

  it('every code, newest first, with its usage and what it gives', async () => {
    const { handler } = await setup();
    const { promos } = await handler.execute(new ListPromosQuery());
    expect(promos.map((p) => [p.code, p.redeemed, p.state, p.label])).toEqual([['SECOND', 0, 'active', '3 free rides'], ['FIRST', 0, 'active', '2 × 1h ride tickets']]);
  });

  it('narrows by state: active now, scheduled, ended, exhausted, disabled', async () => {
    const { ctx, handler } = await setup();
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'LATER', startsAt: new Date(ctx.clock.ms + HOUR) }));
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'SHORT', expiresAt: new Date(ctx.clock.ms + 1000) }));
    await ctx.promos.insert(aPromo(ctx.now(), { code: 'ONE', maxRedemptions: 1 }));
    await ctx.promos.takeRedemption('ONE', ctx.now());
    await ctx.promos.disable('FIRST', ctx.now());
    ctx.clock.advance(2);
    const codes = async (state: PromoState) => (await handler.execute(new ListPromosQuery(state))).promos.map((p) => p.code).sort();
    expect(await codes('active')).toEqual(['SECOND']);
    expect(await codes('scheduled')).toEqual(['LATER']);
    expect(await codes('ended')).toEqual(['SHORT']);
    expect(await codes('exhausted')).toEqual(['ONE']);
    expect(await codes('disabled')).toEqual(['FIRST']);
  });
});
