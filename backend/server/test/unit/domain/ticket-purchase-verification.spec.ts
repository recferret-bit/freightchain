import { orderIdFromBytes, orderIdToBytes, verifyTicketPurchase, type OrderForVerification, type TicketBoughtEvent } from '../../../src/domain/economy/ticket-purchase-verification.js';

const WALLET = '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2';
const OTHER = 'GZXqnVpZuyKWdUH34mgijxJVM1LEngoGWoJzEXtXGhBb';
const ORDER: OrderForVerification = { id: '0b5ec9e3-1f2a-4c3d-8e4f-5a6b7c8d9e0f', wallet: WALLET, poolId: 3, qty: 2, lamports: 100_000_000 };
const event = (over: Partial<TicketBoughtEvent> = {}): TicketBoughtEvent => ({
  kind: 'TicketBought', signature: 'sig', index: 0, slot: 1, poolId: 3, buyer: WALLET, qty: 2, lamports: 100_000_000, orderId: ORDER.id, ticketsSold: 9, activated: false, ...over,
});

describe('verifyTicketPurchase', () => {
  it('the purchase the order asked for → null (whatever the pool total or activation)', () => {
    expect(verifyTicketPurchase(event(), ORDER)).toBeNull();
    expect(verifyTicketPurchase(event({ ticketsSold: 10, activated: true, index: 3 }), ORDER)).toBeNull();
    expect(verifyTicketPurchase(event({ orderId: ORDER.id.toUpperCase() }), ORDER)).toBeNull(); // the same 16 bytes
  });

  const cases: [string, Partial<TicketBoughtEvent>, RegExp][] = [
    ['another order id', { orderId: '0b5ec9e3-1f2a-4c3d-8e4f-5a6b7c8d9e10' }, /is not order/],
    ['an order id that is not a uuid', { orderId: 'garbage' }, /is not order/],
    ['another payer', { buyer: OTHER }, /paid by GZX/],
    ['another pool', { poolId: 4 }, /pool 4, the order is for pool 3/],
    ['fewer tickets', { qty: 1, lamports: 50_000_000 }, /1 ticket\(s\) bought, the order is for 2/],
    ['more tickets', { qty: 3 }, /3 ticket\(s\) bought/],
    ['less money', { lamports: 99_999_999 }, /99999999 lamports paid, the order costs 100000000/],
    ['more money', { lamports: 100_000_001 }, /lamports paid/],
  ];
  for (const [name, over, reason] of cases) {
    it(`refuses ${name}`, () => expect(verifyTicketPurchase(event(over), ORDER)).toMatch(reason));
  }

  it('checks the order id first: a stranger\'s purchase names the order mismatch, not the payer', () => {
    expect(verifyTicketPurchase(event({ orderId: '00000000-0000-4000-8000-000000000001', buyer: OTHER }), ORDER)).toMatch(/is not order/);
  });
});

describe('order id ⇄ 16 bytes (the program\'s order_id)', () => {
  it('round-trips, byte order as written', () => {
    const bytes = orderIdToBytes(ORDER.id);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x0b, 0x5e, 0xc9, 0xe3]);
    expect(bytes[15]).toBe(0x0f);
    expect(orderIdFromBytes(bytes)).toBe(ORDER.id);
    expect(orderIdFromBytes(new Uint8Array(16).fill(0xab))).toBe('abababab-abab-abab-abab-abababababab');
  });

  it('refuses what is not a uuid / not 16 bytes', () => {
    expect(() => orderIdToBytes('0b5ec9e31f2a4c3d8e4f5a6b7c8d9e0f')).toThrow(RangeError);
    expect(() => orderIdFromBytes(new Uint8Array(15))).toThrow(RangeError);
  });
});
