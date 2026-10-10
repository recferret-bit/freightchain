import { Player } from '../../../src/domain/players/player.entity.js';
import { BadRequestError, ConflictError } from '../../../src/domain/shared/errors.js';
import { nextUtcMidnight } from '../../../src/domain/shared/time.js';

const WED = new Date('2026-10-07T12:00:00.000Z');
const NEXT_DAY = new Date('2026-10-08T00:00:01.000Z');

describe('Player', () => {
  it('marks the tutorial as passed once: the first stamp stays, a second ride with it on changes nothing', () => {
    const p = Player.register('w', WED, 5, 5);
    expect(p).toMatchObject({ tutorialPassed: false, tutorialPassedAt: null });
    expect(p.markTutorialPassed(WED)).toBe(true);
    expect(p.markTutorialPassed(NEXT_DAY)).toBe(false);
    expect(p).toMatchObject({ tutorialPassed: true, tutorialPassedAt: WED });
    expect(Player.restore(p.snapshot()).tutorialPassed).toBe(true);
  });

  it('registers with the signup credits and the cap on today', () => {
    expect(Player.register('w', WED, 5, 5).snapshot()).toEqual({ wallet: 'w', version: 1, freeRides: 5, freeDay: '2026-10-07', freeRidesMax: 5, createdAt: WED, tutorialPassedAt: null });
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

describe('Player – admin adjust and the live daily cap', () => {
  it('setDailyCap replaces the stored max and does not touch the balance', () => {
    const p = Player.register('w', WED, 10, 5);
    expect(p.setDailyCap(5)).toBe(false);
    expect(p.setDailyCap(2)).toBe(true);
    expect([p.freeRides, p.freeRidesMax]).toEqual([10, 2]);
  });
  it('adjustFreeRides adds and removes, and refuses a floor, a ceiling and a zero', () => {
    const p = Player.register('w', WED, 10, 5);
    p.adjustFreeRides(100);
    expect(p.freeRides).toBe(110);
    p.adjustFreeRides(-110);
    expect(p.freeRides).toBe(0);
    expect(() => p.adjustFreeRides(-1)).toThrow(new ConflictError('that would take the free rides below zero', 'free_rides_floor'));
    p.adjustFreeRides(100_000);
    expect(() => p.adjustFreeRides(1)).toThrow(new ConflictError('that would take the free rides above the limit', 'free_rides_ceiling'));
    expect(() => p.adjustFreeRides(0)).toThrow();
  });
});

describe('Player – promo free rides', () => {
  it('adds on top of the daily ones and may go above the cap', () => {
    const p = Player.register('w', WED, 5, 5);
    p.grantFreeRides(3);
    expect([p.freeRides, p.freeRidesMax]).toEqual([8, 5]);
  });
  it('the daily grant neither adds to nor takes from a balance above the cap, and the countdown stays off', () => {
    const p = Player.register('w', WED, 5, 5);
    p.grantFreeRides(3);
    expect(p.awaitsDailyGrant).toBe(false);
    expect(p.applyDailyGrant(new Date(WED.getTime() + 86_400_000))).toBe(true); // the day is stamped…
    expect(p.freeRides).toBe(8); // …nothing else changes
  });
  it('spending comes off the extra rides first-come like any other, and the daily refill resumes below the cap', () => {
    const p = Player.register('w', WED, 5, 5);
    p.grantFreeRides(2);
    for (let i = 0; i < 4; i++) p.spendFreeRide();
    expect(p.freeRides).toBe(3);
    expect(p.awaitsDailyGrant).toBe(true);
  });
  it('refuses a zero, negative or fractional count', () => {
    const p = Player.register('w', WED, 5, 5);
    for (const n of [0, -1, 1.5]) expect(() => p.grantFreeRides(n)).toThrow();
  });
});

describe('Player – daily cap and an admin adjust', () => {
  it('registers a new wallet at 10 with a daily cap of 5', () => {
    expect(Player.register('w', WED, 10, 5).snapshot()).toMatchObject({ freeRides: 10, freeRidesMax: 5, freeDay: '2026-10-07' });
  });

  it('setDailyCap moves the cap and leaves the balance; an unchanged cap is a no-op', () => {
    const p = Player.register('w', WED, 10, 5);
    expect(p.setDailyCap(5)).toBe(false);
    expect(p.setDailyCap(2)).toBe(true);
    expect([p.freeRides, p.freeRidesMax]).toEqual([10, 2]);
    for (const n of [-1, 1.5]) expect(() => p.setDailyCap(n)).toThrow(BadRequestError);
    expect(p.freeRidesMax).toBe(2);
  });

  it('adjustFreeRides adds and removes, and refuses zero, a negative result and the hard ceiling', () => {
    const p = Player.register('w', WED, 10, 5);
    expect(() => p.adjustFreeRides(0)).toThrow(BadRequestError);
    p.adjustFreeRides(100);
    expect(p.freeRides).toBe(110);
    expect(() => p.adjustFreeRides(-111)).toThrow(ConflictError);
    try { p.adjustFreeRides(-111); } catch (e) { expect(e).toMatchObject({ errorCode: 'free_rides_floor' }); }
    expect(() => p.adjustFreeRides(100_000)).toThrow(ConflictError);
    try { p.adjustFreeRides(100_000); } catch (e) { expect(e).toMatchObject({ errorCode: 'free_rides_ceiling' }); }
    expect(p.freeRides).toBe(110);
    p.adjustFreeRides(-110);
    expect(p.freeRides).toBe(0);
  });
});

describe('nextUtcMidnight', () => {
  it('is the next 00:00 UTC, strictly after the instant', () => {
    expect(nextUtcMidnight(WED).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(nextUtcMidnight(new Date('2026-10-07T23:59:59.999Z')).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(nextUtcMidnight(new Date('2026-10-08T00:00:00.000Z')).toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });
});
