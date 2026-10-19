import { TicketOrder } from '../../../src/domain/economy/ticket-order.entity.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';
import { aPool } from '../../support/pools.js';

const T0 = new Date(Date.UTC(2036, 9, 8, 12));
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const TTL = 3_600_000;
const order = (qty = 2, walletBought = 0) => TicketOrder.create({ id: 'o1', wallet: 'w', pool: aPool({ id: 4 }, T0), qty, walletBought, now: T0 });

describe('TicketOrder', () => {
  it('is priced by the pool and awaits payment until the TTL', () => {
    const o = order();
    expect(o.snapshot()).toMatchObject({ poolId: 4, qty: 2, lamports: 100_000_000, status: 'awaiting_payment', signature: null });
    expect(o.isLive(at(3599), TTL)).toBe(true);
    expect(o.isLive(at(3600), TTL)).toBe(false);
    expect(o.expiresAt(TTL)).toEqual(at(3600));
  });

  it('cannot be created for what the pool would refuse', () => {
    expect(() => order(6)).toThrow(new ConflictError('at most 5 tickets per wallet in this pool', 'not_sellable'));
    expect(() => order(1, 5)).toThrow(ConflictError);
    expect(() => TicketOrder.create({ id: 'x', wallet: 'w', pool: aPool({ status: 'refunding' }, T0), qty: 1, walletBought: 0, now: T0 })).toThrow('this pool is refunding');
  });

  it('whyNotPaidBy: buyer, pool, quantity and amount must all match', () => {
    const o = order();
    const e = { buyer: 'w', poolId: 4, qty: 2, lamports: 100_000_000 };
    expect(o.whyNotPaidBy(e)).toBeNull();
    expect(o.whyNotPaidBy({ ...e, buyer: 'x' })).toBe('paid by another wallet');
    expect(o.whyNotPaidBy({ ...e, poolId: 5 })).toBe('paid into another pool');
    expect(o.whyNotPaidBy({ ...e, qty: 1 })).toBe('paid for 1 tickets, ordered 2');
    expect(o.whyNotPaidBy({ ...e, lamports: 1 })).toBe('paid 1 lamports, ordered 100000000');
  });

  it('paid (also after it lapsed), reopened when its transaction was dropped, refunded once', () => {
    const o = order();
    o.expire();
    o.markPaid('sig', 0, at(10));
    expect(o.snapshot()).toMatchObject({ status: 'paid', paidAt: at(10), signature: 'sig', eventIndex: 0 });
    expect(() => o.markPaid('sig2', 0, at(11))).toThrow(new ConflictError('order is paid'));
    o.reopen();
    expect(o.snapshot()).toMatchObject({ status: 'awaiting_payment', paidAt: null, signature: null });
    o.markPaid('sig3', 1, at(12));
    o.markRefunded(at(20));
    o.markRefunded(at(21));
    expect(o.snapshot()).toMatchObject({ status: 'refunded', refundedAt: at(20) });
    expect(() => order().markRefunded(at(1))).toThrow(ConflictError);
  });

  it('keeps the transaction it was sent while awaiting payment', () => {
    const o = order();
    o.attachTransaction('bWVzc2FnZQ==', 1234);
    expect(o.snapshot()).toMatchObject({ txMessage: 'bWVzc2FnZQ==', lastValidBlockHeight: 1234 });
    o.markPaid('s', 0, at(1));
    expect(() => o.attachTransaction('x', 1)).toThrow(ConflictError);
  });

  it('adopt: a purchase without a matching order becomes a paid order of its own', () => {
    expect(TicketOrder.adopt({ id: 'a1', wallet: 'w', poolId: 4, qty: 3, lamports: 150_000_000, signature: 's', eventIndex: 2, now: T0 }).snapshot())
      .toMatchObject({ status: 'paid', paidAt: T0, qty: 3, signature: 's', eventIndex: 2 });
  });
});
