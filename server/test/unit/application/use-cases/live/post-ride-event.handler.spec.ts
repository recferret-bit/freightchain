import { PostRideEventHandler } from '../../../../../src/application/use-cases/live/post-ride-event/post-ride-event.handler.js';
import { PostRideEventCommand, type RideEventInput } from '../../../../../src/application/use-cases/live/post-ride-event/post-ride-event.command.js';
import { EFFECTS } from '../../../../../src/domain/live/live-rules.js';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('PostRideEventHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new PostRideEventHandler(ctx.rides, ctx.rideEvents, ctx.rules, ctx.clock);
    return { ctx, post: (wallet: string, id: string, input: RideEventInput) => handler.execute(new PostRideEventCommand(wallet, id, input)) };
  };
  const say = (text: string): RideEventInput => ({ kind: 'message', text });
  const give = (effect: 'tip' | 'night' | 'sinkhole', note: string | null = null): RideEventInput => ({ kind: 'donation', effect, note });

  it('a spectator writes to a running ride: numbered, cleaned, a mock donation priced from the table', async () => {
    const { ctx, post } = setup();
    const ride = await ctx.freeRide('driver', true);
    const line = await post('fan', ride.id, say('  go\ngo  '));
    expect(line).toMatchObject({ kind: 'message', wallet: 'fan', text: 'go go', effect: null, lamports: 0, at: ctx.clock.ms, applied: null });
    ctx.clock.advance(3);
    const gift = await post('fan', ride.id, give('sinkhole', 'enjoy'));
    expect(gift).toMatchObject({ kind: 'donation', effect: 'sinkhole', text: 'enjoy', lamports: EFFECTS.sinkhole.lamports });
    expect(gift.id).toBeGreaterThan(line.id);
    expect(await ctx.rideEvents.totals(ride.id)).toEqual({ messages: 1, donations: 1, lamports: EFFECTS.sinkhole.lamports });
  });

  it('one game effect per ride per window (whoever is first), one line per wallet per window – a 429 with the wait', async () => {
    const { ctx, post } = setup();
    const ride = await ctx.freeRide('driver', true);
    await post('a', ride.id, give('night'));
    ctx.clock.advance(5);
    await expect(post('b', ride.id, give('sinkhole'))).rejects.toThrow(new TooManyRequestsError('one effect per 20 s on this ride – someone was quicker; the next in 15 s', 'live_rate_limited', 15));
    expect(await post('b', ride.id, give('tip'))).toMatchObject({ effect: 'tip' }); // a tip is not a game effect
    await post('b', ride.id, say('hi'));
    await expect(post('b', ride.id, say('again'))).rejects.toThrow(/one line per 3 s – try again in 1 s/);
    expect(await post('c', ride.id, say('me too'))).toMatchObject({ wallet: 'c' }); // the line window is per wallet
    ctx.clock.advance(15);
    expect(await post('b', ride.id, give('sinkhole'))).toMatchObject({ effect: 'sinkhole' });
  });

  it('the effect gap is SLIDING: two effects either side of a 20 s bucket edge are still 20 s apart; the 429 carries the real wait', async () => {
    const { ctx, post } = setup();
    const ride = await ctx.freeRide('driver', true);
    ctx.clock.advance(19.9); // 100 ms before a bucket edge
    await post('a', ride.id, give('night'));
    ctx.clock.advance(0.2);  // the next bucket, 200 ms later
    const refused = await post('b', ride.id, give('sinkhole')).catch((e: TooManyRequestsError) => e);
    expect(refused).toBeInstanceOf(TooManyRequestsError);
    expect((refused as TooManyRequestsError).retryAfterSeconds).toBe(20);
    ctx.clock.advance(19.8);
    expect(await post('b', ride.id, give('sinkhole'))).toMatchObject({ effect: 'sinkhole' });
  });

  it('never the driver on its own ride; only rides on the air: unknown / unstarted 404, ended or silent 409', async () => {
    const { ctx, post } = setup();
    const ride = await ctx.freeRide('driver', true);
    await expect(post('driver', ride.id, say('me'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(post('fan', 'nope', say('hi'))).rejects.toBeInstanceOf(NotFoundError);
    const unstarted = await ctx.freeRide('other');
    await expect(post('fan', unstarted.id, say('hi'))).rejects.toBeInstanceOf(NotFoundError);
    ctx.clock.advance(151); // no heartbeat for longer than the timeout
    await expect(post('fan', ride.id, say('hi'))).rejects.toThrow(new ConflictError('the ride is off the air', 'ride_not_live'));
    ride.finish('failed', 'crash', ctx.now()); await ctx.rides.save(ride);
    await expect(post('fan', ride.id, say('hi'))).rejects.toThrow(new ConflictError('the ride is failed', 'ride_not_live'));
  });
});
