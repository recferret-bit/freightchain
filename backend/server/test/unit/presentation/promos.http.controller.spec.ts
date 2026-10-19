import { PromosHttpController } from '../../../src/presentation/economy/promos.http.controller.js';
import { EquipCosmeticCommand } from '../../../src/application/use-cases/players/equip-cosmetic/equip-cosmetic.command.js';
import { GetMyPromosQuery } from '../../../src/application/use-cases/players/get-my-promos/get-my-promos.query.js';
import { GetWardrobeQuery } from '../../../src/application/use-cases/players/get-wardrobe/get-wardrobe.query.js';
import { equipCosmeticBodySchema } from '../../../src/presentation/economy/dto/promos.dto.js';
import { busMock } from '../../support/bus.js';

describe('PromosHttpController', () => {
  it('mine / wardrobe → their queries, equip → the command, all for the signed-in wallet', async () => {
    const commands = busMock({ equipped: {} }), queries = busMock({ redemptions: [] });
    const c = new PromosHttpController(commands.bus, queries.bus);
    expect(await c.mine({ wallet: 'w' })).toEqual({ redemptions: [] }); expect(queries.last()).toEqual(new GetMyPromosQuery('w'));
    await c.wardrobe({ wallet: 'w' }); expect(queries.last()).toEqual(new GetWardrobeQuery('w'));
    await c.equip({ wallet: 'w' }, equipCosmeticBodySchema.parse({ slot: 'wheel', item: ' gold ' })); expect(commands.last()).toEqual(new EquipCosmeticCommand('w', 'wheel', 'gold'));
  });

  it('equip takes a known slot and a short item', () => {
    expect(equipCosmeticBodySchema.safeParse({ slot: 'truck_color', item: 'blue' }).success).toBe(true);
    for (const bad of [{ slot: 'seat', item: 'x' }, { slot: 'cabin', item: 'noir' }, { slot: 'wheel' }, { slot: 'wheel', item: '' }, { slot: 'wheel', item: 'x'.repeat(33) }, {}]) expect(equipCosmeticBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
