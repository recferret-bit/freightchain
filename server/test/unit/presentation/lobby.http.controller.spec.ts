import { LobbyHttpController } from '../../../src/presentation/lobby/lobby.http.controller.js';
import { GetLiveQuery } from '../../../src/application/use-cases/lobby/get-live/get-live.query.js';
import { GetProfileQuery } from '../../../src/application/use-cases/lobby/get-profile/get-profile.query.js';
import { busMock } from '../../support/bus.js';

describe('LobbyHttpController', () => {
  it('live → GetLiveQuery; profile → GetProfileQuery(the signed-in wallet)', async () => {
    const queries = busMock({ rides: [] });
    const c = new LobbyHttpController(queries.bus);
    expect(await c.live()).toEqual({ rides: [] }); expect(queries.last()).toBeInstanceOf(GetLiveQuery);
    await c.profile({ wallet: 'W' }); expect(queries.last()).toEqual(new GetProfileQuery('W'));
  });
});
