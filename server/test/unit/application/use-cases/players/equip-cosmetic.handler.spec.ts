import { EquipCosmeticHandler } from '../../../../../src/application/use-cases/players/equip-cosmetic/equip-cosmetic.handler.js';
import { EquipCosmeticCommand } from '../../../../../src/application/use-cases/players/equip-cosmetic/equip-cosmetic.command.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('EquipCosmeticHandler', () => {
  it('wears an owned cabin and returns the wardrobe; the classic one can always be put back', async () => {
    const ctx = unitContext(), equip = (item: string) => new EquipCosmeticHandler(ctx.cosmetics).execute(new EquipCosmeticCommand('w', 'cabin', item));
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'cabin', item: 'midnight', code: 'X', at: ctx.now() });
    expect((await equip('midnight')).equipped.cabin).toBe('midnight');
    expect((await equip('classic')).equipped.cabin).toBe('classic');
  });
  it('refuses what the wallet does not own (409) and what does not exist (400)', async () => {
    const ctx = unitContext(), h = new EquipCosmeticHandler(ctx.cosmetics);
    await expect(h.execute(new EquipCosmeticCommand('w', 'cabin', 'noir'))).rejects.toMatchObject({ errorCode: 'not_owned', statusCode: 409 });
    await expect(h.execute(new EquipCosmeticCommand('w', 'cabin', 'racing'))).rejects.toMatchObject({ errorCode: 'bad_cosmetic', statusCode: 400 });
    expect(await ctx.cosmetics.listEquipped('w')).toEqual({});
  });
});
