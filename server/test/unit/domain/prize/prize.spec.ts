import { announcePool, bestByWallet, cleanBps, nextBaseCents, rankedAttemptScore, seasonQualifiers, settleBoard, splitBoardCents, weekBonus } from '../../../../src/domain/prize/prize-pool.js';
import {
  BASE_STEPS_CENTS, BLOCKED_US_STATES, BONUS_CAP_CENTS, MIN_PAYOUT_CENTS, PAID_RANKED_STARTS, PROMO_RANKED_STARTS,
  PLACE_BPS, PRIZE_BLOCKED_COUNTRIES, SANCTIONED_COUNTRIES, TOKEN_IS_PRIZE, classifyStarts, openSettlement, prizeAccess, prizePhase, prizeWeek, rankedRoadEffects, rankedSpectatorBlocked, rankedStartFits, seasonOf,
} from '../../../../src/domain/prize/prize-rules.js';

const score = (wallet: string, metres: number, corrections = 0, submittedAt = 0, payout = true) => ({
  wallet, bps: cleanBps(metres, 10_000), corrections, submittedAt, payout,
});

describe('prize week and eligibility', () => {
  const mon = Date.UTC(2026, 9, 12);

  it('ranks Monday 00:00 UTC through Sunday 12:00 UTC, then verifies, hears appeals, and pays on Tuesday', () => {
    const week = prizeWeek(new Date(mon));
    expect(week).toMatchObject({ id: '2026-10-12', start: new Date(mon) });
    expect(week.end.toISOString()).toBe('2026-10-18T12:00:00.000Z');
    expect(week.verifyEnd.toISOString()).toBe('2026-10-19T12:00:00.000Z');
    expect(week.appealsEnd.toISOString()).toBe('2026-10-20T12:00:00.000Z');
    expect(week.payoutAt.toISOString()).toBe('2026-10-20T12:00:00.000Z');
    expect(prizeWeek(new Date(mon - 1)).id).toBe('2026-10-05');
    expect(prizeWeek(new Date(Date.UTC(2026, 9, 18, 18))).id).toBe('2026-10-12');
    expect(prizePhase(new Date(Date.UTC(2026, 9, 14, 12)))).toBe('ranked');
    expect(prizePhase(new Date(Date.UTC(2026, 9, 18, 12)))).toBe('verification');
    expect(prizePhase(new Date(Date.UTC(2026, 9, 18, 18)))).toBe('verification');
    expect(prizePhase(new Date(Date.UTC(2026, 9, 19, 18)))).toBe('ranked');
    expect(openSettlement(new Date(Date.UTC(2026, 9, 20, 8)))?.appealsEnd.toISOString()).toBe('2026-10-20T12:00:00.000Z');
    expect(openSettlement(new Date(Date.UTC(2026, 9, 21)))).toBeNull();
    expect(seasonOf('2026-10-12')).toEqual({ season: 1, week: 1, liveFinal: false });
    expect(seasonOf('2026-11-23')).toEqual({ season: 1, week: 7, liveFinal: true });
    expect(seasonOf('2026-11-30')).toEqual({ season: 2, week: 1, liveFinal: false });
    expect(rankedStartFits(new Date(Date.UTC(2026, 9, 18, 4)), 8 * 3600)).toBe(true);
    expect(rankedStartFits(new Date(Date.UTC(2026, 9, 18, 4, 0, 1)), 8 * 3600)).toBe(false);
    expect(rankedStartFits(new Date(Date.UTC(2026, 9, 18, 11)), 3600)).toBe(true);
    expect(rankedStartFits(new Date(Date.UTC(2026, 9, 18, 12)), 60)).toBe(false);
  });

  it('fails closed: age, unknown country, sanctions, UK/EU, a blocked US state, and KYC only at payout', () => {
    expect(prizeAccess({ age18: false, country: 'US', usState: 'CA', kyc: true })).toMatchObject({ ranked: false, reasons: ['age'] });
    expect(prizeAccess({ age18: true, country: null, usState: null, kyc: true }).reasons).toContain('country');
    expect(prizeAccess({ age18: true, country: 'kp', usState: null, kyc: true }).reasons).toEqual(['sanctioned']);
    expect(prizeAccess({ age18: true, country: 'DE', usState: null, kyc: true }).reasons).toEqual(['region']);
    expect(prizeAccess({ age18: true, country: 'GB', usState: null, kyc: true }).ranked).toBe(false);
    expect(prizeAccess({ age18: true, country: 'US', usState: 'de', kyc: true }).reasons).toEqual(['us-state']);
    expect(prizeAccess({ age18: true, country: 'US', usState: 'CA', kyc: false })).toEqual({ ranked: true, payout: false, reasons: ['kyc'] });
    expect(prizeAccess({ age18: true, country: 'US', usState: 'CA', kyc: true })).toEqual({ ranked: true, payout: true, reasons: [] });
    expect(SANCTIONED_COUNTRIES).toEqual(['CU', 'IR', 'KP', 'SY']);
    expect(BLOCKED_US_STATES).toEqual(['SC', 'AZ', 'LA', 'AR', 'DE', 'MT', 'TN']);
    expect(PRIZE_BLOCKED_COUNTRIES).toContain('GB');
    expect(PRIZE_BLOCKED_COUNTRIES).toHaveLength(28);
  });

  it('ranked runs take no road-affecting spectator events, and TEN4 is not the prize', () => {
    expect(rankedRoadEffects(true)).toEqual({ obstacles: false, weather: false, dayNight: false });
    expect(rankedRoadEffects(false).obstacles).toBe(true);
    expect(rankedSpectatorBlocked(true, { kind: 'message' })).toBe(false);
    expect(rankedSpectatorBlocked(true, { kind: 'honk-time' })).toBe(true);
    expect(rankedSpectatorBlocked(true, { kind: 'honk-weather' })).toBe(true);
    expect(rankedSpectatorBlocked(true, { kind: 'donation', game: true, obstacle: true, effect: 'sinkhole' })).toBe(true);
    expect(rankedSpectatorBlocked(true, { kind: 'donation', game: true, obstacle: false, effect: 'night' })).toBe(true);
    expect(rankedSpectatorBlocked(true, { kind: 'donation', game: false, obstacle: false, effect: 'tip' })).toBe(false);
    expect(rankedSpectatorBlocked(false, { kind: 'honk-time' })).toBe(false);
    expect(TOKEN_IS_PRIZE).toBe(false);
  });
});

