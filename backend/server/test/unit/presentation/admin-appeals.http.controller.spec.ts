import { AdminAppealsHttpController } from '../../../src/presentation/admin/admin-appeals.http.controller.js';
import { ListRideAppealsQuery, ResolveRideAppealCommand } from '../../../src/application/use-cases/rides/ride-appeal/ride-appeal.command.js';
import { RequestActionChallengeCommand } from '../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { busMock } from '../../support/bus.js';

describe('AdminAppealsHttpController', () => {
  it('lists, challenges and resolves through the bus', async () => {
    const commands = busMock({ id: 'a', status: 'denied' }), queries = busMock({ appeals: [] });
    const c = new AdminAppealsHttpController(commands.bus, queries.bus);
    await c.list({});
    expect(queries.last()).toEqual(new ListRideAppealsQuery(undefined));
    await c.challenge({ wallet: 'Admin' }, { id: 'ap1' }, { decision: 'upheld', note: 'ok' });
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('Admin', { action: 'appeal_resolve', appealId: 'ap1', decision: 'upheld', note: 'ok' }));
    await c.resolve({ wallet: 'Admin' }, { id: 'ap1' }, { decision: 'denied', note: null, signature: 'sig' });
    expect(commands.last()).toEqual(new ResolveRideAppealCommand('Admin', 'ap1', 'denied', null, 'sig'));
  });
});
