import { EVENT_PRIZE_TABLE_CENTS, eventAttemptBps, eventPrizeGeoEligible, parsePrizeTable, settleFixedTableBoard, type EventEntry } from '../../../../src/domain/prize/event-settlement.js';

const T = EVENT_PRIZE_TABLE_CENTS;
const total = (t: readonly number[]) => t.reduce((s, c) => s + c, 0);
const e = (wallet: string, bps: number, extra: Partial<EventEntry> = {}): EventEntry => ({ wallet, rideId: `r-${wallet}`, bps, prizeEligible: true, ...extra });
const field = (n: number): EventEntry[] => Array.from({ length: n }, (_, i) => e(`w${String(i).padStart(2, '0')}`, 9000 - i * 10));
const paid = (s: ReturnType<typeof settleFixedTableBoard>) => Object.fromEntries(s.rows.map((r) => [r.wallet, r.amountCents]));
const hold = (s: ReturnType<typeof settleFixedTableBoard>, t: readonly number[] = T) => expect(s.paidCents + s.organizerCents).toBe(total(t));

describe('the default table', () => {
  it('is the owner decision: $500 over 20 places', () => {
    expect(T).toHaveLength(20);
    expect(total(T)).toBe(50000);
    expect(T.slice(0, 5)).toEqual([10000, 7000, 5000, 3000, 3000]);
  });
});

describe('settleFixedTableBoard', () => {
  it('pays 20 distinct finishers exactly the table, the 21st nothing', () => {
    const s = settleFixedTableBoard(field(25), T);
    expect(s.rows.map((r) => r.amountCents)).toEqual([...T, 0, 0, 0, 0, 0]);
    expect(s.rows[0]).toMatchObject({ wallet: 'w00', rank: 1, place: 1, amountCents: 10000 });
    expect(s.rows[20]).toMatchObject({ rank: 21, place: null, amountCents: 0 });
    expect(s.paidCents).toBe(50000);
    expect(s.organizerCents).toBe(0);
  });

  it('fewer than 20 qualified: unpaid places stay with the organizer', () => {
    const s = settleFixedTableBoard(field(3), T);
    expect(s.rows.map((r) => r.amountCents)).toEqual([10000, 7000, 5000]);
    expect(s.organizerCents).toBe(50000 - 22000);
    hold(s);
    expect(settleFixedTableBoard([], T)).toEqual({ rows: [], paidCents: 0, organizerCents: 50000 });
  });

  it('a tie splits the summed prize of the tied places equally and floors; the remainder is unallocated (no tie-break)', () => {
    const s = settleFixedTableBoard([e('a', 9000), e('b', 8000), e('c', 8000), e('d', 8000), e('f', 7000)], T);
    // places 2-4 = 7000 + 5000 + 3000 = 15000 / 3 = 5000 each
    expect(paid(s)).toEqual({ a: 10000, b: 5000, c: 5000, d: 5000, f: 3000 });
    expect(s.rows.filter((r) => r.bps === 8000).map((r) => r.rank)).toEqual([2, 2, 2]);
    const odd = settleFixedTableBoard([e('a', 9000), e('b', 9000), e('c', 9000)], [100, 100, 101]);
    expect(paid(odd)).toEqual({ a: 100, b: 100, c: 100 });   // 301 / 3 = 100, one cent left over
    expect(odd.organizerCents).toBe(1);
    hold(odd, [100, 100, 101]);
  });

  it('the order of the input does not change who is paid what', () => {
    const entries = [e('a', 5000), e('b', 9000), e('c', 5000), e('d', 7000)];
    expect(paid(settleFixedTableBoard(entries, T))).toEqual(paid(settleFixedTableBoard([...entries].reverse(), T)));
  });

  it('a tie straddling place 20 splits only the places that exist', () => {
    const s = settleFixedTableBoard([...field(18), e('x', 100), e('y', 100), e('z', 100), e('q', 100)], T);
    // places 19-22: table[18] + table[19] = 2400 over four wallets = 600
    expect(s.rows.slice(18).map((r) => r.amountCents)).toEqual([600, 600, 600, 600]);
    expect(s.paidCents).toBe(total(T.slice(0, 18)) + 2400);
    expect(s.organizerCents).toBe(0);
  });

  it('an ineligible geo wallet stays on the board with a rank and no prize; eligible wallets below shift up', () => {
    const s = settleFixedTableBoard([e('ru', 9500, { prizeEligible: false }), e('a', 9000), e('b', 8000)], T);
    expect(s.rows.map((r) => [r.wallet, r.rank, r.place, r.amountCents])).toEqual([['ru', 1, null, 0], ['a', 2, 1, 10000], ['b', 3, 2, 7000]]);
  });

  it('an ineligible wallet inside a tie takes no share of it', () => {
    const s = settleFixedTableBoard([e('a', 9000), e('ru', 8000, { prizeEligible: false }), e('b', 8000), e('c', 8000)], T);
    // eligible tie on places 2-3 = 7000 + 5000 over two wallets
    expect(paid(s)).toEqual({ a: 10000, ru: 0, b: 6000, c: 6000 });
  });

  it('a disqualified wallet is removed before places are assigned, rank included', () => {
    const s = settleFixedTableBoard([e('cheat', 9900, { disqualified: true }), e('a', 9000), e('b', 8000)], T);
    expect(s.rows.map((r) => r.wallet)).toEqual(['a', 'b']);
    expect(s.rows[0]).toMatchObject({ rank: 1, amountCents: 10000 });
  });

  it('works with a custom table, a zero table cell and conserves the money', () => {
    const t = [500, 0, 300];
    const s = settleFixedTableBoard([e('a', 3), e('b', 2), e('c', 2), e('d', 1)], t);
    expect(paid(s)).toEqual({ a: 500, b: 150, c: 150, d: 0 });
    hold(s, t);
  });

  it('refuses a bad table and a repeated wallet', () => {
    expect(() => settleFixedTableBoard([], [])).toThrow(RangeError);
    expect(() => settleFixedTableBoard([], [1.5])).toThrow(RangeError);
    expect(() => settleFixedTableBoard([], Array(21).fill(1))).toThrow(RangeError);
    expect(() => settleFixedTableBoard([e('a', 1), e('a', 2)], T)).toThrow(/twice/);
  });

  it('conserves the table for any field size and tie shape', () => {
    for (let n = 0; n <= 40; n++) {
      for (const step of [0, 1, 7, 3333]) {
        const entries = Array.from({ length: n }, (_, i) => e(`w${i}`, 10000 - Math.floor(i / 3) * step, { prizeEligible: i % 5 !== 0 }));
        hold(settleFixedTableBoard(entries, T));
      }
    }
  });
});

