import { GetWardrobeHandler } from '../../../../../src/application/use-cases/players/get-wardrobe/get-wardrobe.handler.js';
import { GetWardrobeQuery } from '../../../../../src/application/use-cases/players/get-wardrobe/get-wardrobe.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetWardrobeHandler', () => {
  it('a wallet with nothing wears the classic cabin; unlocking adds, equipping wears', async () => {
    const ctx = unitContext(), get = () => new GetWardrobeHandler(ctx.cosmetics).execute(new GetWardrobeQuery('w'));
    expect((await get()).unlocked.cabin).toEqual(['classic']);
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'cabin', item: 'midnight', code: 'X', at: ctx.now() });
    await ctx.cosmetics.equip('w', 'cabin', 'midnight');
    expect(await get()).toMatchObject({ equipped: { cabin: 'midnight' }, unlocked: { cabin: ['classic', 'midnight'] } });
  });
  it('other wallets\' cabins are not mine', async () => {
    const ctx = unitContext();
    await ctx.cosmetics.unlock({ wallet: 'other', slot: 'cabin', item: 'noir', code: 'X', at: ctx.now() });
    expect((await new GetWardrobeHandler(ctx.cosmetics).execute(new GetWardrobeQuery('w'))).unlocked.cabin).toEqual(['classic']);
  });
});
