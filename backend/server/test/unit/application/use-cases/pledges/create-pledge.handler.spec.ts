import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { CreatePledgeCommand } from '../../../../../src/application/use-cases/pledges/create-pledge/create-pledge.command.js';
import { CreatePledgeHandler } from '../../../../../src/application/use-cases/pledges/create-pledge/create-pledge.handler.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { rideIdToBytes } from '../../../../../src/domain/economy/pledge.types.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';
import type { PoolProps } from '../../../../../src/domain/economy/pool.types.js';

describe('CreatePledgeHandler', () => {
  const SPONSOR = Keypair.generate().publicKey.toBase58();
  const DRIVER = Keypair.generate().publicKey.toBase58();

  const ticketRide = async (ctx: UnitContext, wallet: string, pool: Partial<PoolProps> = {}, started = false) => {
    await ctx.pools.upsert(aPool({ id: 1, status: 'open', ...pool }, ctx.now()));
    const ride = Ride.createFromTicket({ id: ctx.entropy.uuid(), wallet, tier: '1h', seed: 12345, minSeconds: 3600, timeScale: 1, poolId: pool.id ?? 1, roundId: 1, now: ctx.now() });
    if (started) ride.start(ctx.now());
    await ctx.rides.insert(ride);
    return ride;
  };

  const setup = async () => {
    const ctx = unitContext();
    await ctx.player(SPONSOR);
    await ctx.accept(SPONSOR, true);
    await ctx.player(DRIVER);
    await ctx.accept(DRIVER, true);
    const handler = new CreatePledgeHandler(ctx.pledges, ctx.rides, ctx.players, ctx.pools, ctx.poolChain, ctx.transactions, ctx.clock, ctx.entropy, ctx.pledgeGate);
    return { ctx, handler, create: (rideId: string, rate = 10_000_000n, km = 5, sponsor = SPONSOR) => handler.execute(new CreatePledgeCommand(sponsor, rideId, rate, km)) };
  };

  it('a pending pledge + the unsigned create_pledge for the sponsor to sign (paid by the sponsor) – nothing is owed until the chain shows it', async () => {
    const { ctx, create } = await setup();
    const ride = await ticketRide(ctx, DRIVER);
    const res = await create(ride.id, 10_000_000n, 5);
    expect(res.pledge).toMatchObject({ rideId: ride.id, sponsor: SPONSOR, driver: DRIVER, poolId: 1, targetKm: 5, lamportsPerKm: '10000000', maxLamports: '50000000', status: 'pending', settled: false, createSignature: null });
    expect(res.pledge.pdaAddress).toBe(ctx.poolChain.pledgePda(rideIdToBytes(ride.id), SPONSOR));
    expect(res.transaction).toMatchObject({ feePayer: SPONSOR });
    expect(ctx.poolChain.built.at(-1)).toMatchObject({ kind: 'create_pledge', input: { sponsor: SPONSOR, poolId: 1, rideId: ride.id, driver: DRIVER, lamportsPerKm: '10000000', targetKm: 5 } });
    expect((await ctx.pledges.findById(res.pledge.id))!.status).toBe('pending');
  });

  it('pool 0 is a real pool: a ride of pool 0 takes pledges (the old `poolId <= 0` refusal is gone)', async () => {
    const { ctx, create } = await setup();
    const ride = await ticketRide(ctx, DRIVER, { id: 0 });
    expect((await create(ride.id)).pledge.poolId).toBe(0);
  });

  it('asking again for a pending or never-signed pledge rebuilds it (same row, new terms); an active one is 409', async () => {
    const { ctx, create } = await setup();
    const ride = await ticketRide(ctx, DRIVER);
    const first = await create(ride.id, 10_000_000n, 5);
    const again = await create(ride.id, 2_000_000n, 3);
    expect(again.pledge.id).toBe(first.pledge.id);
    expect(again.pledge).toMatchObject({ lamportsPerKm: '2000000', targetKm: 3, maxLamports: '6000000', status: 'pending' });
    const row = (await ctx.pledges.findById(first.pledge.id))!;
    row.abandon();
    await ctx.pledges.save(row);
    expect((await create(ride.id, 1_000_000n, 2)).pledge).toMatchObject({ id: first.pledge.id, status: 'pending', targetKm: 2 });
    const active = (await ctx.pledges.findById(first.pledge.id))!;
    active.apply({ kind: 'PledgeCreated', signature: 's', slot: 1, rideId: ride.id, sponsor: SPONSOR, driver: DRIVER, pool: 'p', maxLamports: 2_000_000n, lamportsPerKm: 1_000_000n, targetKm: 2 }, ctx.now());
    await ctx.pledges.save(active);
    await expect(create(ride.id)).rejects.toThrow(expect.objectContaining({ errorCode: 'pledge_exists' }));
  });

  it('a target beyond the shift\'s finish line → 400', async () => {
    const { ctx, create } = await setup();
    const ride = await ticketRide(ctx, DRIVER);
    const maxKm = Math.ceil(ride.completeDist / 1000);
    await expect(create(ride.id, 1_000n, maxKm + 1)).rejects.toThrow(BadRequestError);
    expect((await create(ride.id, 1_000n, maxKm)).pledge.targetKm).toBe(maxKm);
  });

  it('a pool that no longer takes pledges (over, or past its play deadline) → 409 pool_not_live', async () => {
    const { ctx, create } = await setup();
    const settled = await ticketRide(ctx, DRIVER, { status: 'settled' });
    await expect(create(settled.id)).rejects.toThrow(expect.objectContaining({ errorCode: 'pool_not_live' }));
    const late = await ticketRide(ctx, DRIVER, { status: 'active', playDeadline: new Date(ctx.now().getTime() - 1) });
    await expect(create(late.id)).rejects.toThrow(expect.objectContaining({ errorCode: 'pool_not_live' }));
  });

  it('refuses: unknown sponsor (404), no paid-play agreements (409), unknown ride (404), sponsor = driver (400), a ride that is over (409), a free ride (409)', async () => {
    const { ctx, create } = await setup();
    const ride = await ticketRide(ctx, DRIVER, {}, true);
    await expect(create(ride.id, 10_000_000n, 5, 'UnknownSponsor')).rejects.toThrow(NotFoundError);
    await expect(create('00000000-0000-4000-8000-000000000099')).rejects.toThrow(NotFoundError);
    await expect(create(ride.id, 10_000_000n, 5, DRIVER)).rejects.toThrow(BadRequestError);
    const free = await ctx.freeRide(DRIVER);
    await expect(create(free.id)).rejects.toThrow(expect.objectContaining({ errorCode: 'ride_not_in_pool' }));
    ride.finish('failed', 'crashed', ctx.now());
    await ctx.rides.save(ride);
    await expect(create(ride.id)).rejects.toThrow(expect.objectContaining({ errorCode: 'ride_not_active' }));
    await ctx.accept(SPONSOR, false);
    await expect(create(ride.id)).rejects.toThrow(ConflictError);
  });

  it('the chain down while building: no transaction (503), the pending row stays for the next ask', async () => {
    const { ctx, create } = await setup();
    const ride = await ticketRide(ctx, DRIVER);
    ctx.poolChain.rpcDown = true;
    await expect(create(ride.id)).rejects.toThrow(/unavailable/i);
    ctx.poolChain.rpcDown = false;
    expect((await create(ride.id)).pledge.status).toBe('pending');
  });
});
