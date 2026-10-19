import { NotFoundError } from '../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../support/unit-context.js';

describe('RideLookupService', () => {
  it("returns the owner's ride; a stranger's or a missing id is the same 404", async () => {
    const ctx = unitContext();
    const ride = await ctx.freeRide('alice');
    expect((await ctx.lookup.require(ride.id, 'alice')).id).toBe(ride.id);
    await expect(ctx.lookup.require(ride.id, 'bob')).rejects.toThrow(new NotFoundError('ride not found'));
    await expect(ctx.lookup.require('missing', 'alice')).rejects.toThrow(new NotFoundError('ride not found'));
  });
});
