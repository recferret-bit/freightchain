import { ListAdminRidesHandler } from '../../../../../src/application/use-cases/admin/list-admin-rides/list-admin-rides.handler.js';
import { ListAdminRidesQuery } from '../../../../../src/application/use-cases/admin/list-admin-rides/list-admin-rides.query.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListAdminRidesHandler', () => {
  it('lists any rider\'s rides newest first, filtered by verdict (flagged = the review queue, none = unjudged), wallet and status', async () => {
    const ctx = unitContext();
    const ok = await judgedRide(ctx, 'alice');
    const bot = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    const running = await ctx.freeRide('carol', true);
    const list = (filter: Parameters<typeof ctx.adminQuery.rides>[0]) => new ListAdminRidesHandler(ctx.adminQuery).execute(new ListAdminRidesQuery(filter)).then((r) => r.rows);
    expect((await list({ limit: 10 })).map((r) => r.id)).toEqual([running.id, bot.ride.id, ok.ride.id]);
    const queue = await list({ limit: 10, verdict: 'flagged' });
    expect(queue).toEqual([expect.objectContaining({ id: bot.ride.id, wallet: 'bob', status: 'completed', verdict: 'flagged', overridden: false, distance: 2400, driveSeconds: 180 })]);
    expect((await list({ limit: 10, verdict: 'none' })).map((r) => r.id)).toEqual([running.id]);
    expect((await list({ limit: 10, wallet: 'alice' })).map((r) => r.verdict)).toEqual(['verified']);
    expect((await list({ limit: 10, status: 'running' })).map((r) => r.wallet)).toEqual(['carol']);
    expect(await list({ limit: 1 })).toHaveLength(1);
  });
});
