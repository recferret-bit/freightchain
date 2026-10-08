import { GetWardrobeHandler } from '../../../../../src/application/use-cases/players/get-wardrobe/get-wardrobe.handler.js';
import { GetWardrobeQuery } from '../../../../../src/application/use-cases/players/get-wardrobe/get-wardrobe.query.js';
import { unitContext } from '../../../../support/unit-context.js';

const unlock = (ctx: ReturnType<typeof unitContext>, slot: 'wheel' | 'gearbox', item: string) => ctx.cosmetics.unlock({ wallet: 'w', slot, item, code: 'X', at: ctx.now() });

describe('GetWardrobeHandler', () => {
  it('a wallet with nothing wears the defaults; unlocking adds, equipping wears', async () => {
    const ctx = unitContext(), get = () => new GetWardrobeHandler(ctx.cosmetics).execute(new GetWardrobeQuery('w'));
    expect((await get()).unlocked.wheel).toEqual(['classic']);
    await unlock(ctx, 'wheel', 'sport');
    await ctx.cosmetics.equip('w', 'wheel', 'sport');
    expect(await get()).toMatchObject({ equipped: { wheel: 'sport', gearbox: 'stick' }, unlocked: { wheel: ['classic', 'sport'] } });
  });
  it('other wallets\' items are not mine', async () => {
    const ctx = unitContext();
    await ctx.cosmetics.unlock({ wallet: 'other', slot: 'wheel', item: 'gold', code: 'X', at: ctx.now() });
    expect((await new GetWardrobeHandler(ctx.cosmetics).execute(new GetWardrobeQuery('w'))).unlocked.wheel).toEqual(['classic']);
  });
});

