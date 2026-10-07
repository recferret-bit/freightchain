import type { PurchaseEvent } from '../../../../src/application/services/ticket-settlement.service.js';
import { TicketOrder } from '../../../../src/domain/economy/ticket-order.entity.js';
import { unitContext } from '../../../support/unit-context.js';
import { aPool } from '../../../support/pools.js';
import { TREASURY } from '../../../support/fake-chain.js';

const BUYER = TREASURY; // any valid base58 address
const PRICE = 50_000_000;

describe('TicketSettlementService', () => {
  const setup = async (pool: Parameters<typeof aPool>[0] = {}) => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, minTickets: 3, ...pool }, ctx.now()));
    const bought = (over: Partial<PurchaseEvent> = {}): PurchaseEvent =>
      ({ kind: 'TicketBought', signature: 'sig1', index: 0, slot: 1, poolId: 1, buyer: BUYER, qty: 2, lamports: 2 * PRICE, orderId: '', ticketsSold: 2, activated: false, ...over });
    const order = async (qty = 2) => {
      await ctx.player(BUYER);
      const o = TicketOrder.create({ id: ctx.entropy.uuid(), wallet: BUYER, pool: (await ctx.pools.findById(1))!, qty, walletBought: 0, now: ctx.now() });
      await ctx.orders.insert(o);
      return o;
    };
    return { ctx, svc: ctx.ticketSettlement, bought, order };
  };

  describe('settlePurchase', () => {
    it('pays the order it names: order paid, tickets credited with a payment line, pool counters from the event', async () => {
      const { ctx, svc, bought, order } = await setup();
      const o = await order();
      const r = await svc.settlePurchase(bought({ orderId: o.id }));
      expect(r).toMatchObject({ outcome: 'settled', balance: 2 });
      expect((await ctx.orders.findById(o.id))?.snapshot()).toMatchObject({ status: 'paid', signature: 'sig1', eventIndex: 0, paidAt: ctx.now() });
      expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 2, bought: 2 });
      expect(await ctx.tickets.recentGrants(BUYER, 5)).toEqual([{ wallet: BUYER, poolId: 1, delta: 2, source: 'payment', ref: 'sig1', at: ctx.now() }]);
      expect((await ctx.pools.findById(1))?.snapshot()).toMatchObject({ status: 'open', ticketsSold: 2, buyers: 1, vaultLamports: 2 * PRICE });
    });

    it('is idempotent: the same (signature, index) again is a duplicate that changes nothing', async () => {
      const { ctx, svc, bought, order } = await setup();
      const o = await order();
      await svc.settlePurchase(bought({ orderId: o.id }));
      expect(await svc.settlePurchase(bought({ orderId: o.id }))).toMatchObject({ outcome: 'duplicate', order: { id: o.id } });
      expect((await ctx.tickets.find(BUYER, 1))?.balance).toBe(2);
    });

    it('money in = tickets out: no order, a mismatching one or one already paid → a paid order is adopted; the named order stays as it was', async () => {
      const { ctx, svc, bought, order } = await setup();
      expect(await svc.settlePurchase(bought())).toMatchObject({ outcome: 'applied', detail: 'no order', balance: 2 }); // straight from an explorer, never signed in
      expect(await ctx.storedPlayer(BUYER)).toBeTruthy();
      const o = await order(1);
      expect(await svc.settlePurchase(bought({ signature: 'sig2', orderId: o.id, ticketsSold: 4 }))).toMatchObject({ outcome: 'applied', detail: 'paid for 2 tickets, ordered 1', balance: 4 });
      expect((await ctx.orders.findById(o.id))?.status).toBe('awaiting_payment');
      expect(await ctx.orders.totalsOf(BUYER)).toEqual({ lamports: 4 * PRICE, tickets: 4 });
      expect((await ctx.pools.findById(1))?.snapshot()).toMatchObject({ buyers: 1, ticketsSold: 4 });
    });

    it('the purchase that reaches the minimum activates the pool and ranks it in the current round', async () => {
      const { ctx, svc, bought } = await setup();
      await svc.settlePurchase(bought({ qty: 3, lamports: 3 * PRICE, ticketsSold: 3, activated: true }));
      const round = await ctx.rounds.ensureRound();
      expect((await ctx.pools.findById(1))?.snapshot()).toMatchObject({ status: 'active', roundId: round.id });
    });

    it('a pool not in the mirror is unmatched (nothing written); a purchase seen after the pool failed is refundable, not rideable', async () => {
      const { ctx, svc, bought } = await setup({ status: 'refunding' });
      expect(await svc.settlePurchase(bought({ poolId: 9 }))).toEqual({ outcome: 'unmatched', detail: 'pool 9 is not registered' });
      expect(await svc.settlePurchase(bought())).toMatchObject({ outcome: 'applied', balance: 0 });
      expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 0, bought: 2 });
      expect((await ctx.poolTickets.balances(BUYER))[0]).toMatchObject({ refundable: true });
    });
  });

  describe('applyPoolEvent', () => {
    it('PoolFailed: refunding, and every unused ticket of the pool is voided once', async () => {
      const { ctx, svc, bought } = await setup();
      await svc.settlePurchase(bought());
      expect(await svc.applyPoolEvent({ kind: 'PoolFailed', signature: 's', index: 0, slot: 2, poolId: 1, ticketsSold: 2 })).toMatchObject({ outcome: 'applied', voided: 2 });
      expect((await ctx.pools.findById(1))?.status).toBe('refunding');
      expect((await ctx.tickets.find(BUYER, 1))?.balance).toBe(0);
      expect(await svc.applyPoolEvent({ kind: 'PoolFailed', signature: 's', index: 0, slot: 2, poolId: 1, ticketsSold: 2 })).toMatchObject({ voided: 0 }); // replay
    });

    it('PoolActivated ranks the pool in the round; an impossible transition is invalid (re-sync), an unknown pool unmatched', async () => {
      const { ctx, svc } = await setup();
      await svc.applyPoolEvent({ kind: 'PoolActivated', signature: 's', index: 0, slot: 2, poolId: 1, ticketsSold: 3 });
      expect((await ctx.pools.findById(1))?.snapshot()).toMatchObject({ status: 'active', roundId: (await ctx.rounds.ensureRound()).id });
      expect(await svc.applyPoolEvent({ kind: 'PoolFailed', signature: 's2', index: 0, slot: 3, poolId: 1, ticketsSold: 3 })).toEqual({ outcome: 'invalid', detail: 'pool 1 is active, expected open' });
      expect(await svc.applyPoolEvent({ kind: 'PoolCreated', signature: 's3', index: 0, slot: 3, poolId: 7 })).toMatchObject({ outcome: 'unmatched' });
    });
  });

  describe('settleRefund', () => {
    it('the buyer\'s paid orders become refunded and its row holds nothing paid (no longer refundable)', async () => {
      const { ctx, svc, bought, order } = await setup();
      const o = await order();
      await svc.settlePurchase(bought({ orderId: o.id }));
      await svc.applyPoolEvent({ kind: 'PoolFailed', signature: 'f', index: 0, slot: 2, poolId: 1, ticketsSold: 2 });
      const r = await svc.settleRefund({ kind: 'Refunded', signature: 'r', index: 0, slot: 3, poolId: 1, buyer: BUYER, rentPayer: BUYER, qty: 2, lamports: 2 * PRICE, refundedTotal: 2 * PRICE });
      expect(r).toMatchObject({ outcome: 'applied' });
      expect((await ctx.orders.findById(o.id))?.snapshot()).toMatchObject({ status: 'refunded', refundedAt: ctx.now() });
      expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 0, bought: 0 });
      expect(await ctx.poolTickets.balances(BUYER)).toEqual([]);
      expect((await ctx.pools.findById(1))?.snapshot().vaultLamports).toBe(0);
      expect((await ctx.tickets.recentGrants(BUYER, 1))[0]).toMatchObject({ source: 'refund', delta: 0, ref: 'r' });
    });

    it('a refund of a pool that is not refunding is invalid', async () => {
      const { svc } = await setup({ status: 'active' });
      expect(await svc.settleRefund({ kind: 'Refunded', signature: 'r', index: 0, slot: 3, poolId: 1, buyer: BUYER, rentPayer: BUYER, qty: 1, lamports: PRICE, refundedTotal: PRICE }))
        .toMatchObject({ outcome: 'invalid' });
    });
  });
});
