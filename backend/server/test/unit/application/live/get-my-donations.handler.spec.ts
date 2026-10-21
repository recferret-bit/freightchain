import { GetMyDonationsHandler } from '../../../../src/application/live/get-my-donations.handler.js';
import { GetMyDonationsQuery } from '../../../../src/application/live/get-my-donations.query.js';
import { RideEvent } from '../../../../src/domain/live/ride-event.entity.js';
import { unitContext } from '../../../support/unit-context.js';

describe('GetMyDonationsHandler', () => {
  it('splits confirmed tips into sent and received', async () => {
    const ctx = unitContext();
    const ride = await ctx.paidRide('driver', true);
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'fan', effect: 'tip', note: 'gg', now: ctx.now(), lamports: 10_000_000, paid: { orderId: 'o', signature: 'sig', lamports: 10_000_000 } }));
    const dto = await new GetMyDonationsHandler(ctx.rideEvents).execute(new GetMyDonationsQuery('fan'));
    expect(dto.sent).toMatchObject([{ fromWallet: 'fan', toWallet: 'driver', lamports: 10_000_000, note: 'gg', signature: 'sig' }]);
    expect(dto.totals.sentLamports).toBe(10_000_000);
    const received = await new GetMyDonationsHandler(ctx.rideEvents).execute(new GetMyDonationsQuery('driver'));
    expect(received.received).toHaveLength(1);
    expect(received.totals.receivedLamports).toBe(10_000_000);
    expect(dto.received).toEqual([]);
  });
});
