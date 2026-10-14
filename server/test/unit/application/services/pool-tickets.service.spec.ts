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
    const rideBy = (id: number) => { const s = aPool({ id }).snapshot(); return Math.min(s.prepDeadline.getTime(), s.playDeadline.getTime() - 3600_000); };   // the last start: the sale end, or earlier when a 1 h shift could not end by the play deadline
    expect(await svc.balances('w', ctx.now())).toEqual([
      { poolId: 1, tier: '1h', label: '1 HOUR · test', status: 'open', balance: 0, bought: 0, cap: 5, refundable: false, ridable: false, rideBy: rideBy(1) },
      { poolId: 3, tier: '1h', label: '1 HOUR · test', status: 'settled', balance: 2, bought: 2, cap: 9, refundable: false, ridable: false, rideBy: rideBy(3) },
    ]);
    expect(await svc.balances('nobody', ctx.now())).toEqual([]);
  });

  it('balances: a failed pool the wallet paid into stays listed as refundable until its refund lands (bought → 0)', async () => {
    const { ctx, svc, give } = await setup();
    await ctx.pools.upsert(aPool({ id: 1, status: 'refunding' }));
    await give(1, 2);
    const t = (await ctx.tickets.find('w', 1))!;
    t.voidAll(); await ctx.tickets.save(t);
    expect(await svc.balances('w', ctx.now())).toMatchObject([{ poolId: 1, status: 'refunding', balance: 0, bought: 2, refundable: true }]);
    const r = (await ctx.tickets.find('w', 1))!;
    expect(r.markRefunded()).toBe(2); await ctx.tickets.save(r);
    expect(await svc.balances('w', ctx.now())).toEqual([]);
  });

  it('balances: an open pool that missed its goal is refundable at once (the refund transaction fails it first) – not before its deadline', async () => {
    const { ctx, svc, give } = await setup();
    const now = ctx.now();
    await ctx.pools.upsert(aPool({ id: 1, status: 'open', minTickets: 10, ticketsSold: 2, prepDeadline: new Date(now.getTime() + 1_000) }, now));
    await give(1, 2);
    expect(await svc.balances('w', now)).toMatchObject([{ poolId: 1, status: 'open', refundable: false }]);
    expect(await svc.balances('w', new Date(now.getTime() + 1_000))).toMatchObject([{ poolId: 1, status: 'open', refundable: true }]);
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

    it('an active pool where a shift started now would end after its play deadline is skipped; holding only such tickets is 409 rides_closed with the pool and the deadline', async () => {
      const { ctx, svc, give } = await setup();
      const tooSoon = new Date(ctx.now().getTime() + 3599_000);   // a 1 h shift started now would end a second late
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', playDeadline: tooSoon }));
      await give(1, 1);
      await expect(svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 3600)).rejects.toMatchObject({ errorCode: 'rides_closed', message: `rides for pool #1 closed at ${new Date(tooSoon.getTime() - 3600_000).toISOString()}` });   // the last start
      expect((await svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 60)).id).toBe(1);   // a demo shift of 60 s still fits (the ride's own minSeconds)
      await give(1, 1);
      await ctx.pools.upsert(aPool({ id: 2, status: 'active', playDeadline: new Date(ctx.now().getTime() + 3600_000) }));
      await give(2, 1);
      expect((await svc.spendForRide('w', '1h', 'r', ctx.now(), tx)).id).toBe(2);
      expect((await ctx.tickets.find('w', 1))?.balance).toBe(1);
    });

    it('no new ride after the sale end: a live pool past its prep deadline spends nothing, however long its play window still runs (3 h to finish)', async () => {
      const { ctx, svc, give } = await setup();
      const sale = new Date(ctx.now().getTime() - 1_000);
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', prepDeadline: sale, playDeadline: new Date(sale.getTime() + 3 * 3600_000) }));
      await give(1, 1);
      await expect(svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 60)).rejects.toMatchObject({ errorCode: 'rides_closed', message: `rides for pool #1 closed at ${sale.toISOString()}` });
      expect(await svc.balances('w', ctx.now())).toMatchObject([{ poolId: 1, balance: 1, ridable: false, rideBy: sale.getTime() }]);
    });

    it('balances: ridable only while the pool is live and a shift started now ends by its play deadline; rideBy is that last start', async () => {
      const { ctx, svc, give } = await setup();
      const now = ctx.now(), deadline = new Date(now.getTime() + 3660_000), startBy = deadline.getTime() - 3600_000;
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', playDeadline: deadline }));
      await give(1, 1);
      expect(await svc.balances('w', now)).toMatchObject([{ poolId: 1, balance: 1, ridable: true, rideBy: startBy }]);
      expect(await svc.balances('w', new Date(startBy + 1))).toMatchObject([{ poolId: 1, balance: 1, ridable: false, rideBy: startBy }]);
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
