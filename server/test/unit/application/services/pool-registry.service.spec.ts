import { unitContext } from '../../../support/unit-context.js';
import { aPool, chainPool } from '../../../support/pools.js';

describe('PoolRegistryService', () => {
  it('registers a pool from its account; null when there is no such account', async () => {
    const ctx = unitContext();
    ctx.poolChain.pools.set(1, chainPool(ctx.now()));
    expect((await ctx.registry.syncFromChain(1, 'week 42'))?.snapshot()).toMatchObject({ id: 1, tier: '1h', label: 'week 42', ticketsSold: 3, vaultLamports: 150_000_000, syncedAt: ctx.now() });
    expect((await ctx.pools.findById(1))?.snapshot().label).toBe('week 42');
    expect(await ctx.registry.syncFromChain(2)).toBeNull();
  });

  it('a re-sync takes the chain\'s state but keeps the stored label and ranking round', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, label: 'mine', roundId: 4, ticketsSold: 1 }, ctx.now()));
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), { status: 'active', ticketsSold: 11 }));
    expect((await ctx.registry.syncFromChain(1))?.snapshot()).toMatchObject({ label: 'mine', roundId: 4, status: 'active', ticketsSold: 11 });
  });
});
