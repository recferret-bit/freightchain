import { GetGarageHandler } from '../../../../../src/application/use-cases/players/get-garage/get-garage.handler.js';
import { GetGarageQuery } from '../../../../../src/application/use-cases/players/get-garage/get-garage.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetGarageHandler', () => {
  it('the catalog with what this wallet owns and wears, and its progress; other wallets\' parts are not mine', async () => {
    const ctx = unitContext(), get = (w = 'w') => new GetGarageHandler(ctx.cosmetics, ctx.honkRepo).execute(new GetGarageQuery(w));
    const fresh = await get();
    expect(fresh.progress).toEqual({ collected: 0, total: 45, percent: 0 });
    expect(fresh.slots[0]?.parts[0]).toMatchObject({ id: 'classic', name: 'Wheel · Classic', description: 'The stock wheel: a black rim, a dark hub, and the amber mark.', price: null });
    expect(fresh.slots[0]?.parts.find((p) => p.id === 'gold')).toMatchObject({ name: 'Wheel · Gold', description: 'A gold sheen ring, gold spokes, and a gold hub.', price: '260' });
    expect(fresh.slots[0]?.parts.find((p) => p.id === 'crimson')).toMatchObject({ description: 'A dark rim with a red sheen ring and a pale mark.', price: '65' });
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'gearbox', item: 'racing', code: 'BOX', at: ctx.now() });
    await ctx.cosmetics.equip('w', 'gearbox', 'racing');
    await ctx.cosmetics.unlock({ wallet: 'other', slot: 'wheel', item: 'gold', code: 'X', at: ctx.now() });
    const g = await get();
    expect(g.progress).toEqual({ collected: 1, total: 45, percent: 2 });
    expect(g.equipped.gearbox).toBe('racing');
    expect(g.slots[2]?.parts.find((p) => p.id === 'racing')).toMatchObject({ owned: true, worn: true, code: 'BOX', unlockedAt: ctx.clock.ms });
    expect(g.slots[0]?.collected).toBe(0);
  });
});
