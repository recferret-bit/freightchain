import { GarageHttpController } from '../../../src/presentation/economy/garage.http.controller.js';
import { GetGarageQuery } from '../../../src/application/use-cases/players/get-garage/get-garage.query.js';
import { SaveGarageCommand } from '../../../src/application/use-cases/players/save-garage/save-garage.command.js';
import { saveGarageBodySchema } from '../../../src/presentation/economy/dto/garage.dto.js';
import { busMock } from '../../support/bus.js';

describe('GarageHttpController', () => {
  it('GET → the query, POST loadout → the command, both for the signed-in wallet', async () => {
    const commands = busMock({ equipped: {} }), queries = busMock({ slots: [] });
    const c = new GarageHttpController(commands.bus, queries.bus);
    expect(await c.garage({ wallet: 'w' })).toEqual({ slots: [] }); expect(queries.last()).toEqual(new GetGarageQuery('w'));
    await c.save({ wallet: 'w' }, saveGarageBodySchema.parse({ loadout: { wheel: ' gold ', needle: 'lime' } }));
    expect(commands.last()).toEqual(new SaveGarageCommand('w', { wheel: 'gold', needle: 'lime' }));
  });

  it('the body is a loadout of known slots with short part ids – nothing else', () => {
    expect(saveGarageBodySchema.safeParse({ loadout: {} }).success).toBe(true); // the handler says "pick at least one"
    expect(saveGarageBodySchema.safeParse({ loadout: { dice: 'pink', truck_color: 'blue', gearbox: 'chrome', wheel: 'ivory', needle: 'cyan' } }).success).toBe(true);
    for (const bad of [{}, { loadout: { seat: 'x' } }, { loadout: { wheel: '' } }, { loadout: { wheel: 'x'.repeat(33) } }, { loadout: { wheel: 5 } }, { loadout: 'gold' }, { wheel: 'gold' }]) {
      expect(saveGarageBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
