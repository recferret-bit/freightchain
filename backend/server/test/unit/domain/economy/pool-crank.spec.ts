import { REFUND_BATCH, SETTLE_GRACE_MS, nextCrankStep, seriesDue } from '../../../../src/domain/economy/pool-crank.js';
import { chainPool } from '../../../support/pools.js';

describe('nextCrankStep – what the crank may do, by the chain clock', () => {
  const now = new Date(Date.UTC(2036, 9, 8, 12));
  const at = (ms: number) => new Date(now.getTime() + ms);
  const pool = chainPool;

  it('an open pool fails once its prep deadline passed under the minimum – not before, not when it reached it', () => {
    expect(nextCrankStep(pool(now, { status: 'open', prepDeadline: at(1), ticketsSold: 3, minTickets: 10 }), now)).toBeNull();
    expect(nextCrankStep(pool(now, { status: 'open', prepDeadline: now, ticketsSold: 3, minTickets: 10 }), now)).toBe('fail_pool');
    expect(nextCrankStep(pool(now, { status: 'open', prepDeadline: at(-1), ticketsSold: 10, minTickets: 10 }), now)).toBeNull(); // the program would refuse NotFailable
    expect(nextCrankStep(pool(now, { status: 'open', prepDeadline: now, ticketsSold: 0, minTickets: 0 }), now)).toBeNull(); // operator-funded: no low-sales fail
  });

  it('an active pool expires 14 days after its play deadline, only with no prize paid', () => {
    expect(SETTLE_GRACE_MS).toBe(14 * 86_400_000);
    expect(nextCrankStep(pool(now, { status: 'active', playDeadline: at(-SETTLE_GRACE_MS + 1) }), now)).toBeNull();
    expect(nextCrankStep(pool(now, { status: 'active', playDeadline: at(-SETTLE_GRACE_MS) }), now)).toBe('expire_pool');
    expect(nextCrankStep(pool(now, { status: 'active', playDeadline: at(-SETTLE_GRACE_MS * 2), prizesPaid: 1 }), now)).toBeNull(); // the admin's (or anyone's) close, not the crank's
  });

  it('a refunding pool is refunded until every ticket is back, then closed; terminal pools are left alone', () => {
    expect(nextCrankStep(pool(now, { status: 'refunding', ticketsSold: 3, priceLamports: 50, refunded: 100 }), now)).toBe('refund');
    expect(nextCrankStep(pool(now, { status: 'refunding', ticketsSold: 3, priceLamports: 50, refunded: 150 }), now)).toBe('close_pool');
    expect(nextCrankStep(pool(now, { status: 'refunding', ticketsSold: 0, refunded: 0 }), now)).toBe('close_pool'); // failed with no buyer
    expect(nextCrankStep(pool(now, { status: 'settled' }), at(SETTLE_GRACE_MS * 9))).toBeNull();
    expect(nextCrankStep(pool(now, { status: 'cancelled' }), at(SETTLE_GRACE_MS * 9))).toBeNull();
    expect(REFUND_BATCH).toBe(8);
  });
});


describe('v6 schedule crank', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  it('stops sealing after last start so expiry is reachable', () => {
    const p = chainPool(now, { status: 'active', sealSlot: 8, createdAt: new Date(0), lastStartAt: new Date(now.getTime() - 1), payoutAt: new Date(now.getTime() - SETTLE_GRACE_MS) });
    expect(nextCrankStep(p, now)).toBe('expire_pool');
    expect(nextCrankStep({ ...p, lastStartAt: now }, now)).toBe('seal_road');
  });
  it('opens on the weekly grid only while sales are still open, including a late crank', () => {
    const s = { enabled: true, nextOpenAt: now, saleSecs: 5 * 86400, periodSecs: 7 * 86400 } as Parameters<typeof seriesDue>[0];
    const at = (days: number) => new Date(now.getTime() + days * 86400000);
    expect([-1, 0, 4, 5, 6, 7, 11, 12].map(d => seriesDue(s, at(d)))).toEqual([false, true, true, false, false, true, true, false]);
    expect(seriesDue({ ...s, enabled: false }, now)).toBe(false);
  });
});
