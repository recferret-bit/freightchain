import { ConflictError } from '../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../support/unit-context.js';
import { aPool } from '../../../support/pools.js';

const tx = undefined as never;

describe('PoolTicketsService', () => {
  const setup = async () => {
    const ctx = unitContext();
    const give = async (poolId: number, n: number, wallet = 'w') => { const t = await ctx.tickets.open(wallet, poolId); t.recordPurchase(n); await ctx.tickets.save(t); };
    return { ctx, svc: ctx.poolTickets, give };
  };

  it('balances: rows with tickets in any pool, empty rows only for live pools, unknown pools skipped', async () => {
    const { ctx, svc, give } = await setup();
    await ctx.pools.upsert(aPool({ id: 1, status: 'open' }));
    await ctx.pools.upsert(aPool({ id: 2, status: 'cancelled' }));
    await ctx.pools.upsert(aPool({ id: 3, status: 'settled', maxPerWallet: 9 }));
    await ctx.tickets.open('w', 1); await ctx.tickets.open('w', 2); await give(3, 2); await give(1, 1, 'other');
    expect(await svc.balances('w')).toEqual([
      { poolId: 1, tier: '1h', label: '1 HOUR · test', status: 'open', balance: 0, bought: 0, cap: 5 },
      { poolId: 3, tier: '1h', label: '1 HOUR · test', status: 'settled', balance: 2, bought: 2, cap: 9 },
    ]);
    expect(await svc.balances('nobody')).toEqual([]);
  });

  it('tierHasPools: only open / active pools count', async () => {
    const { ctx, svc } = await setup();
    await ctx.pools.upsert(aPool({ id: 1, tier: '4h', status: 'refunding' }));
    expect(await svc.tierHasPools('4h')).toBe(false);
    await ctx.pools.upsert(aPool({ id: 2, tier: '4h', status: 'open' }));
    expect(await svc.tierHasPools('4h')).toBe(true);
    expect(await svc.tierHasPools('8h')).toBe(false);
  });

  describe('spendForRide', () => {
    it('takes one from the soonest-ending active pool the wallet holds tickets in, with a spend line', async () => {
      const { ctx, svc, give } = await setup();
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', playDeadline: new Date(Date.UTC(2036, 9, 12)) })); // soonest, but no tickets
      await ctx.pools.upsert(aPool({ id: 2, status: 'active', playDeadline: new Date(Date.UTC(2036, 9, 20)) }));
      await ctx.pools.upsert(aPool({ id: 3, status: 'active', playDeadline: new Date(Date.UTC(2036, 9, 15)) }));
      await give(2, 1); await give(3, 2);
      expect((await svc.spendForRide('w', '1h', 'ride-1', ctx.now(), tx)).id).toBe(3);
      expect((await ctx.tickets.find('w', 3))?.balance).toBe(1);
      expect(await ctx.tickets.recentGrants('w', 1)).toEqual([{ wallet: 'w', poolId: 3, delta: -1, source: 'spend', ref: 'ride-1', at: ctx.now() }]);
    });

    it('an open pool waits for its minimum (409 pool_not_live with how many are missing); none at all is 409 no_tickets', async () => {
      const { ctx, svc, give } = await setup();
      await ctx.pools.upsert(aPool({ id: 1, status: 'open', minTickets: 10, ticketsSold: 9 }));
      await expect(svc.spendForRide('w', '1h', 'r', ctx.now(), tx)).rejects.toThrow(new ConflictError('no 1h tickets left', 'no_tickets'));
      await give(1, 1);
      const err = await svc.spendForRide('w', '1h', 'r', ctx.now(), tx).catch((e: ConflictError) => e);
      expect(err).toMatchObject({ message: 'pool not live yet – 1 more ticket needed', errorCode: 'pool_not_live' });
    });

    it('an active pool past its play deadline is skipped', async () => {
      const { ctx, svc, give } = await setup();
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', playDeadline: ctx.now() }));
      await give(1, 1);
      await expect(svc.spendForRide('w', '1h', 'r', ctx.now(), tx)).rejects.toMatchObject({ errorCode: 'no_tickets' });
    });
  });

  describe('grant', () => {
    it('adds up to the pool cap and records what was really added (0 included)', async () => {
      const { ctx, svc, give } = await setup();
      const pool = aPool({ id: 1, maxPerWallet: 3 });
      await ctx.pools.upsert(pool);
      await give(1, 1);
      expect(await svc.grant('w', pool, 5, 'promo', 'HELLO', ctx.now(), tx)).toEqual({ added: 2, balance: 3 });
      expect(await svc.grant('w', pool, 1, 'admin', null, ctx.now(), tx)).toEqual({ added: 0, balance: 3 });
      expect((await ctx.tickets.find('w', 1))?.snapshot()).toMatchObject({ balance: 3, bought: 1 });
      expect((await ctx.tickets.recentGrants('w', 5)).map((g) => [g.source, g.delta])).toEqual([['admin', 0], ['promo', 2]]);
    });

    it('opens the row for a wallet that never had one', async () => {
      const { ctx, svc } = await setup();
      expect(await svc.grant('new', aPool({ id: 1 }), 2, 'promo', 'X', ctx.now(), tx)).toEqual({ added: 2, balance: 2 });
    });
  });
});
