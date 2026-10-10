import { CreateRideHandler } from '../../../../../src/application/use-cases/rides/create-ride/create-ride.handler.js';
import { CreateRideCommand } from '../../../../../src/application/use-cases/rides/create-ride/create-ride.command.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { ConflictError, ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { FixedRules, DEMO_UNIT_WALLET, unitContext, unitRules } from '../../../../support/unit-context.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { StubPrice } from '../../../../support/stub-price.js';
import { aPool } from '../../../../support/pools.js';

const setup = (price = new StubPrice(), rules = unitRules()) => {
  const ctx = unitContext(rules);
  const analytics = new RecordingAnalytics();
  const handler = new CreateRideHandler(ctx.players, ctx.rides, ctx.sessions, price, new FixedRules(rules), ctx.transactions, ctx.clock, ctx.entropy, ctx.poolTickets, ctx.rounds, analytics, ctx.stats);
  return { ctx, analytics, handler, create: (tier: 'free' | '1h' | '4h' | '8h', wallet = 'w', tutorial = false, assist = false) => handler.execute(new CreateRideCommand(wallet, tier, tutorial, assist)) };
};

describe('CreateRideHandler', () => {
  it('a free ride: ready at once, one credit spent, a re-ask hands back the same ride', async () => {
    const { ctx, analytics, create } = setup();
    const ride = await create('free');
    expect(ride).toMatchObject({ tier: 'free', status: 'created', minSeconds: 10, completeDist: 70, lamports: 0 });
    expect((await create('free')).id).toBe(ride.id);
    expect((await ctx.storedPlayer('w')).freeRides).toBe(9);
    expect(analytics.named('ride_ordered')).toHaveLength(1);
    expect(analytics.named('ride_ordered')[0]?.properties).toMatchObject({ is_free: true, is_demo: false, time_scale: 1, lamports: 0, free_rides_left: 9, ride_id: ride.id });
    expect(analytics.named('ride_resumed')).toHaveLength(1);
    expect(analytics.named('ride_resumed')[0]?.properties).toMatchObject({ ride_id: ride.id, status: 'created' });
  });

  it('the tutorial / assist checkboxes are stored on a free ride and sent to the game; off by default', async () => {
    expect(await setup().create('free')).toMatchObject({ tutorial: false, assist: false });
    const { ctx, create } = setup();
    const ride = await create('free', 'w', true, true);
    expect(ride).toMatchObject({ tutorial: true, assist: true });
    expect(await ctx.reload(ride.id)).toMatchObject({ tutorial: true, assist: true });
  });

  it('asking again for the ready free ride re-chooses its helpers on the SAME ride – one credit, one ride', async () => {
    const { ctx, create } = setup();
    const first = await create('free', 'w', true, false);
    const again = await create('free', 'w', false, true);
    expect(again).toMatchObject({ id: first.id, tutorial: false, assist: true });
    expect(await ctx.reload(first.id)).toMatchObject({ tutorial: false, assist: true });
    expect((await ctx.storedPlayer('w')).freeRides).toBe(9);
    expect(await create('free', 'w', false, true)).toMatchObject({ id: first.id, assist: true });   // unchanged: nothing to save
  });

  it('a paid tier refuses the tutorial and assist (409) – assist never reaches a ranked ride – and creates nothing', async () => {
    const { ctx, create } = setup();
    await expect(create('1h', 'w', false, true)).rejects.toThrow(new ConflictError('the tutorial and assist are for free rides only'));
    await expect(create('4h', 'w', true, false)).rejects.toThrow(ConflictError);
    expect(await ctx.rides.findOpenByWallet('w')).toBeNull();
  });

  it('no credits left → 409', async () => {
    const { ctx, create } = setup();
    for (let i = 0; i < 10; i++) {   // a new wallet starts with free_on_signup (10)
      const r = await ctx.reload((await create('free')).id);
      r.start(ctx.now()); r.finish('failed', null, ctx.now()); await ctx.rides.save(r);
    }
    await expect(create('free')).rejects.toThrow(new ConflictError('no free rides left'));
  });

  it('a paid order is priced at the quote, held 10 min, scaled only for demo wallets', async () => {
    const { ctx, analytics, create } = setup();
    expect(await create('1h')).toMatchObject({ status: 'awaiting_payment', lamports: 50_000_000, priceUsd: 5, timeScale: 1, minSeconds: 3600, quoteExpiresAt: ctx.clock.ms + 600_000 });
    expect(analytics.named('ride_ordered')).toHaveLength(1);
    expect(analytics.named('ride_ordered')[0]?.properties).toMatchObject({ is_demo: false, lamports: 50_000_000, price_usd: 5, sol_usd_cents: 10000 });
    expect(await create('1h', DEMO_UNIT_WALLET)).toMatchObject({ timeScale: 60, minSeconds: 60, completeDist: 840 });
    expect(analytics.named('ride_ordered')).toHaveLength(2);
    expect(analytics.named('ride_ordered')[1]?.properties).toMatchObject({ is_demo: true, time_scale: 60 });
  });

  it('the same unpaid order while it is quoted; an off-sale tier leaves it; a lapsed quote expires it', async () => {
    const { ctx, analytics, create } = setup();
    const first = await create('1h');
    expect((await create('1h')).id).toBe(first.id);
    expect(analytics.named('ride_ordered')).toHaveLength(1);
    expect(analytics.named('ride_resumed')).toHaveLength(1);
    await expect(create('4h')).rejects.toThrow(new ConflictError('the 4-hour shift is not on sale yet', 'tier_not_on_sale'));
    await expect(create('8h')).rejects.toThrow(new ConflictError('the 8-hour shift is not on sale yet', 'tier_not_on_sale'));
    expect(analytics.named('ride_ordered')).toHaveLength(1);
    expect(analytics.named('ride_expired')).toHaveLength(0);
    expect((await ctx.reload(first.id)).status).toBe(RideStatus.AwaitingPayment);
    ctx.clock.advance(601);
    const second = await create('1h');
    expect(second.id).not.toBe(first.id);
    expect((await ctx.reload(first.id)).status).toBe(RideStatus.Expired);
  });

  it('buying while holding an unstarted free ride cancels it and refunds the credit; a paid ready ride is never replaced', async () => {
    const { ctx, analytics, create } = setup();
    const free = await create('free');
    const order = await create('1h');
    expect((await ctx.reload(free.id)).status).toBe(RideStatus.Cancelled);
    expect((await ctx.storedPlayer('w')).freeRides).toBe(10);
    const paid = await ctx.reload(order.id); paid.markPaid(1, ctx.now()); await ctx.rides.save(paid);
    const ordered = analytics.named('ride_ordered').length;
    for (const tier of ['free', '1h'] as const) expect((await create(tier)).id).toBe(order.id);
    await expect(create('4h')).rejects.toThrow(/not on sale/);
    await expect(create('8h')).rejects.toThrow(/not on sale/);
    expect(analytics.named('ride_ordered')).toHaveLength(ordered);
    expect(analytics.named('ride_resumed').length).toBeGreaterThanOrEqual(2);
  });

  it('a running ride blocks a new one – unless its tab vanished (then it fails and the new ride goes ahead)', async () => {
    const { ctx, create } = setup();
    const running = await ctx.freeRide('w', true);
    await expect(create('free')).rejects.toThrow(new ConflictError('a ride is already in progress'));
    ctx.clock.advance(151);
    expect((await create('free')).id).not.toBe(running.id);
    expect(await ctx.reload(running.id)).toMatchObject({ status: RideStatus.Failed, reason: 'heartbeat lost' });
  });

  it('paid tiers need a treasury and a price (re-asking for an existing order needs neither price)', async () => {
    await expect(setup(new StubPrice(), unitRules({ treasury: '' })).create('1h')).rejects.toBeInstanceOf(ServiceUnavailableError);
    const price = new StubPrice();
    const { ctx, create } = setup(price);
    const order = await create('1h');
    expect(price.calls).toBe(1);
    price.usd = null;
    expect((await create('1h')).id).toBe(order.id);
    expect(price.calls).toBe(1); // handing back the order in hand never waits on the price feeds
    await expect(create('4h')).rejects.toThrow(/not on sale/); // refused before a price is needed, and the quote stays
    expect((await ctx.reload(order.id)).status).toBe(RideStatus.AwaitingPayment);
    ctx.clock.advance(601);
    await expect(create('1h')).rejects.toThrow('no SOL/USD price available right now');
  });

  describe('a tier sold through escrowed pools – paid with a ticket', () => {
    const withPools = async (...pools: Parameters<typeof aPool>[0][]) => {
      const t = setup(new StubPrice(null), unitRules({ treasury: '' })); // neither price nor treasury is needed on this path
      for (const p of pools) await t.ctx.pools.upsert(aPool(p, t.ctx.now()));
      const give = async (poolId: number, n: number, wallet = 'w') => { const k = await t.ctx.tickets.open(wallet, poolId); k.recordPurchase(n); await t.ctx.tickets.save(k); };
      return { ...t, give };
    };

    it('spends one ticket: a ready ride in the pool and its round, an audit line, and a re-ask hands back the same ride without spending again', async () => {
      const { ctx, create, give } = await withPools({ id: 1, status: 'active', roundId: 7 });
      await give(1, 2);
      const ride = await create('1h');
      expect(ride).toMatchObject({ tier: '1h', status: 'created', poolId: 1, roundId: 7, lamports: 0, minSeconds: 3600, timeScale: 1 });
      expect((await create('1h')).id).toBe(ride.id);
      expect((await ctx.tickets.find('w', 1))?.balance).toBe(1);
      expect(await ctx.tickets.recentGrants('w', 5)).toEqual([{ wallet: 'w', poolId: 1, delta: -1, source: 'spend', ref: ride.id, at: ctx.now() }]);
    });

    it('the soonest-ending active pool the wallet holds tickets in goes first; a pool with no round ranks in the current one; demo wallets get the short shift', async () => {
      const { ctx, create, give } = await withPools({ id: 1, status: 'active', playDeadline: new Date(Date.UTC(2036, 9, 20)) }, { id: 2, status: 'active', playDeadline: new Date(Date.UTC(2036, 9, 15)) });
      await give(1, 1, DEMO_UNIT_WALLET); await give(2, 1, DEMO_UNIT_WALLET); await give(1, 1);
      const first = await create('1h', DEMO_UNIT_WALLET);
      const round = await ctx.rounds.ensureRound();
      expect(first).toMatchObject({ poolId: 2, roundId: round.id, timeScale: 60, minSeconds: 60 });
      expect((await create('1h')).poolId).toBe(1);
    });

    it('409 no_tickets with none, 409 pool_not_live when the only tickets wait for the minimum – and nothing else changed', async () => {
      const { ctx, create, give } = await withPools({ id: 1, status: 'open', minTickets: 10, ticketsSold: 7 }, { id: 2, tier: '4h', status: 'active' });
      await expect(create('8h')).rejects.toMatchObject({ errorCode: 'tier_not_on_sale' }); // no 8h pool: not on sale, even with no treasury
      await expect(create('4h')).rejects.toThrow(new ConflictError('no 4h tickets left', 'no_tickets'));
      await give(1, 1);
      const free = await create('free');
      await expect(create('1h')).rejects.toThrow(new ConflictError('pool not live yet – 3 more tickets needed', 'pool_not_live'));
      expect((await ctx.reload(free.id)).status).toBe(RideStatus.Created); // the unstarted free ride was not cancelled
      expect((await ctx.storedPlayer('w')).freeRides).toBe(9);
      expect((await ctx.tickets.find('w', 1))?.balance).toBe(1);
    });

    it('program mode: a tier whose only pool failed has no tickets to ride – never the legacy order', async () => {
      const t = setup(new StubPrice(), unitRules({ paymentMode: 'program', programId: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx' }));
      await t.ctx.pools.upsert(aPool({ id: 1, status: 'refunding' }, t.ctx.now()));
      await expect(t.create('1h')).rejects.toMatchObject({ errorCode: 'no_tickets' });
      await expect(t.create('8h')).rejects.toMatchObject({ errorCode: 'tier_not_on_sale' }); // no pool at all: soon, not "no tickets"
    });

    it('an active pool past its play deadline is not ridden from', async () => {
      const { ctx, create, give } = await withPools({ id: 1, status: 'active' });
      await give(1, 1);
      ctx.clock.advance(15 * 86_400);
      await expect(create('1h')).rejects.toThrow(new ConflictError('no 1h tickets left', 'no_tickets'));
    });

    it('buying with a ticket while holding an unstarted free ride cancels it and refunds the credit', async () => {
      const { ctx, create, give } = await withPools({ id: 1, status: 'active' });
      await give(1, 1);
      const free = await create('free');
      const paid = await create('1h');
      expect(paid.poolId).toBe(1);
      expect((await ctx.reload(free.id)).status).toBe(RideStatus.Cancelled);
      expect((await ctx.storedPlayer('w')).freeRides).toBe(10);
    });
  });

  it('statistics: the stale running ride a new order clears joins the totals', async () => {
    const { ctx, create } = setup();
    const old = await ctx.freeRide('w', true);
    ctx.clock.advance(7);
    const running = await ctx.reload(old.id);
    running.applyReport({ s: 80, t: 7, hull: 100, paused: false, night: false }, ctx.now(), ctx.rules.get()); await ctx.rides.save(running);
    ctx.clock.advance(151);
    await create('free');
    expect(await ctx.stats.player('w')).toMatchObject({ rides: 1, metres: 80, seconds: 7 });
    await create('free');   // asking again changes nothing
    expect(await ctx.stats.player('w')).toMatchObject({ rides: 1 });
  });
});
