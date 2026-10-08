import { GetRideHandler } from '../../../../../src/application/use-cases/rides/get-ride/get-ride.handler.js';
import { GetRideQuery } from '../../../../../src/application/use-cases/rides/get-ride/get-ride.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetRideHandler', () => {
  it("returns the owner's ride; someone else's id is indistinguishable from a missing one", async () => {
    const ctx = unitContext();
    const handler = new GetRideHandler(ctx.lookup, ctx.verdictRepo);
    const ride = await ctx.freeRide('alice');
    expect(await handler.execute(new GetRideQuery('alice', ride.id))).toMatchObject({ id: ride.id, tier: 'free', status: 'created' });
    await expect(handler.execute(new GetRideQuery('bob', ride.id))).rejects.toThrow(new NotFoundError('ride not found'));
    await expect(handler.execute(new GetRideQuery('alice', 'nope'))).rejects.toBeInstanceOf(NotFoundError);
  });
});
