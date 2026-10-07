import { GetAdminRideHandler } from '../../../../../src/application/use-cases/admin/get-admin-ride/get-admin-ride.handler.js';
import { GetAdminRideQuery } from '../../../../../src/application/use-cases/admin/get-admin-ride/get-admin-ride.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetAdminRideHandler', () => {
  it('one ride for review: the row (with seed and timings), the verdict with reasons and scores, the batch index, no payment for a free ride', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    const d = await new GetAdminRideHandler(ctx.rides, ctx.verdictRepo, ctx.adminQuery, ctx.payments).execute(new GetAdminRideQuery(ride.id));
    expect(d.ride).toMatchObject({ id: ride.id, wallet: 'bob', status: 'completed', distance: 2400, seed: ride.seed, verdict: 'flagged', overridden: false });
    expect(d.verdict).toMatchObject({ status: 'flagged', override: null, rulesVersion: 1 });
    expect(d.verdict?.reasons.map((r) => r.code)).toContain('uniform-holds');
    expect((d.verdict?.scores as { human: { presses: number } }).human.presses).toBeGreaterThan(8);
    expect(d.batches.map((b) => b.seq)).toEqual([...Array(12).keys()]);
    expect(d.batches[0]).toMatchObject({ t0: 0, t1: 15, samples: 150, hashOk: true });
    expect(d.payment).toBeNull();
  });

  it('an unknown ride is a 404', async () => {
    const ctx = unitContext();
    await expect(new GetAdminRideHandler(ctx.rides, ctx.verdictRepo, ctx.adminQuery, ctx.payments).execute(new GetAdminRideQuery('nope'))).rejects.toBeInstanceOf(NotFoundError);
  });
});
