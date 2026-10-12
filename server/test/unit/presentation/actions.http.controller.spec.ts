import { ActionsHttpController } from '../../../src/presentation/actions/actions.http.controller.js';
import { actionAccountBodySchema, actionSiteParamsSchema, actionTierParamsSchema, actionTierQuerySchema } from '../../../src/presentation/actions/action.dto.js';
import { GetActionsJsonQuery } from '../../../src/application/use-cases/actions/get-actions-json.query.js';
import { GetRideActionQuery } from '../../../src/application/use-cases/actions/get-ride-action.query.js';
import { OpenRideActionCommand } from '../../../src/application/use-cases/actions/open-ride-action.command.js';
import { OpenSiteActionCommand } from '../../../src/application/use-cases/actions/open-site-action.command.js';
import { GetShiftActionQuery } from '../../../src/application/use-cases/actions/get-shift-action.query.js';
import { PrepareShiftActionCommand } from '../../../src/application/use-cases/actions/prepare-shift-action.command.js';
import { busMock } from '../../support/bus.js';

const ACCOUNT = '4GzacGtTe67wnkpJBs7pngcRfsFckbHvzmAUNL6Jchmz';

describe('ActionsHttpController', () => {
  it('discovery and cards go to queries; a buy and a ride open go to commands', async () => {
    const commands = busMock({ type: 'transaction' }), queries = busMock({ type: 'action' });
    const c = new ActionsHttpController(commands.bus, queries.bus);
    await c.json(); expect(queries.last()).toEqual(new GetActionsJsonQuery());
    await c.shift(); expect(queries.last()).toEqual(new GetShiftActionQuery(null));
    await c.shiftTier({ tier: '4h' }); expect(queries.last()).toEqual(new GetShiftActionQuery('4h'));
    await c.buyQuery({ tier: '1h' }, { account: ACCOUNT }); expect(commands.last()).toEqual(new PrepareShiftActionCommand(ACCOUNT, '1h'));
    await c.buyPath({ tier: '8h' }, { account: ACCOUNT }); expect(commands.last()).toEqual(new PrepareShiftActionCommand(ACCOUNT, '8h'));
    await c.ride({ id: 'r' }); expect(queries.last()).toEqual(new GetRideActionQuery('r'));
    await c.ridePost({ id: 'r' }, { account: ACCOUNT }); expect(commands.last()).toEqual(new OpenRideActionCommand('r', ACCOUNT));
    await c.rideWatch({ id: 'r' }, { account: ACCOUNT }); expect(commands.last()).toEqual(new OpenRideActionCommand('r', ACCOUNT, 'watch'));
    await c.site({ to: 'live' }, { account: ACCOUNT }); expect(commands.last()).toEqual(new OpenSiteActionCommand('live', ACCOUNT));
  });

  it('tier and account are validated; quantity is not a field', () => {
    expect(actionTierParamsSchema.safeParse({ tier: '1h' }).success).toBe(true);
    expect(actionTierQuerySchema.safeParse({ tier: '9h' }).success).toBe(false);
    expect(actionSiteParamsSchema.safeParse({ to: 'home' }).success).toBe(true);
    expect(actionSiteParamsSchema.safeParse({ to: 'evil.example' }).success).toBe(false);
    expect(actionAccountBodySchema.safeParse({ account: ACCOUNT, type: 'transaction', data: { qty: '100' } }).success).toBe(true);
    expect(actionAccountBodySchema.safeParse({ account: 'nope' }).success).toBe(false);
    expect(actionAccountBodySchema.safeParse({ account: ACCOUNT, qty: 100 }).success).toBe(true); // stripped, never read
  });
});
