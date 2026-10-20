import { GetRideReplaysHandler } from '../../../../../src/application/use-cases/verdict/get-ride-replays/get-ride-replays.handler.js';
import { GetRideReplaysQuery } from '../../../../../src/application/use-cases/verdict/get-ride-replays/get-ride-replays.query.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetRideReplaysHandler', () => {
  it('returns stored replay verification sessions for the ride owner or admin (wallet = null)', async () => {
    const ctx = unitContext();
    const base = await ctx.freeRide('W1', true);
    const r = Ride.restore({
      ...base.snapshot(),
      status: RideStatus.Completed,
      lastS: 150,
      lastT: 10,
      driveSeconds: 10,
      endedAt: ctx.now(),
    });
    await ctx.rides.save(r);
    await ctx.verdicts.judge(r.id);

    const handler = new GetRideReplaysHandler(ctx.rides, ctx.replayRepo);
    const res = await handler.execute(new GetRideReplaysQuery('W1', r.id));
    expect(res.rideId).toBe(r.id);
    expect(res.replays).toHaveLength(1);
    expect(res.replays[0]?.simHz).toBe(10);

    const adminRes = await handler.execute(new GetRideReplaysQuery(null, r.id));
    expect(adminRes.replays).toHaveLength(1);
  });

  it('a non-owner wallet and a missing ride are the same 404 not_found', async () => {
    const ctx = unitContext();
    const r = await ctx.freeRide('W1', true);
    const handler = new GetRideReplaysHandler(ctx.rides, ctx.replayRepo);
    const foreign = await handler.execute(new GetRideReplaysQuery('W2', r.id)).then(() => null, (e) => e);
    const missing = await handler.execute(new GetRideReplaysQuery('W1', 'missing')).then(() => null, (e) => e);
    expect(foreign).toBeInstanceOf(NotFoundError);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect({ status: foreign.statusCode, code: foreign.errorCode, message: foreign.message }).toEqual({ status: 404, code: 'not_found', message: missing.message });
    expect(foreign.errorCode).toBe(missing.errorCode);
  });
});
