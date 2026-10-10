import { ListAdminRidesHandler } from '../../../../../src/application/use-cases/admin/list-admin-rides/list-admin-rides.handler.js';
import { ListAdminRidesQuery } from '../../../../../src/application/use-cases/admin/list-admin-rides/list-admin-rides.query.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';

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

  it('the review queue (review=under_review): every completed PAID ride under review – flagged, machine-rejected, unjudged – first, then the flagged free rides; a pool filter', async () => {
    const ctx = unitContext();
    const paid = async (wallet: string, poolId: number) => {
      await ctx.player(wallet);
      const r = Ride.createFromTicket({ id: ctx.entropy.uuid(), wallet, tier: '1h', seed: ctx.entropy.seed31(), minSeconds: 60, timeScale: 1, poolId, roundId: 1, now: ctx.now() });
      await ctx.rides.insert(Ride.restore({ ...r.snapshot(), status: RideStatus.Completed, startedAt: ctx.now(), endedAt: ctx.now(), lastS: 900, driveSeconds: 60 }));
      ctx.clock.advance(1);
      return r.id;
    };
    const freeFlagged = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    await judgedRide(ctx, 'alice');   // free + verified: not in the queue
    const rejected = await paid('carol', 1), unjudged = await paid('dave', 2), accepted = await paid('erin', 1), decided = await paid('fay', 1);
    expect(await ctx.verdicts.judge(rejected)).toMatchObject({ status: VerdictStatus.Rejected });   // no recording – the machine rejects it
    await ctx.verdicts.judge(accepted); await ctx.verdicts.override(accepted, VerdictStatus.Verified, 'ADMIN', null, null);
    await ctx.verdicts.judge(decided); await ctx.verdicts.override(decided, VerdictStatus.Rejected, 'ADMIN', null, null);
    const list = (filter: Parameters<typeof ctx.adminQuery.rides>[0]) => new ListAdminRidesHandler(ctx.adminQuery).execute(new ListAdminRidesQuery(filter)).then((r) => r.rows);
    const queue = await list({ limit: 10, review: 'under_review' });
    expect(queue.map((r) => [r.id, r.poolId, r.verdict, r.review])).toEqual([[unjudged, 2, null, 'under_review'], [rejected, 1, 'rejected', 'under_review'], [freeFlagged.ride.id, null, 'flagged', null]]);
    expect((await list({ limit: 10, review: 'under_review', poolId: 1 })).map((r) => r.id)).toEqual([rejected]);
    expect((await list({ limit: 1, review: 'under_review' })).map((r) => r.id)).toEqual([unjudged]);
    expect((await list({ limit: 10, poolId: 1 })).map((r) => [r.id, r.review])).toEqual([[decided, 'rejected'], [accepted, 'accepted'], [rejected, 'under_review']]);
  });
});
