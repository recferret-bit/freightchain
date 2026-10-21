import { GetInboxHandler } from '../../../../../src/application/use-cases/live/get-inbox/get-inbox.handler.js';
import { GetInboxQuery } from '../../../../../src/application/use-cases/live/get-inbox/get-inbox.query.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetInboxHandler', () => {
  it('the driver reads its feed after a cursor, with the totals and how many watch (without counting itself)', async () => {
    const ctx = unitContext();
    const handler = new GetInboxHandler(ctx.lookup, ctx.rideEvents, ctx.viewers, ctx.rideMutes, ctx.rules, ctx.clock);
    const ride = await ctx.paidRide('driver', true);
    const a = (await ctx.rideEvents.insert(RideEvent.message({ rideId: ride.id, wallet: 'fan', text: 'one', now: ctx.now() })))!;
    ctx.clock.advance(3);
    await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'fan', effect: 'day', now: ctx.now() }));
    ctx.viewers.seen(ride.id, '10.0.0.1', 'v1', ctx.now());
    const inbox = await handler.execute(new GetInboxQuery('driver', ride.id, 0));
    expect(inbox.events.map((e) => e.kind)).toEqual(['message', 'donation']);
    expect(inbox).toMatchObject({ now: ctx.clock.ms, viewers: 1, totals: { messages: 1, donations: 1 } });
    expect((await handler.execute(new GetInboxQuery('driver', ride.id, a.id!))).events.map((e) => e.effect)).toEqual(['day']);
    expect((await handler.execute(new GetInboxQuery('driver', ride.id, 0))).viewers).toBe(1); // reading it twice adds no viewer
    await expect(handler.execute(new GetInboxQuery('fan', ride.id, 0))).rejects.toBeInstanceOf(NotFoundError);
    expect(inbox.features).toEqual({ chat: true, donations: true, payment: 'mock', effects: false });
    await ctx.rideMutes.set(ride.id, 'fan', true, ctx.now());
    const muted = await handler.execute(new GetInboxQuery('driver', ride.id, 0));
    expect(muted.events.map((e) => e.kind)).toEqual(['donation']); // the muted wallet's line is gone, its donation stays
    expect(muted.muted).toEqual(['fan']);

    const free = await ctx.freeRide('driver2', true);
    const freeInbox = await handler.execute(new GetInboxQuery('driver2', free.id, 0));
    expect(freeInbox.features).toEqual({ chat: false, donations: false, payment: 'mock', effects: false });
  });
});