describe('parsePrizeTable', () => {
  it('accepts 1..20 non-negative integers only', () => {
    expect(parsePrizeTable([1])).toEqual([1]);
    expect(parsePrizeTable([-1])).toBeNull();
    expect(parsePrizeTable([])).toBeNull();
    expect(parsePrizeTable([Number.NaN])).toBeNull();
  });
});

describe('eventPrizeGeoEligible', () => {
  it('RU and BY are play-only; unknown country, a sanctioned or EU country and a blocked US state are not eligible; KZ and UA are', () => {
    for (const c of ['RU', 'BY', 'ru', null, '', 'IR', 'DE', 'GB']) expect(eventPrizeGeoEligible(c, null), String(c)).toBe(false);
    expect(eventPrizeGeoEligible('KZ', null)).toBe(true);
    expect(eventPrizeGeoEligible('UA', null)).toBe(true);
    expect(eventPrizeGeoEligible('US', 'SC')).toBe(false);
    expect(eventPrizeGeoEligible('US', 'CA')).toBe(true);
  });
});

describe('eventAttemptBps', () => {
  it('floors the clean share and treats a null clean distance as the whole ride', () => {
    expect(eventAttemptBps(2500, 9999, 10000)).toBe(2500);
    expect(eventAttemptBps(null, 5000, 10000)).toBe(5000);
    expect(eventAttemptBps(0, 5000, 10000)).toBe(0);
    expect(eventAttemptBps(12000, 12000, 10000)).toBe(10000);
  });
});
