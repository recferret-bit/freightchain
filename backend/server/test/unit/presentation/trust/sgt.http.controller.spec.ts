import { SgtHttpController } from '../../../../src/presentation/trust/sgt.http.controller.js';
import { GetSgtQuery, VerifySgtCommand } from '../../../../src/application/trust/sgt.handler.js';
import { busMock } from '../../../support/bus.js';
it('dispatches only the authenticated wallet for both status and verification', async () => {
  const commands = busMock({}), queries = busMock({}), controller = new SgtHttpController(commands.bus, queries.bus);
  await controller.status({ wallet: 'signed-wallet' }); expect(queries.last()).toEqual(new GetSgtQuery('signed-wallet'));
  await controller.verify({ wallet: 'signed-wallet' }, {}); expect(commands.last()).toEqual(new VerifySgtCommand('signed-wallet'));
});
