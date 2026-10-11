import { ConflictError, ForbiddenError, NotFoundError } from '../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../support/unit-context.js';
import { LiveAccessService } from '../../../../src/application/services/live-access.service.js';

describe('LiveAccessService', () => {
  it('lets a spectator post on someone else\'s live ride and returns the ride + its features; refuses everything else with the right error', async () => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations: false, effects: 'off' } }));
    const access = new LiveAccessService(ctx.rides, ctx.rideMutes, ctx.rules);
    const ride = await ctx.paidRide('driver', true);
    const ok = await access.requirePostable(ride.id, 'fan', { kind: 'message' }, ctx.now());
    expect(ok.ride.id).toBe(ride.id);
    expect(ok.features).toEqual({ chat: true, donations: true, payment: 'chain', effects: false });
    await expect(access.requirePostable('nope', 'fan', { kind: 'message' }, ctx.now())).rejects.toBeInstanceOf(NotFoundError);
    await expect(access.requirePostable(ride.id, 'driver', { kind: 'message' }, ctx.now())).rejects.toThrow(/your own ride/);
    await expect(access.requirePostable(ride.id, 'fan', { kind: 'donation', effect: 'night' }, ctx.now())).rejects.toThrow(new ForbiddenError('effects are off on this ride – a tip still works', 'live_feature_off'));
    await ctx.rideMutes.set(ride.id, 'troll', true, ctx.now());
    await expect(access.requirePostable(ride.id, 'troll', { kind: 'message' }, ctx.now())).rejects.toThrow(/muted/);
    ctx.clock.advance(151);
    await expect(access.requirePostable(ride.id, 'fan', { kind: 'message' }, ctx.now())).rejects.toBeInstanceOf(ConflictError);

    const free = await ctx.freeRide('free-driver', true);
    await expect(access.requirePostable(free.id, 'fan', { kind: 'message' }, ctx.now())).rejects.toThrow(new ForbiddenError('stream watching and interactions are not available on free rides', 'free_ride_no_stream'));
  });
});