describe('ranked starts', () => {
  const row = (id: string, paid: boolean, declaredAt: number | null, startedAt: number) => ({
    id, wallet: 'w', tier: '1h' as const, paid, declaredAt, startedAt,
  });

  it('does not count a training declaration; counts the first five paid, in start order', () => {
    const rows = [
      row('late', true, 50, 10),
      row('none', false, null, 20),
      ...[1, 2, 3].map((n) => row(`f${n}`, false, 1, 100 + n)),
      ...[1, 2, 3, 4, 5, 6].map((n) => row(`p${n}`, true, 1, 200 + n)),
    ];
    const out = classifyStarts(rows);
    expect(out.filter((r) => r.counted).map((r) => r.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(out.find((r) => r.id === 'f1')?.reason).toBe('training');
    expect(out.find((r) => r.id === 'f3')?.reason).toBe('training');
    expect(out.find((r) => r.id === 'p6')?.reason).toBe('paid-cap');
    expect(out.find((r) => r.id === 'late')?.reason).toBe('declared-late');
    expect(out.find((r) => r.id === 'none')?.reason).toBe('not-declared');
    expect(PROMO_RANKED_STARTS).toBe(1);
    expect(PAID_RANKED_STARTS).toBe(5);
  });

  it('a promo declaration uses its own slot and does not spend a free or paid one', () => {
    const promo = (id: string, startedAt: number) => ({ id, wallet: 'w', tier: '4h' as const, paid: false, promo: true, declaredAt: 1, startedAt });
    const out = classifyStarts([promo('a', 1), promo('b', 2), row('f', false, 1, 3), row('p', true, 1, 4)]);
    expect(out.find((r) => r.id === 'a')?.reason).toBe('counted');
    expect(out.find((r) => r.id === 'b')?.reason).toBe('promo-cap');
    expect(out.find((r) => r.id === 'f')?.reason).toBe('training');
    expect(out.filter((r) => r.counted).map((r) => r.id)).toEqual(['a', 'p']);
  });

  it('a second wallet has its own caps, and an undeclared ride does not consume one', () => {
    const mine = row('a', true, null, 1);
    const other = { ...row('b', true, 1, 2), wallet: 'z' };
    expect(classifyStarts([mine, other, row('c', true, 1, 3)]).filter((r) => r.counted).map((r) => r.id)).toEqual(['b', 'c']);
  });
});

describe('board score', () => {
  it('is the clean share of the route, and the best counted row is the one that ranks', () => {
    expect(cleanBps(2500, 10_000)).toBe(2500);
    expect(cleanBps(10_000, 10_000)).toBe(10_000);
    expect(cleanBps(11_000, 10_000)).toBe(10_000);
    expect(cleanBps(0, 10_000)).toBe(0);
    expect(rankedAttemptScore({ wallet: 'a', cleanMetres: null, distance: 2500, completeMetres: 10_000, submittedAt: 5, payout: false })).toMatchObject({ bps: 2500, corrections: 0, payout: false });
    expect(rankedAttemptScore({ wallet: 'a', cleanMetres: 100, distance: 2500, completeMetres: 10_000, submittedAt: 5, payout: false }).bps).toBe(100);
    const rows = [score('a', 4000, 0, 5), score('a', 9000, 0, 9), score('b', 10_000, 4, 3), score('b', 10_000, 1, 8), score('c', 10_000, 1, 2)];
    expect(bestByWallet(rows).map((r) => r.wallet)).toEqual(['c', 'b', 'a']);
    expect(bestByWallet(rows).find((r) => r.wallet === 'b')?.submittedAt).toBe(8);
  });
});

describe('pool announcement', () => {
  it('pays 40% of last week, reserves 10% of the bonus, and caps the bonus at $2,500', () => {
    expect(weekBonus(25_000)).toEqual({ bonusCents: 10_000, seasonCents: 1_000, boardCents: 9_000 });
    expect(weekBonus(1_000_000).bonusCents).toBe(BONUS_CAP_CENTS);
    expect(weekBonus(1_000_000).seasonCents).toBe(25_000);
    const announced = announcePool(30_000, 25_000);
    expect(announced.byTier['1h']).toEqual({ base: 7_500, bonus: 2_250, total: 9_750 });
    expect(announced.byTier['4h']).toEqual({ base: 9_000, bonus: 2_700, total: 11_700 });
    expect(announced.byTier['8h'].base + announced.byTier['4h'].base + announced.byTier['1h'].base).toBe(30_000);
    expect('base' in splitBoardCents(100)).toBe(false);
    expect(splitBoardCents(100)['1h'] + splitBoardCents(100)['4h'] + splitBoardCents(100)['8h']).toBe(100);
  });

  it('steps the base only after four weeks above 4×, one step at a time', () => {
    const hot = [120_001, 120_001, 120_001, 120_001];
    expect(nextBaseCents(BASE_STEPS_CENTS[0], hot)).toBe(75_000);
    expect(nextBaseCents(75_000, [300_001, 300_001, 300_001, 300_001])).toBe(150_000);
    expect(nextBaseCents(150_000, [600_001, 600_001, 600_001, 600_001])).toBe(300_000);
    expect(nextBaseCents(300_000, [9_999_999, 9_999_999, 9_999_999, 9_999_999])).toBe(300_000);
    expect(nextBaseCents(30_000, [120_001, 120_001, 120_001])).toBe(30_000);
    expect(nextBaseCents(30_000, [120_000, 120_001, 120_001, 120_001])).toBe(30_000);
    expect(nextBaseCents(12, hot)).toBe(30_000);
  });
});

describe('board settlement', () => {
  const ten = () => Array.from({ length: 10 }, (_, i) => score(String.fromCharCode(97 + i), 10_000 - i * 100, 0, i));

  it('pays the published top-10 shares of a full board and caps a finisher at 10th place', () => {
    expect(PLACE_BPS.reduce((s, n) => s + n, 0)).toBe(8_000);
    const board = settleBoard({ tier: '1h', baseCents: 7_500, bonusCents: 0, carryCents: 0, scores: ten() });
    expect(board.payableCents).toBe(7_500);
    const paid = board.lines.filter((l) => l.paid);
    expect(paid.map((l) => l.placeCents)).toEqual([1_875, 1_125, 750, 562, 562]);
    expect(paid.every((l) => l.cents >= MIN_PAYOUT_CENTS)).toBe(true);
    expect(paid.reduce((s, l) => s + l.cents, 0) + board.rollCents).toBe(7_500);
    const finish = ten().map((r, i) => i === 0 ? r : { ...r, bps: 1000 });
    const withFinisher = settleBoard({ tier: '1h', baseCents: 100_000, bonusCents: 0, carryCents: 0, scores: finish });
    const first = withFinisher.lines.find((l) => l.place === 1)!;
    const tenth = withFinisher.lines.find((l) => l.place === 10)!;
    expect(first.finisherCents).toBe(tenth.placeCents);
    expect(first.finisherCents).toBeLessThan(Math.floor(20_000));
  });

  it('splits tied places equally without breaking ties by wallet address', () => {
    const scores = [
      score('z', 9000, 0, 10),
      score('a', 9000, 0, 10),
      score('m', 8000, 0, 20),
    ];
    const board = settleBoard({ tier: '1h', baseCents: 7_500, bonusCents: 0, carryCents: 0, scores });
    expect(board.lines.map((l) => ({ wallet: l.wallet, place: l.place, placeCents: l.placeCents }))).toEqual([
      { wallet: 'a', place: 1, placeCents: 1_500 },
      { wallet: 'z', place: 1, placeCents: 1_500 },
      { wallet: 'm', place: 3, placeCents: 750 },
    ]);
  });

  it('a thin board pays base only, rolls this bonus, and sends last week’s roll to the season', () => {
    const thin = settleBoard({
      tier: '8h', baseCents: 13_500, bonusCents: 4_000, carryCents: 900, scores: [score('a', 5000), score('b', 4000)],
    });
    expect(thin.participants).toBe(2);
    expect(thin.payableCents).toBe(13_500);
    expect(thin.toSeasonCents).toBe(900);
    expect(thin.rollCents).toBeGreaterThanOrEqual(4_000);
    expect(thin.lines.find((l) => l.place === 1)?.placeCents).toBe(Math.floor(13_500 * 0.8 * 2_500 / 8_000));
  });

  it('pays a carried cent when the board is large enough, and withholds a winner without KYC', () => {
    const scores = ten().map((r, i) => i === 0 ? { ...r, payout: false } : r);
    const board = settleBoard({ tier: '4h', baseCents: 9_000, bonusCents: 1_000, carryCents: 500, scores });
    expect(board.payableCents).toBe(10_500);
    expect(board.toSeasonCents).toBe(0);
    expect(board.lines.find((l) => l.place === 1)?.paid).toBe(false);
    expect(board.rollCents).toBeGreaterThan(0);
  });

  it('above 100 riders pays the top 10% and still keeps a finisher pool', () => {
    const scores = Array.from({ length: 150 }, (_, i) => score(`w${i}`, 9_000 - i, 0, i));
    const board = settleBoard({ tier: '1h', baseCents: 80_000, bonusCents: 20_000, carryCents: 0, scores });
    expect(board.lines.filter((l) => l.place !== null)).toHaveLength(15);
    expect(board.lines[0]!.cents).toBeGreaterThan(board.lines[14]!.cents);
    expect(board.payableCents).toBe(100_000);
  });
});

describe('season final', () => {
  it('qualifies the lowest place-sum across a 7-week season and includes all ties at the 8th-place cutoff', () => {
    const weeks = [
      [{ wallet: 'a', place: 1 }, { wallet: 'b', place: 2 }],
      [{ wallet: 'a', place: 2 }, { wallet: 'c', place: 1 }],
    ];
    const rows = seasonQualifiers(weeks);
    expect(rows.map((r) => r.wallet)).toEqual(['a', 'c', 'b']);
    expect(rows.find((r) => r.wallet === 'c')?.score).toBe(1000 + 1);
    expect(rows.find((r) => r.wallet === 'a')?.score).toBe(3);
    expect(seasonQualifiers(Array.from({ length: 9 }, () => [{ wallet: 'a', place: 1 }]))[0]?.score).toBe(7);
    const cutoffTie = [
      [
        { wallet: 'w1', place: 1 }, { wallet: 'w2', place: 2 }, { wallet: 'w3', place: 3 }, { wallet: 'w4', place: 4 },
        { wallet: 'w5', place: 5 }, { wallet: 'w6', place: 6 }, { wallet: 'w7', place: 7 }, { wallet: 'w8', place: 8 },
        { wallet: 'w9', place: 8 }, { wallet: 'w10', place: 10 },
      ],
    ];
    expect(seasonQualifiers(cutoffTie).map((r) => r.wallet)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9']);
  });
});
