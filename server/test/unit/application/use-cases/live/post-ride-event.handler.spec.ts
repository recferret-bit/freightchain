import { PostRideEventHandler } from '../../../../../src/application/use-cases/live/post-ride-event/post-ride-event.handler.js';
import { PostRideEventCommand, type RideEventInput } from '../../../../../src/application/use-cases/live/post-ride-event/post-ride-event.command.js';
import { EFFECTS } from '../../../../../src/domain/live/live-rules.js';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';
import type { LiveFlags } from '../../../../../src/domain/live/live-features.js';

describe('PostRideEventHandler', () => {
  const setup = (live?: Partial<LiveFlags>) => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations: true, effects: 'all', ...live } }));
    const handler = new PostRideEventHandler(ctx.liveAccess, ctx.rideEvents, ctx.clock, ctx.stats);
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

  it('feature flags: chat / donations / effects off – a 403 live_feature_off naming what is off; "free" = only on free test rides', async () => {
    const off = setup({ chat: 'off', effects: 'off' });
    const ride = await off.ctx.freeRide('driver', true);
    await expect(off.post('fan', ride.id, say('hi'))).rejects.toThrow(new ForbiddenError('chat is off on this ride', 'live_feature_off'));
    await expect(off.post('fan', ride.id, give('night'))).rejects.toThrow(/effects are off on this ride – a tip still works/);
    expect(await off.post('fan', ride.id, give('tip'))).toMatchObject({ effect: 'tip' });
    const none = setup({ donations: false });
    const r2 = await none.ctx.freeRide('driver', true);
    await expect(none.post('fan', r2.id, give('tip'))).rejects.toThrow(/donations are off/);
    expect(await none.post('fan', r2.id, say('chat still works'))).toMatchObject({ kind: 'message' });
    const freeOnly = setup({ chat: 'free', effects: 'free' });
    const free = await freeOnly.ctx.freeRide('driver', true);
    expect(await freeOnly.post('fan', free.id, give('night'))).toMatchObject({ effect: 'night' });
    const paid = await freeOnly.ctx.paidOrder('payer'); paid.markPaid(1, freeOnly.ctx.now()); paid.start(freeOnly.ctx.now()); await freeOnly.ctx.rides.save(paid);
    await expect(freeOnly.post('fan', paid.id, say('hi'))).rejects.toThrow(/chat is off/);
    await expect(freeOnly.post('fan', paid.id, give('sinkhole'))).rejects.toThrow(/effects are off/);
    expect(await freeOnly.post('fan2', paid.id, give('tip'))).toMatchObject({ effect: 'tip' });
  });

  it('when donations must be paid (LIVE_FREE_DONATIONS=off) the free route refuses them – 403 payment_required; chat is unaffected', async () => {
    const { ctx, post } = setup({ freeDonations: false });
    const ride = await ctx.freeRide('driver', true);
    await expect(post('fan', ride.id, give('tip'))).rejects.toThrow(new ForbiddenError('donations are paid with a real transfer here – use a donation order', 'payment_required'));
    expect(await post('fan', ride.id, say('hi'))).toMatchObject({ kind: 'message' });
  });

  it('a wallet the driver muted cannot post on that ride (403 muted) – on other rides it can', async () => {
    const { ctx, post } = setup();
    const ride = await ctx.freeRide('driver', true), other = await ctx.freeRide('driver2', true);
    await ctx.rideMutes.set(ride.id, 'troll', true, ctx.now());
    await expect(post('troll', ride.id, say('boo'))).rejects.toThrow(new ForbiddenError('the driver muted you on this ride', 'muted'));
    await expect(post('troll', ride.id, give('sinkhole'))).rejects.toThrow(/muted/);
    expect(await post('troll', other.id, say('hi'))).toMatchObject({ kind: 'message' });
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

  it('statistics: a mock donation counts on the DRIVER (no lamports); chat lines count nothing; a refused post counts nothing', async () => {
    const { ctx, post } = setup();
    const ride = await ctx.freeRide('driver', true);
    await post('fan', ride.id, say('hello'));
    expect(await ctx.stats.player('driver')).toMatchObject({ donations: 0 });
    await post('fan', ride.id, give('tip'));
    await expect(post('fan', ride.id, give('tip'))).rejects.toThrow();   // the same 3 s bucket – a 429
    expect(await ctx.stats.player('driver')).toMatchObject({ donations: 1, donationLamports: 0 });
    expect(await ctx.stats.player('fan')).toMatchObject({ donations: 0 });
    expect(await ctx.stats.global()).toMatchObject({ donations: 1 });
  });
});
