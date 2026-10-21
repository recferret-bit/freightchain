import { GetMyDonationsQuery } from '../../../src/application/live/get-my-donations.query.js';
import { MeController } from '../../../src/presentation/player/me.controller.js';
import { busMock } from '../../support/bus.js';

describe('MeController', () => {
  it('asks the bus for the signed-in wallet\'s tips', async () => {
    const body = { sent: [], received: [], totals: { sentLamports: 0, receivedLamports: 0 } };
    const queries = busMock(body);
    const controller = new MeController(queries.bus);
    expect(await controller.donations({ wallet: 'w' })).toEqual(body);
    expect(queries.last()).toEqual(new GetMyDonationsQuery('w'));
  });
});
