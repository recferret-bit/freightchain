import { GetWardrobeHandler } from '../../../../../src/application/use-cases/players/get-wardrobe/get-wardrobe.handler.js';
import { GetWardrobeQuery } from '../../../../../src/application/use-cases/players/get-wardrobe/get-wardrobe.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetWardrobeHandler', () => {
  it('a wallet with nothing wears the classics; unlocking adds, equipping wears', async () => {
    const ctx = unitContext(), get = () => new GetWardrobeHandler(ctx.cosmetics).execute(new GetWardrobeQuery('w'));
    expect((await get()).unlocked.wheel).toEqual(['classic']);
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'wheel', item: 'gold', code: 'X', at: ctx.now() });
    await ctx.cosmetics.equip('w', 'wheel', 'gold');
    expect(await get()).toMatchObject({ equipped: { wheel: 'gold', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' }, unlocked: { wheel: ['classic', 'gold'] } });
  });
  it('other wallets\' items are not mine', async () => {
    const ctx = unitContext();
    await ctx.cosmetics.unlock({ wallet: 'other', slot: 'gearbox', item: 'racing', code: 'X', at: ctx.now() });
    expect((await new GetWardrobeHandler(ctx.cosmetics).execute(new GetWardrobeQuery('w'))).unlocked.gearbox).toEqual(['stick']);
  });
});
