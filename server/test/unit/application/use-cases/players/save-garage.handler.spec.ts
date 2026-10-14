import { SaveGarageHandler } from '../../../../../src/application/use-cases/players/save-garage/save-garage.handler.js';
import { SaveGarageCommand } from '../../../../../src/application/use-cases/players/save-garage/save-garage.command.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = async () => {
  const ctx = unitContext();
  await ctx.player('w'); await ctx.player('thief');
  for (const [slot, item] of [['wheel', 'gold'], ['dice', 'pink'], ['needle', 'lime']] as const) await ctx.cosmetics.unlock({ wallet: 'w', slot, item, code: item.toUpperCase(), at: ctx.now() });
  const handler = new SaveGarageHandler(ctx.cosmetics, ctx.players, ctx.transactions, ctx.clock, ctx.analytics, ctx.honkRepo);
  return { ctx, save: (parts: ConstructorParameters<typeof SaveGarageCommand>[1], wallet = 'w') => handler.execute(new SaveGarageCommand(wallet, parts)) };
};

describe('SaveGarageHandler', () => {
  it('stores the picked parts together, leaves the other slots as they were and answers the garage', async () => {
    const { ctx, save } = await setup();
    await ctx.cosmetics.equip('w', 'needle', 'lime');
    const g = await save({ wheel: 'gold', dice: 'pink' });
    expect(g.equipped).toEqual({ wheel: 'gold', truck_color: 'red', gearbox: 'stick', dice: 'pink', needle: 'lime' });
    expect(g.slots[0]?.parts.find((p) => p.id === 'gold')).toMatchObject({ name: 'Wheel · Gold', description: 'A gold sheen ring, gold spokes, and a gold hub.', price: '260' });
    expect(g.slots[0]?.parts.find((p) => p.id === 'classic')).toMatchObject({ name: 'Wheel · Classic', description: 'The stock wheel: a black rim, a dark hub, and the amber mark.', price: null });
    expect(g.slots[3]?.parts.find((p) => p.id === 'pink')).toMatchObject({ name: 'Dice · Pink', description: 'Pink dice with white pips.', price: '65' });
    expect(await ctx.cosmetics.listEquipped('w')).toEqual({ wheel: 'gold', dice: 'pink', needle: 'lime' });
    expect(g.progress.collected).toBe(3);
  });

  it('the default of a slot can always be put back; saving the same thing twice is fine', async () => {
    const { save } = await setup();
    await save({ wheel: 'gold' });
    expect((await save({ wheel: 'classic' })).equipped.wheel).toBe('classic');
    expect((await save({ wheel: 'classic' })).equipped.wheel).toBe('classic');
  });

  it('all or nothing: one part that is not owned refuses the save (409) and none of the others is written', async () => {
    const { ctx, save } = await setup();
    await expect(save({ wheel: 'gold', gearbox: 'racing' })).rejects.toMatchObject({ errorCode: 'not_owned', statusCode: 409 });
    expect(await ctx.cosmetics.listEquipped('w')).toEqual({});
    expect(ctx.analytics.named('garage_saved')).toEqual([]);
  });

  it('what does not exist is a 400 (an unknown item, or nothing picked)', async () => {
    const { ctx, save } = await setup();
    await expect(save({ wheel: 'racing' })).rejects.toMatchObject({ errorCode: 'bad_cosmetic', statusCode: 400 });
    await expect(save({})).rejects.toMatchObject({ errorCode: 'bad_cosmetic', statusCode: 400 });
    expect(await ctx.cosmetics.listEquipped('w')).toEqual({});
  });

  it('a wallet that never signed in is a 404', async () => {
    const { save } = await setup();
    await expect(save({ wheel: 'classic' }, 'ghost')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('another wallet cannot wear this wallet\'s parts', async () => {
    const { save } = await setup();
    await expect(save({ wheel: 'gold' }, 'thief')).rejects.toMatchObject({ errorCode: 'not_owned' });
  });

  it('tells PostHog once per save: the whole loadout now worn, how many parts were saved, set on the person', async () => {
    const { ctx, save } = await setup();
    await save({ wheel: 'gold', dice: 'pink' });
    expect(ctx.analytics.named('garage_saved')).toMatchObject([{
      distinctId: 'w', dedupeKey: null, timestamp: ctx.now(), set: { wheel: 'gold', dice: 'pink', truck_color: 'red', gearbox: 'stick', needle: 'orange' },
      properties: { wheel: 'gold', dice: 'pink', parts_saved: 2, source: 'server' },
    }]);
    ctx.analytics.throwOnCapture = true;
    expect((await save({ needle: 'lime' })).equipped.needle).toBe('lime'); // a broken adapter never changes the answer
  });
});
