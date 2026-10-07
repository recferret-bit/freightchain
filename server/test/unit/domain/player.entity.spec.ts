import { Player } from '../../../src/domain/players/player.entity.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';
import { nextUtcMidnight } from '../../../src/domain/shared/time.js';

const WED = new Date('2026-10-07T12:00:00.000Z');
const NEXT_DAY = new Date('2026-10-08T00:00:01.000Z');

describe('Player', () => {
  it('registers with the signup credits and the cap on today', () => {
    expect(Player.register('w', WED, 5, 5).snapshot()).toEqual({ wallet: 'w', version: 1, freeRides: 5, freeDay: '2026-10-07', freeRidesMax: 5, createdAt: WED });
  });

  it('grants +1 free ride once per UTC day, no backlog', () => {
    const p = Player.register('w', WED, 2, 5);
    expect(p.applyDailyGrant(new Date('2026-10-07T23:59:59.000Z'))).toBe(false); // same day
    expect(p.applyDailyGrant(NEXT_DAY)).toBe(true);
    expect(p.applyDailyGrant(NEXT_DAY)).toBe(false);
    expect(p.freeRides).toBe(3);
    expect(p.applyDailyGrant(new Date('2026-10-20T00:00:00.000Z'))).toBe(true); // a week away still gives ONE
    expect(p.freeRides).toBe(4);
  });

  it('never grants above the cap – the day is still stamped, an over-cap balance is left alone', () => {
    const full = Player.register('w', WED, 5, 5);
    expect(full.applyDailyGrant(NEXT_DAY)).toBe(true);
    expect(full.freeRides).toBe(5);
    expect(full.freeDay).toBe('2026-10-08');
    expect(full.awaitsDailyGrant).toBe(false);
    const over = Player.restore({ ...Player.register('o', WED, 5, 5).snapshot(), freeRides: 8 });
    over.applyDailyGrant(NEXT_DAY);
    expect(over.freeRides).toBe(8);
    const spent = Player.register('s', WED, 5, 5);
    spent.spendFreeRide();
    expect(spent.awaitsDailyGrant).toBe(true);
  });

  it('spends and refunds credits; cannot go below zero, nor refund above the cap (a legacy over-cap balance still gets its credit)', () => {
    const p = Player.register('w', WED, 1, 5);
    p.spendFreeRide();
    expect(p.freeRides).toBe(0);
    expect(() => p.spendFreeRide()).toThrow(new ConflictError('no free rides left'));
    p.refundFreeRide();
    expect(p.freeRides).toBe(1);
    const full = Player.register('f', WED, 5, 5);
    full.refundFreeRide();
    expect(full.freeRides).toBe(5);
    const legacy = Player.restore({ ...Player.register('l', WED, 5, 5).snapshot(), freeRides: 8 });
    legacy.refundFreeRide();
    expect(legacy.freeRides).toBe(9);
  });
});

describe('nextUtcMidnight', () => {
  it('is the next 00:00 UTC, strictly after the instant', () => {
    expect(nextUtcMidnight(WED).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(nextUtcMidnight(new Date('2026-10-07T23:59:59.999Z')).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(nextUtcMidnight(new Date('2026-10-08T00:00:00.000Z')).toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });
});
