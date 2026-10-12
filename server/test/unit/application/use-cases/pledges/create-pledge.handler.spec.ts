import { describe, expect, it } from 'vitest';
import { CreatePledgeCommand } from '../../../../../src/application/use-cases/pledges/create-pledge/create-pledge.command.js';
import { CreatePledgeHandler } from '../../../../../src/application/use-cases/pledges/create-pledge/create-pledge.handler.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('CreatePledgeHandler', () => {
  const SPONSOR = 'SponsorWallet111111111111111111111111111111';
  const DRIVER = 'DriverWallet111111111111111111111111111111';

  const ticketRide = async (ctx: UnitContext, wallet: string, started = false) => {
    const pool = aPool({ id: 1, status: 'open' }, ctx.now());
    await ctx.pools.upsert(pool);
    const ride = Ride.createFromTicket({
      id: ctx.entropy.uuid(),
      wallet,
      tier: '1h',
      seed: 12345,
      minSeconds: 3600,
      timeScale: 1,
      poolId: 1,
      roundId: 1,
      now: ctx.now(),
    });
    if (started) ride.start(ctx.now());
    await ctx.rides.insert(ride);
    return ride;
  };

  const setup = async () => {
    const ctx = unitContext();
    await ctx.player(SPONSOR);
    await ctx.accept(SPONSOR, true); // accept age18 & loss
    await ctx.player(DRIVER);
    await ctx.accept(DRIVER, true);

    const handler = new CreatePledgeHandler(
      ctx.pledges,
      ctx.rides,
      ctx.players,
      ctx.pools,
      ctx.poolChain,
      ctx.transactions,
      ctx.clock,
      ctx.entropy,
    );

    return { ctx, handler };
  };

  it('creates pledge successfully under sponsor lock', async () => {
    const { ctx, handler } = await setup();
    const ride = await ticketRide(ctx, DRIVER, false);

    const res = await handler.execute(
      new CreatePledgeCommand(SPONSOR, ride.id, 10_000_000n, 50),
    );

    expect(res).toMatchObject({
      rideId: ride.id,
      sponsor: SPONSOR,
      driver: DRIVER,
      targetKm: 50,
      lamportsPerKm: '10000000',
      maxLamports: '500000000',
      settled: false,
      earnedLamports: '0',
      refundedLamports: '0',
    });

    const stored = await ctx.pledges.findById(res.id);
    expect(stored).not.toBeNull();
    expect(stored!.maxLamports).toBe(500_000_000n);
  });

  it('refuses if sponsor player not found', async () => {
    const { ctx, handler } = await setup();
    const ride = await ticketRide(ctx, DRIVER, false);

    await expect(
      handler.execute(new CreatePledgeCommand('UnknownSponsor', ride.id, 10_000_000n, 50)),
    ).rejects.toThrow(NotFoundError);
  });

  it('refuses if sponsor has not signed paid agreements', async () => {
    const { ctx, handler } = await setup();
    const ride = await ticketRide(ctx, DRIVER, false);
    await ctx.accept(SPONSOR, false); // turn off agreements

    await expect(
      handler.execute(new CreatePledgeCommand(SPONSOR, ride.id, 10_000_000n, 50)),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses if ride not found', async () => {
    const { handler } = await setup();

    await expect(
      handler.execute(new CreatePledgeCommand(SPONSOR, '00000000-0000-4000-8000-000000000099', 10_000_000n, 50)),
    ).rejects.toThrow(NotFoundError);
  });

  it('refuses if sponsor is the driver', async () => {
    const { ctx, handler } = await setup();
    const ride = await ticketRide(ctx, DRIVER, false);

    await expect(
      handler.execute(new CreatePledgeCommand(DRIVER, ride.id, 10_000_000n, 50)),
    ).rejects.toThrow(BadRequestError);
  });

  it('refuses if ride is already completed or ended', async () => {
    const { ctx, handler } = await setup();
    const ride = await ticketRide(ctx, DRIVER, true);
    ride.finish('failed', 'crashed', ctx.now());
    await ctx.rides.save(ride);

    await expect(
      handler.execute(new CreatePledgeCommand(SPONSOR, ride.id, 10_000_000n, 50)),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses if pledge already exists for this ride and sponsor', async () => {
    const { ctx, handler } = await setup();
    const ride = await ticketRide(ctx, DRIVER, false);

    await handler.execute(new CreatePledgeCommand(SPONSOR, ride.id, 10_000_000n, 50));

    await expect(
      handler.execute(new CreatePledgeCommand(SPONSOR, ride.id, 10_000_000n, 50)),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses if ride is not pool-backed (e.g. free ride)', async () => {
    const { ctx, handler } = await setup();
    const ride = await ctx.freeRide(DRIVER);

    await expect(
      handler.execute(new CreatePledgeCommand(SPONSOR, ride.id, 10_000_000n, 50)),
    ).rejects.toThrow(new ConflictError('pledges are only permitted on pool-backed rides', 'ride_not_in_pool'));
  });
});
