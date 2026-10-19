import { ListAdminReplaysHandler } from '../../../../../src/application/use-cases/admin/list-admin-replays/list-admin-replays.handler.js';
import { ListAdminReplaysQuery } from '../../../../../src/application/use-cases/admin/list-admin-replays/list-admin-replays.query.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListAdminReplaysHandler', () => {
  it('lists recent replay verification sessions with status and paid filters, plus the queue depth and kind', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    await ctx.replayQueue.enqueue({ rideId: 'queued-ride', replayId: 'queued-replay', isPaid: true, enqueuedAt: 1000 });
    const handler = new ListAdminReplaysHandler(ctx.replayRepo, ctx.replayQueue);

    const all = await handler.execute(new ListAdminReplaysQuery({ limit: 50 }));
    expect(all.queue).toEqual({ kind: 'memory', depth: 1 });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]?.rideId).toBe(ride.id);
    expect(all.rows[0]?.isPaid).toBe(false);

    const paidOnly = await handler.execute(new ListAdminReplaysQuery({ isPaid: true, limit: 50 }));
    expect(paidOnly.rows).toEqual([]);

    const freeOnly = await handler.execute(new ListAdminReplaysQuery({ isPaid: false, limit: 50 }));
    expect(freeOnly.rows).toHaveLength(1);
  });
});
