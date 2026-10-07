import { RideTicket } from '../../../src/domain/players/ride-ticket.entity.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';

describe('RideTicket', () => {
  it('opens empty at version 1', () => {
    expect(RideTicket.open('w', 7).snapshot()).toEqual({ wallet: 'w', poolId: 7, balance: 0, bought: 0, version: 1 });
  });

  it('a chain purchase adds to the balance and to what was ever bought – never refused (the program enforced the cap)', () => {
    const t = RideTicket.open('w', 7);
    t.recordPurchase(3);
    t.recordPurchase(8);
    expect(t.snapshot()).toMatchObject({ balance: 11, bought: 11 });
  });

  it('a gift is clamped so the wallet never holds more than the cap, and it does not count as bought', () => {
    const t = RideTicket.open('w', 7);
    expect(t.grant(4, 10)).toBe(4);
    expect(t.grant(9, 10)).toBe(6); // only 6 slots left
    expect(t.grant(1, 10)).toBe(0); // at the cap
    expect(t.snapshot()).toMatchObject({ balance: 10, bought: 0 });
  });

  it('a wallet already above the cap through purchases gets no gift but keeps its tickets', () => {
    const t = RideTicket.restore({ wallet: 'w', poolId: 7, balance: 12, bought: 12, version: 3 });
    expect(t.grant(2, 10)).toBe(0);
    expect(t.balance).toBe(12);
  });

  it('one ticket pays for one ride; at zero it is a 409 with a stable code', () => {
    const t = RideTicket.restore({ wallet: 'w', poolId: 7, balance: 1, bought: 1, version: 1 });
    t.spend();
    expect(t.balance).toBe(0);
    expect(() => t.spend()).toThrow(ConflictError);
    expect(() => t.spend()).toThrow(/no tickets left/);
    try { t.spend(); } catch (e) { expect((e as ConflictError).errorCode).toBe('no_tickets'); }
  });

  it('a failed pool voids what is unused and says how much', () => {
    const t = RideTicket.restore({ wallet: 'w', poolId: 7, balance: 4, bought: 6, version: 1 });
    expect(t.voidAll()).toBe(4);
    expect(t.snapshot()).toMatchObject({ balance: 0, bought: 6 });
    expect(t.voidAll()).toBe(0);
  });

  it('rejects counts that are not whole positive numbers', () => {
    const t = RideTicket.open('w', 7);
    for (const n of [0, -2, 1.5]) {
      expect(() => t.recordPurchase(n)).toThrow(ConflictError);
      expect(() => t.grant(n, 10)).toThrow(ConflictError);
    }
  });
});
