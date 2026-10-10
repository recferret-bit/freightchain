import { GetAdminQueueCountHandler } from '../../../../../src/application/use-cases/admin/get-admin-queue-count/get-admin-queue-count.handler.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetAdminQueueCountHandler', () => {
  it('counts only the rides waiting for a decision (flagged), not verified or rejected ones', async () => {
    const ctx = unitContext();
    const h = new GetAdminQueueCountHandler(ctx.adminQuery);
    expect(await h.execute()).toEqual({ flagged: 0, underReview: 0 });
    await judgedRide(ctx, 'alice');                     // verified
    await judgedRide(ctx, 'bob', { inputs: 'none' });  // rejected
    expect(await h.execute()).toEqual({ flagged: 0, underReview: 0 });
    await judgedRide(ctx, 'carol', { inputs: 'bot', seconds: 180 }, 180, 2400);   // a metronome → flagged
    expect(await h.execute()).toEqual({ flagged: 1, underReview: 1 });
  });
});
