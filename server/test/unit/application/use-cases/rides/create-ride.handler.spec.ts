import { CreateRideHandler } from '../../../../../src/application/use-cases/rides/create-ride/create-ride.handler.js';
import { CreateRideCommand } from '../../../../../src/application/use-cases/rides/create-ride/create-ride.command.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { ConflictError, ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { FixedRules, DEMO_UNIT_WALLET, unitContext, unitRules } from '../../../../support/unit-context.js';
import { StubPrice } from '../../../../support/stub-price.js';

const setup = (price = new StubPrice(), rules = unitRules()) => {
  const ctx = unitContext(rules);
  const handler = new CreateRideHandler(ctx.players, ctx.rides, ctx.sessions, price, new FixedRules(rules), ctx.transactions, ctx.clock, ctx.entropy);
  return { ctx, handler, create: (tier: 'free' | '1h' | '4h' | '8h', wallet = 'w') => handler.execute(new CreateRideCommand(wallet, tier)) };
};

describe('CreateRideHandler', () => {
  it('a free ride: ready at once, one credit spent, a re-ask hands back the same ride', async () => {
    const { ctx, create } = setup();
    const ride = await create('free');
    expect(ride).toMatchObject({ tier: 'free', status: 'created', minSeconds: 10, completeDist: 140, lamports: 0 });
    expect((await create('free')).id).toBe(ride.id);
    expect((await ctx.storedPlayer('w')).freeRides).toBe(4);
  });

  it('no credits left → 409', async () => {
    const { ctx, create } = setup();
    for (let i = 0; i < 5; i++) {
      const r = await ctx.reload((await create('free')).id);
      r.start(ctx.now()); r.finish('failed', null, ctx.now()); await ctx.rides.save(r);
    }
    await expect(create('free')).rejects.toThrow(new ConflictError('no free rides left'));
  });

  it('a paid order is priced at the quote, held 10 min, scaled only for demo wallets', async () => {
    const { ctx, create } = setup();
    expect(await create('1h')).toMatchObject({ status: 'awaiting_payment', lamports: 50_000_000, priceUsd: 5, timeScale: 1, minSeconds: 3600, quoteExpiresAt: ctx.clock.ms + 600_000 });
    expect(await create('1h', DEMO_UNIT_WALLET)).toMatchObject({ timeScale: 60, minSeconds: 60, completeDist: 840 });
  });

  it('the same unpaid order while it is quoted; another tier (or a lapsed quote) lets it expire', async () => {
    const { ctx, create } = setup();
    const first = await create('1h');
    expect((await create('1h')).id).toBe(first.id);
    const second = await create('4h');
    expect((await ctx.reload(first.id)).status).toBe(RideStatus.Expired);
    ctx.clock.advance(601);
    expect((await create('4h')).id).not.toBe(second.id);
  });

  it('buying while holding an unstarted free ride cancels it and refunds the credit; a paid ready ride is never replaced', async () => {
    const { ctx, create } = setup();
    const free = await create('free');
    const order = await create('1h');
    expect((await ctx.reload(free.id)).status).toBe(RideStatus.Cancelled);
    expect((await ctx.storedPlayer('w')).freeRides).toBe(5);
    const paid = await ctx.reload(order.id); paid.markPaid(1, ctx.now()); await ctx.rides.save(paid);
    for (const tier of ['free', '4h'] as const) expect((await create(tier)).id).toBe(order.id);
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
    const { create } = setup(price);
    const order = await create('1h');
    expect(price.calls).toBe(1);
    price.usd = null;
    expect((await create('1h')).id).toBe(order.id);
    expect(price.calls).toBe(1); // handing back the order in hand never waits on the price feeds
    await expect(create('4h')).rejects.toThrow('no SOL/USD price available right now');
  });
});
