import { Player } from '../../../src/domain/players/player.entity.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';

const WED = new Date('2026-10-07T12:00:00.000Z');
const NEXT_DAY = new Date('2026-10-08T00:00:01.000Z');

describe('Player', () => {
  it('registers with the signup credits on today', () => {
    expect(Player.register('w', WED, 5).snapshot()).toEqual({ wallet: 'w', version: 1, freeRides: 5, freeDay: '2026-10-07', createdAt: WED });
  });

  it('grants +1 free ride once per UTC day, no backlog', () => {
    const p = Player.register('w', WED, 5);
    expect(p.applyDailyGrant(new Date('2026-10-07T23:59:59.000Z'))).toBe(false); // same day
    expect(p.applyDailyGrant(NEXT_DAY)).toBe(true);
    expect(p.applyDailyGrant(NEXT_DAY)).toBe(false);
    expect(p.freeRides).toBe(6);
    expect(p.applyDailyGrant(new Date('2026-10-20T00:00:00.000Z'))).toBe(true); // a week away still gives ONE
    expect(p.freeRides).toBe(7);
  });

  it('spends and refunds credits; cannot go below zero', () => {
    const p = Player.register('w', WED, 1);
    p.spendFreeRide();
    expect(p.freeRides).toBe(0);
    expect(() => p.spendFreeRide()).toThrow(new ConflictError('no free rides left'));
    p.refundFreeRide();
    expect(p.freeRides).toBe(1);
  });
});
