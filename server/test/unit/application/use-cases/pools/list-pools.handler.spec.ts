import { ListPoolsHandler } from '../../../../../src/application/use-cases/pools/list-pools/list-pools.handler.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('ListPoolsHandler', () => {
  it('the open and active pools, soonest play deadline first, as DTOs', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', ticketsSold: 12, minTickets: 10, vaultLamports: 600_000_000, sponsored: 0, roundId: 3, playDeadline: new Date(Date.UTC(2036, 9, 30)) }));
    await ctx.pools.upsert(aPool({ id: 2, status: 'open', ticketsSold: 7, minTickets: 10, playDeadline: new Date(Date.UTC(2036, 9, 20)) }));
    await ctx.pools.upsert(aPool({ id: 3, status: 'refunding' }));
    const { pools } = await new ListPoolsHandler(ctx.pools).execute();
    expect(pools.map((p) => p.id)).toEqual([2, 1]);
    expect(pools[0]).toMatchObject({ status: 'open', sold: 7, minTickets: 10, toGo: 3, progressPct: 70 });
    expect(pools[1]).toEqual({
      id: 1, address: aPool({ id: 1 }).address, tier: '1h', label: '1 HOUR · test', status: 'active', priceLamports: 50_000_000, minTickets: 10, maxTickets: 0, maxPerWallet: 5,
      sold: 12, buyers: 0, toGo: 0, progressPct: 100, prepDeadline: aPool().prepDeadline.getTime(), playDeadline: Date.UTC(2036, 9, 30),
      vaultLamports: 600_000_000, sponsoredLamports: 0, potLamports: 600_000_000, split: { prizeBps: 7000, seedBps: 2000, feeBps: 1000 },
      treasuries: { fee: 'FeeTreasury11111111111111111111111111111111', seed: 'SeedTreasury1111111111111111111111111111111' }, roundId: 3,
    });
  });

  it('none registered → an empty list', async () => {
    expect(await new ListPoolsHandler(unitContext().pools).execute()).toEqual({ pools: [] });
  });
});
