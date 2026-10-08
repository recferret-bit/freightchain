import { EquipCosmeticHandler } from '../../../../../src/application/use-cases/players/equip-cosmetic/equip-cosmetic.handler.js';
import { EquipCosmeticCommand } from '../../../../../src/application/use-cases/players/equip-cosmetic/equip-cosmetic.command.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('EquipCosmeticHandler', () => {
  it('wears an owned item and returns the wardrobe; the default of a slot can always be put back', async () => {
    const ctx = unitContext(), equip = (slot: 'wheel' | 'truck_color', item: string) => new EquipCosmeticHandler(ctx.cosmetics, ctx.players, ctx.transactions, ctx.clock, ctx.analytics).execute(new EquipCosmeticCommand('w', slot, item));
    await ctx.player('w');
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'wheel', item: 'gold', code: 'X', at: ctx.now() });
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'truck_color', item: 'blue', code: 'Y', at: ctx.now() });
    expect((await equip('wheel', 'gold')).equipped).toEqual({ wheel: 'gold', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' });
    expect((await equip('truck_color', 'blue')).equipped).toEqual({ wheel: 'gold', truck_color: 'blue', gearbox: 'stick', dice: 'white', needle: 'orange' });
    expect((await equip('wheel', 'classic')).equipped.wheel).toBe('classic');
  });
  it('tells PostHog what the wallet put on (and sets it on the person); a refused equip tells nothing', async () => {
    const ctx = unitContext(), h = new EquipCosmeticHandler(ctx.cosmetics, ctx.players, ctx.transactions, ctx.clock, ctx.analytics);
    await ctx.player('w');
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'wheel', item: 'gold', code: 'X', at: ctx.now() });
    await h.execute(new EquipCosmeticCommand('w', 'wheel', 'gold'));
    await h.execute(new EquipCosmeticCommand('w', 'wheel', 'classic'));
    await expect(h.execute(new EquipCosmeticCommand('w', 'wheel', 'ivory'))).rejects.toBeDefined();
    expect(ctx.analytics.named('cosmetic_equipped').map((e) => [e.distinctId, e.properties['item'], e.properties['is_default'], e.set])).toEqual([['w', 'gold', false, { wheel: 'gold' }], ['w', 'classic', true, { wheel: 'classic' }]]);
    expect(ctx.analytics.named('cosmetic_equipped')[0]).toMatchObject({ dedupeKey: null, timestamp: ctx.now(), properties: { slot: 'wheel', source: 'server' } });
  });
  it('refuses what the wallet does not own (409) and what does not exist (400); a wallet that never signed in is a 404', async () => {
    const ctx = unitContext(), h = new EquipCosmeticHandler(ctx.cosmetics, ctx.players, ctx.transactions, ctx.clock, ctx.analytics);
    await expect(h.execute(new EquipCosmeticCommand('ghost', 'wheel', 'classic'))).rejects.toMatchObject({ statusCode: 404 });
    await ctx.player('w');
    await expect(h.execute(new EquipCosmeticCommand('w', 'wheel', 'gold'))).rejects.toMatchObject({ errorCode: 'not_owned', statusCode: 409 });
    await expect(h.execute(new EquipCosmeticCommand('w', 'wheel', 'racing'))).rejects.toMatchObject({ errorCode: 'bad_cosmetic', statusCode: 400 });
    expect(await ctx.cosmetics.listEquipped('w')).toEqual({});
  });
});
