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
    const rideBy = (id: number) => { const s = aPool({ id }).snapshot(); return Math.min(s.playDeadline.getTime() - 75 * 60_000, s.playDeadline.getTime() - 3600_000); };
    expect(await svc.balances('w', ctx.now())).toEqual([
      { poolId: 1, tier: '1h', label: '1 HOUR · test', status: 'open', balance: 0, bought: 0, cap: 5, refundable: false, ridable: false, rideBy: rideBy(1), burned: false },
      { poolId: 3, tier: '1h', label: '1 HOUR · test', status: 'settled', balance: 2, bought: 2, cap: 9, refundable: false, ridable: false, rideBy: rideBy(3), burned: false },
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

    it('a shift that cannot finish before play close, while last start is still ahead, is 409 rides_closed and the ticket is kept', async () => {
      const { ctx, svc, give } = await setup();
      const play = new Date(ctx.now().getTime() + 5_000_000);
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', playDeadline: play }, ctx.now()));
      await give(1, 1);
      const startBy = new Date(play.getTime() - 7200_000);
      await expect(svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 7200)).rejects.toMatchObject({ errorCode: 'rides_closed', message: `rides for pool #1 closed at ${startBy.toISOString()}` });
      expect((await ctx.tickets.find('w', 1))?.balance).toBe(1);
      expect((await svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 400)).id).toBe(1);
    });

    it('program v4 (audit L4): a pool whose road is not sealed yet spends nothing – 409 road_not_sealed, the ticket kept; once sealed it rides', async () => {
      const { ctx, svc, give } = await setup();
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', sealSlot: 900 }));
      await give(1, 1);
      await expect(svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 60)).rejects.toMatchObject({ errorCode: 'road_not_sealed' });
      expect((await ctx.tickets.find('w', 1))?.balance).toBe(1);
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', sealSlot: 0, seedCommitment: Buffer.alloc(32, 5).toString('base64') }));
      expect((await svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 60)).id).toBe(1);
    });

    it('sales can close before the last start; after lastStartAt the unused ticket burns (409 pool_last_start_passed, no refund)', async () => {
      const { ctx, svc, give } = await setup();
      const sale = new Date(ctx.now().getTime() - 1_000);
      const play = new Date(sale.getTime() + 3 * 3600_000);
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', prepDeadline: sale, playDeadline: play }, ctx.now()));
      await give(1, 2);
      expect((await svc.spendForRide('w', '1h', 'r', ctx.now(), tx, 60)).id).toBe(1);
      const last = new Date(play.getTime() - 75 * 60_000);
      await expect(svc.spendForRide('w', '1h', 'r2', new Date(last.getTime() + 1), tx, 60)).rejects.toMatchObject({ errorCode: 'pool_last_start_passed' });
      expect((await ctx.tickets.find('w', 1))?.balance).toBe(0);
      expect(await svc.balances('w', new Date(last.getTime() + 1))).toMatchObject([{ poolId: 1, balance: 0, burned: false, refundable: false }]);
    });

    it('balances: ridable until lastStartAt; rideBy is that instant for a 1h shift', async () => {
      const { ctx, svc, give } = await setup();
      const now = ctx.now(), deadline = new Date(now.getTime() + 2 * 3600_000), startBy = deadline.getTime() - 75 * 60_000;
      await ctx.pools.upsert(aPool({ id: 1, status: 'active', playDeadline: deadline }, now));
      await give(1, 1);
      expect(await svc.balances('w', now)).toMatchObject([{ poolId: 1, balance: 1, ridable: true, rideBy: startBy, burned: false }]);
      expect(await svc.balances('w', new Date(startBy + 1))).toMatchObject([{ poolId: 1, balance: 0, ridable: false, rideBy: startBy, burned: true }]);
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
