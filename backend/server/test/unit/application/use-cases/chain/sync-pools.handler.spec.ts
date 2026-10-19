import { SyncPoolsHandler } from '../../../../../src/application/use-cases/chain/sync-pools/sync-pools.handler.js';
import { aPool, chainPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('SyncPoolsHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    return { ctx, sync: () => new SyncPoolsHandler(ctx.pools, ctx.registry).execute() };
  };

  it('re-reads every live pool from chain: the chain wins, drifts are reported field by field, label and round are kept', async () => {
    const { ctx, sync } = setup();
    await ctx.pools.upsert(aPool({ id: 1, status: 'open', minTickets: 10, ticketsSold: 2, buyers: 2, vaultLamports: 100_000_000, label: 'MINE', roundId: 4 }, ctx.now()));
    await ctx.pools.upsert(aPool({ id: 2, status: 'active', ticketsSold: 3, buyers: 2, vaultLamports: 150_000_000, minTickets: 10 }, ctx.now()));
    await ctx.pools.upsert(aPool({ id: 3, status: 'settled' }, ctx.now())); // not live: not read
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), { poolId: 1, ticketsSold: 3, buyers: 2, escrowLamports: 150_000_000 }));
    ctx.poolChain.pools.set(2, chainPool(ctx.now(), { poolId: 2, address: 'PoolPda2', status: 'active', ticketsSold: 3, buyers: 2, escrowLamports: 150_000_000 }));
    expect(await sync()).toEqual({
      synced: 2, missing: [],
      drifted: [{ poolId: 1, changes: ['ticketsSold: 2 → 3', 'vaultLamports: 100000000 → 150000000'] }],
    });
    expect((await ctx.pools.findById(1))?.snapshot()).toMatchObject({ ticketsSold: 3, label: 'MINE', roundId: 4, syncedAt: ctx.now() });
    expect(ctx.poolChain.readCount).toBe(0); // readPool, not readEvents
  });

  it('a pool with no account on chain is reported missing and left alone', async () => {
    const { ctx, sync } = setup();
    await ctx.pools.upsert(aPool({ id: 7, status: 'open' }, ctx.now()));
    expect(await sync()).toEqual({ synced: 0, drifted: [], missing: [7] });
    expect((await ctx.pools.findById(7))?.snapshot().syncedAt).toBeNull();
  });

  it('the RPC down is a 503', async () => {
    const { ctx, sync } = setup();
    await ctx.pools.upsert(aPool({ id: 1, status: 'open' }, ctx.now()));
    ctx.poolChain.rpcDown = true;
    await expect(sync()).rejects.toMatchObject({ statusCode: 503 });
  });
});
