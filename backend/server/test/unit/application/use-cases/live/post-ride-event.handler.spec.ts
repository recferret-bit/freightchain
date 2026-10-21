import { LiveChatService } from '../../../../../src/application/live/live-chat.service.js';
import { PostRideEventHandler } from '../../../../../src/application/use-cases/live/post-ride-event/post-ride-event.handler.js';
import { PostRideEventCommand, type RideEventInput } from '../../../../../src/application/use-cases/live/post-ride-event/post-ride-event.command.js';
import { TIP_DEFAULT_LAMPORTS } from '../../../../../src/domain/live/tip-rules.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';
import type { LiveFlags } from '../../../../../src/domain/live/live-features.js';

describe('PostRideEventHandler', () => {
  const setup = (live?: Partial<LiveFlags>) => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations: true, effects: 'all', ...live } }));
    const chat = new LiveChatService(ctx.replayAccess, ctx.rideEvents, ctx.rideMutes, ctx.adminActions, ctx.rules, ctx.clock);
    const handler = new PostRideEventHandler(ctx.liveAccess, ctx.rideEvents, ctx.clock, ctx.stats, ctx.donations, chat);
    return { ctx, post: (wallet: string, id: string, input: RideEventInput) => handler.execute(new PostRideEventCommand(wallet, id, input)) };
  };
  const paidRide = async (ctx: ReturnType<typeof unitContext>, wallet = 'driver') => {
    const ride = await ctx.paidOrder(wallet);
    ride.markPaid(1, ctx.now());
    ride.start(ctx.now());
    return ctx.rides.save(ride);
  };
  const say = (text: string): RideEventInput => ({ kind: 'message', text });
  const give = (effect: 'tip' | 'night' | 'sinkhole', note: string | null = null): RideEventInput => ({ kind: 'donation', effect, note });

  it('a spectator writes to a running ride: numbered, cleaned, a mock donation priced from the table', async () => {
    const { ctx, post } = setup();
    const ride = await paidRide(ctx, 'driver');
    const line = await post('fan', ride.id, say('  go\ngo  '));
    expect(line).toMatchObject({ kind: 'message', wallet: 'fan', text: 'go go', effect: null, lamports: 0, at: ctx.clock.ms, applied: null });
    ctx.clock.advance(3);
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    const gift = await post('fan', ride.id, give('tip', 'enjoy'));
    expect(gift).toMatchObject({ kind: 'donation', effect: 'tip', text: 'enjoy', lamports: TIP_DEFAULT_LAMPORTS });
    expect(gift.id).toBeGreaterThan(line.id);
    await expect(post('fan', ride.id, give('sinkhole'))).rejects.toThrow(BadRequestError);
    expect(await ctx.rideEvents.totals(ride.id)).toEqual({ messages: 1, donations: 1, lamports: TIP_DEFAULT_LAMPORTS });
  });

  it('refuses posts on free rides with 403 free_ride_no_stream', async () => {
    const { ctx, post } = setup();
    const free = await ctx.freeRide('driver', true);
    await expect(post('fan', free.id, say('hello'))).rejects.toThrow(new ForbiddenError('stream watching and interactions are not available on free rides', 'free_ride_no_stream'));
    await expect(post('fan', free.id, give('tip'))).rejects.toThrow(new NotFoundError('replay is not available', 'replay_not_available'));
  });

  it('one game effect per ride per window (whoever is first), one line per wallet per window – a 429 with the wait', async () => {
    const { ctx, post } = setup();
    const ride = await paidRide(ctx, 'driver');
    await expect(post('a', ride.id, give('night'))).rejects.toThrow(BadRequestError);
    await post('b', ride.id, say('hi'));
    await expect(post('b', ride.id, say('again'))).rejects.toThrow(/one line per 3 s/);
    expect(await post('c', ride.id, say('me too'))).toMatchObject({ wallet: 'c' });
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    expect(await post('b', ride.id, give('tip'))).toMatchObject({ effect: 'tip' });
  });

  it('the effect gap is SLIDING: two effects either side of a 20 s bucket edge are still 20 s apart; the 429 carries the real wait', async () => {
    const { ctx, post } = setup();
    const ride = await paidRide(ctx, 'driver');
    await expect(post('a', ride.id, give('night'))).rejects.toThrow(new BadRequestError('only tip donations are accepted', 'donation_effect'));
    await expect(post('b', ride.id, give('sinkhole'))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('feature flags: chat / donations / effects off – a 403 live_feature_off naming what is off', async () => {
    const off = setup({ chat: 'off', effects: 'off' });
    const ride = await paidRide(off.ctx, 'driver');
    await expect(off.post('fan', ride.id, say('hi'))).rejects.toThrow(new ForbiddenError('chat is off on this ride', 'live_feature_off'));
    await expect(off.post('fan', ride.id, give('night'))).rejects.toThrow(BadRequestError);
    ride.finish('failed', 'done', off.ctx.now()); await off.ctx.rides.save(ride);
    expect(await off.post('fan', ride.id, give('tip'))).toMatchObject({ effect: 'tip' });
    const none = setup({ donations: false });
    const r2 = await paidRide(none.ctx, 'driver');
    expect(await none.post('fan', r2.id, say('chat still works'))).toMatchObject({ kind: 'message' });
    r2.finish('failed', 'done', none.ctx.now()); await none.ctx.rides.save(r2);
    await expect(none.post('fan', r2.id, give('tip'))).rejects.toThrow(/donations are off/);
  });

  it('when donations must be paid (LIVE_FREE_DONATIONS=off) the free route refuses them – 403 payment_required; chat is unaffected', async () => {
    const { ctx, post } = setup({ freeDonations: false });
    const ride = await paidRide(ctx, 'driver');
    expect(await post('fan', ride.id, say('hi'))).toMatchObject({ kind: 'message' });
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    await expect(post('fan', ride.id, give('tip'))).rejects.toThrow(new ForbiddenError('donations are paid with a real transfer here – use a donation order', 'payment_required'));
  });

  it('a wallet the driver muted cannot post on that ride (403 muted) – on other rides it can', async () => {
    const { ctx, post } = setup();
    const ride = await paidRide(ctx, 'driver'), other = await paidRide(ctx, 'driver2');
    await ctx.rideMutes.set(ride.id, 'troll', true, ctx.now());
    await expect(post('troll', ride.id, say('boo'))).rejects.toThrow(new ForbiddenError('the driver muted you on this ride', 'muted'));
    expect(await post('troll', other.id, say('hi'))).toMatchObject({ kind: 'message' });
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    await expect(post('troll', ride.id, give('tip'))).rejects.toThrow(/muted/);
  });

  it('never the driver on its own ride; only rides on the air: unknown / unstarted 404, ended or silent 409', async () => {
    const { ctx, post } = setup();
    const ride = await paidRide(ctx, 'driver');
    await expect(post('driver', ride.id, say('me'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(post('fan', 'nope', say('hi'))).rejects.toBeInstanceOf(NotFoundError);
    const unstarted = await paidRide(ctx, 'other');
    unstarted.finish('failed', 'crash', ctx.now()); await ctx.rides.save(unstarted);
    expect(await post('fan', unstarted.id, say('hi'))).toMatchObject({ kind: 'message', replayT: 0 });
    ctx.clock.advance(151); // no heartbeat for longer than the timeout
    await expect(post('fan', ride.id, say('hi'))).rejects.toThrow(new ConflictError('the ride is off the air', 'ride_not_live'));
  });

  it('statistics: a mock donation counts on the DRIVER (no lamports); chat lines count nothing; a refused post counts nothing', async () => {
    const { ctx, post } = setup();
    const ride = await paidRide(ctx, 'driver');
    await post('fan', ride.id, say('hello'));
    expect(await ctx.stats.player('driver')).toMatchObject({ donations: 0 });
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    await post('fan', ride.id, give('tip'));
    await expect(post('fan', ride.id, give('tip'))).rejects.toThrow();   // the same 3 s bucket – a 429
    expect(await ctx.stats.player('driver')).toMatchObject({ donations: 1, donationLamports: 0 });
    expect(await ctx.stats.player('fan')).toMatchObject({ donations: 0 });
    expect(await ctx.stats.global()).toMatchObject({ donations: 1 });
  });
});
