import { EquipCosmeticHandler } from '../../../../../src/application/use-cases/players/equip-cosmetic/equip-cosmetic.handler.js';
import { EquipCosmeticCommand } from '../../../../../src/application/use-cases/players/equip-cosmetic/equip-cosmetic.command.js';
import { unitContext } from '../../../../support/unit-context.js';

const unlock = (ctx: ReturnType<typeof unitContext>, slot: 'wheel' | 'gearbox', item: string) => ctx.cosmetics.unlock({ wallet: 'w', slot, item, code: 'X', at: ctx.now() });

describe('EquipCosmeticHandler', () => {
  it('wears an owned item and returns the wardrobe; the default can always be put back', async () => {
    const ctx = unitContext(), equip = (slot: 'wheel' | 'gearbox', item: string) => new EquipCosmeticHandler(ctx.cosmetics).execute(new EquipCosmeticCommand('w', slot, item));
    await unlock(ctx, 'wheel', 'sport');
    expect((await equip('wheel', 'sport')).equipped.wheel).toBe('sport');
    expect((await equip('wheel', 'classic')).equipped.wheel).toBe('classic');
  });
  it('refuses what the wallet does not own (409) and what does not exist (400)', async () => {
    const ctx = unitContext(), h = new EquipCosmeticHandler(ctx.cosmetics);
    await expect(h.execute(new EquipCosmeticCommand('w', 'wheel', 'gold'))).rejects.toMatchObject({ errorCode: 'not_owned', statusCode: 409 });
    await expect(h.execute(new EquipCosmeticCommand('w', 'wheel', 'racing'))).rejects.toMatchObject({ errorCode: 'bad_cosmetic', statusCode: 400 });
    expect(await ctx.cosmetics.listEquipped('w')).toEqual({});
  });
});

