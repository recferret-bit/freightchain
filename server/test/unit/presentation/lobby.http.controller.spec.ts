import { LobbyHttpController } from '../../../src/presentation/lobby/lobby.http.controller.js';
import { GetLiveQuery } from '../../../src/application/use-cases/lobby/get-live/get-live.query.js';
import { GetProfileQuery } from '../../../src/application/use-cases/lobby/get-profile/get-profile.query.js';
import { GetReplaysQuery } from '../../../src/application/use-cases/lobby/get-replays/get-replays.query.js';
import { busMock } from '../../support/bus.js';

describe('LobbyHttpController', () => {
  it('live → GetLiveQuery(visitor, page, client IP, optional wallet); profile → GetProfileQuery(the signed-in wallet)', async () => {
    const queries = busMock({ rides: [] });
    const c = new LobbyHttpController(queries.bus);
    expect(await c.live({ visitor: 'v-12345678', page: 'lobby' }, { ip: '10.0.0.1', userAgent: null }, 'W')).toEqual({ rides: [] });
    expect(queries.last()).toEqual(new GetLiveQuery('v-12345678', 'lobby', '10.0.0.1', 'W'));
    await c.profile({ wallet: 'W' }); expect(queries.last()).toEqual(new GetProfileQuery('W'));
    await c.replays({ before: null, limit: 20, wallet: null, status: 'failed' }); expect(queries.last()).toEqual(new GetReplaysQuery(null, 20, null, 'failed'));
  });
});
