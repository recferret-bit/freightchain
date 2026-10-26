import { GetTermsQuery } from '../../../src/application/use-cases/players/terms/get-terms.query.js';
import { AcceptTermsCommand } from '../../../src/application/use-cases/players/terms/accept-terms.command.js';
import { LobbyHttpController } from '../../../src/presentation/lobby/lobby.http.controller.js';
import { GetLiveQuery } from '../../../src/application/use-cases/lobby/get-live/get-live.query.js';
import { GetProfileQuery } from '../../../src/application/use-cases/lobby/get-profile/get-profile.query.js';
import { GetReplaysQuery } from '../../../src/application/use-cases/lobby/get-replays/get-replays.query.js';
import { AcceptAgreementsCommand } from '../../../src/application/use-cases/players/accept-agreements/accept-agreements.command.js';
import { busMock } from '../../support/bus.js';

describe('LobbyHttpController', () => {
  it('live → GetLiveQuery(visitor, page, client IP, optional wallet); profile → GetProfileQuery(the signed-in wallet)', async () => {
    const queries = busMock({ rides: [] });
    const commands = busMock({ age18: true, loss: false, age18At: 1, lossAt: null });
    const c = new LobbyHttpController(queries.bus, commands.bus);
    expect(await c.live({ visitor: 'v-12345678', page: 'lobby', leave: false }, { ip: '10.0.0.1', userAgent: null }, 'W')).toEqual({ rides: [] });
    expect(queries.last()).toEqual(new GetLiveQuery('v-12345678', 'lobby', '10.0.0.1', 'W', false));
    await c.terms({ wallet: 'W' }); expect(queries.last()).toEqual(new GetTermsQuery('W'));
    await c.acceptTerms({ wallet: 'W' }, { termsVersion: 1, privacyVersion: 1, age18: true, accepted: true }); expect(commands.last()).toEqual(new AcceptTermsCommand('W', 1, 1));
    await c.profile({ wallet: 'W' }); expect(queries.last()).toEqual(new GetProfileQuery('W'));
    await c.replays({ before: null, limit: 20, wallet: null, status: 'failed' }, null); expect(queries.last()).toEqual(new GetReplaysQuery(null, 20, null, 'failed'));
    expect(await c.agreements({ wallet: 'W' }, { age18: true, loss: false })).toEqual({ age18: true, loss: false, age18At: 1, lossAt: null });
    expect(commands.last()).toEqual(new AcceptAgreementsCommand('W', true, false));
  });
});
