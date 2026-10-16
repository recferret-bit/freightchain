import { GetGarageHandler } from '../../../../../src/application/use-cases/players/get-garage/get-garage.handler.js';
import { GetGarageQuery } from '../../../../../src/application/use-cases/players/get-garage/get-garage.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetGarageHandler', () => {
  it('the catalog with what this wallet owns and wears, and its progress; other wallets\' parts are not mine', async () => {
    const ctx = unitContext(), get = (w = 'w') => new GetGarageHandler(ctx.cosmetics).execute(new GetGarageQuery(w));
    expect((await get()).progress).toEqual({ collected: 0, total: 28, percent: 0 });
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'gearbox', item: 'racing', code: 'BOX', at: ctx.now() });
    await ctx.cosmetics.equip('w', 'gearbox', 'racing');
    await ctx.cosmetics.unlock({ wallet: 'other', slot: 'wheel', item: 'gold', code: 'X', at: ctx.now() });
    const g = await get();
    expect(g.progress).toEqual({ collected: 1, total: 28, percent: 3 });
    expect(g.equipped.gearbox).toBe('racing');
    expect(g.slots[2]?.parts.find((p) => p.id === 'racing')).toMatchObject({ owned: true, worn: true, code: 'BOX', unlockedAt: ctx.clock.ms });
    expect(g.slots[0]?.collected).toBe(0);
  });
});
