import { DUPLICATE_MIN_COMMON, NEW_WALLET_HOURS, OUTLIER_K, POOL_TOP, duplicateRecordings, isPoolMark, poolAttention, poolStandings, printMatch, walletMarks, type PoolRideFacts, type RidePrint, type WalletSignIns } from '../../../src/domain/verdict/pool-attention.js';
import { prng } from '../../support/recording.js';
import { RideVerdict, type RideVerdictProps } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus, type VerdictReason } from '../../../src/domain/verdict/verdict.dto.js';

/* Pool-level attention marks: what looks strange across ONE pool's rides. Flag reasons only (pool-*), never a reject, never over an admin's decision. */
const T0 = new Date(Date.UTC(2036, 9, 1, 12, 0, 0));
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
let n = 0;
/** a completed pool ride of `wallet`, `km` long, started `h` hours after T0 */
const ride = (wallet: string, km: number, h = 100, extra: Partial<PoolRideFacts> = {}): PoolRideFacts =>
  ({ rideId: `r${++n}`, wallet, distance: km * 1000, driveSeconds: 1800, startedAt: at(h), endedAt: at(h + 0.5), verdict: 'verified', overridden: false, ...extra });
const old = (wallet: string, ips: string[] = []): WalletSignIns => ({ wallet, firstSeen: at(-1000), ips });
const codes = (m: Map<string, VerdictReason[]>, w: string) => (m.get(w) ?? []).map((r) => r.code);

describe('poolStandings', () => {
  it('ranks by total distance, then more rides, then the earlier first finish, then the wallet; an admin-rejected ride does not count', () => {
    const rides = [ride('a', 10), ride('b', 6), ride('b', 4, 50), ride('c', 10, 90), ride('d', 30, 100, { verdict: 'rejected', overridden: true })];
    expect(poolStandings(rides).map((s) => [s.wallet, s.rank, s.distance, s.rides])).toEqual([['b', 1, 10_000, 2], ['c', 2, 10_000, 1], ['a', 3, 10_000, 1]]);
  });
});

describe('walletMarks', () => {
  it(`distance-outlier: a total above ${OUTLIER_K}× the median of the top ${POOL_TOP}, only with ≥ 4 wallets`, () => {
    const rides = [ride('a', 10), ride('b', 10), ride('c', 12), ride('d', 15), ride('e', 16)];   // median 12 → limit 18
    expect([...walletMarks(7, rides, []).keys()]).toEqual([]);
    const big = [...rides, ride('f', 19)];   // median (12 + 15) / 2 = 13.5 → limit 20.25: 19 is fine
    expect(walletMarks(7, big, []).size).toBe(0);
    const outlier = [...rides, ride('f', 25)];
    const m = walletMarks(7, outlier, []);
    expect(codes(m, 'f')).toEqual(['pool-distance-outlier']);
    expect(m.get('f')?.[0]).toMatchObject({ severity: 'flag', detail: expect.stringContaining('pool 7') });
    expect(walletMarks(7, [ride('a', 1), ride('b', 1), ride('c', 50)], []).size).toBe(0);   // 3 wallets: no median worth the name
  });

  it('shared-ip: two different ranked wallets that signed in from one address – both marked; the detail names neither the IP nor the other wallet', () => {
    const rides = [ride('a', 10), ride('b', 9), ride('c', 8)];
    const m = walletMarks(3, rides, [old('a', ['1.1.1.1', '9.9.9.9']), old('b', ['2.2.2.2', '9.9.9.9']), old('c', ['3.3.3.3']), old('x', ['3.3.3.3'])]);   // x is not ranked
    expect(codes(m, 'a')).toEqual(['pool-shared-ip']);
    expect(codes(m, 'b')).toEqual(['pool-shared-ip']);
    expect(m.has('c')).toBe(false);
    expect(m.get('a')?.[0]?.detail).not.toMatch(/9\.9\.9\.9|\bb\b/);
  });

  it(`new-wallet-top3: a top-3 wallet first seen < ${NEW_WALLET_HOURS} h before its first ride in the pool`, () => {
    const rides = [ride('a', 10, 30), ride('a', 1, 10), ride('b', 9, 100), ride('c', 8, 100), ride('d', 7, 100)];
    const seen = [{ wallet: 'a', firstSeen: at(-5), ips: [] }, { wallet: 'b', firstSeen: at(90), ips: [] }, old('c'), { wallet: 'd', firstSeen: at(99), ips: [] }];
    const m = walletMarks(1, rides, seen);
    expect(codes(m, 'a')).toEqual(['pool-new-wallet-top3']);   // first ride at +10 h, seen at −5 h: 15 h
    expect(codes(m, 'b')).toEqual(['pool-new-wallet-top3']);
    expect(m.has('c')).toBe(false);
    expect(m.has('d')).toBe(false);   // new, but 4th
    expect(walletMarks(1, rides, [{ wallet: 'a', firstSeen: null, ips: [] }]).has('a')).toBe(false);   // nothing known: no mark
  });

  it('only the top 20 are looked at', () => {
    const rides = Array.from({ length: 22 }, (_, i) => ride(`w${String(i).padStart(2, '0')}`, 100 - i));
    const m = walletMarks(1, rides, [old('w20', ['5.5.5.5']), old('w21', ['5.5.5.5'])]);
    expect(m.size).toBe(0);
  });
});

describe('poolAttention', () => {
  it('marks every completed ride of a marked wallet in the pool – except one an admin rejected (an accepted one is skipped by the writer, under the lock)', () => {
    const rides = [ride('a', 10), ride('a', 10, 120), ride('a', 1, 130, { verdict: 'rejected', overridden: true }), ride('b', 9), ride('c', 8), ride('d', 7), ride('b', 1, 140, { overridden: true })];
    const marks = poolAttention(1, rides, [old('a', ['1.1.1.1']), old('b', ['1.1.1.1']), old('c'), old('d')]);
    expect(marks.map((m) => [m.wallet, m.rideId])).toEqual([['a', rides[0]?.rideId], ['a', rides[1]?.rideId], ['b', rides[3]?.rideId], ['b', rides[6]?.rideId]]);
    expect(marks.every((m) => m.reasons.every((r) => isPoolMark(r.code) && r.severity === 'flag'))).toBe(true);
  });
});

describe('RideVerdict.addReasons', () => {
  const props = (status: VerdictStatus, reasons: VerdictReason[] = [], overriddenBy: string | null = null): RideVerdictProps => ({
    rideId: 'r', status, reasons, scores: { recording: {} as never, human: {} as never, challenges: {} as never }, rulesVersion: 4, judgedAt: T0, overriddenBy, overriddenAt: overriddenBy ? T0 : null, note: null, version: 1,
  });
  const mark: VerdictReason = { code: 'pool-shared-ip', detail: 'x', severity: 'flag' };

  it('verified + a mark → flagged; the same mark again changes nothing (idempotent)', () => {
    const v = RideVerdict.restore(props(VerdictStatus.Verified));
    expect(v.addReasons([mark, mark])).toBe(true);
    expect([v.status, v.reasons.map((r) => r.code)]).toEqual([VerdictStatus.Flagged, ['pool-shared-ip']]);
    expect(v.addReasons([mark])).toBe(false);
  });

  it('a machine reject stays rejected (never softened to flagged); an admin\'s decision is never touched', () => {
    const rejected = RideVerdict.restore(props(VerdictStatus.Rejected, [{ code: 'no-recording', detail: '', severity: 'reject' }]));
    expect(rejected.addReasons([mark])).toBe(true);
    expect(rejected.status).toBe(VerdictStatus.Rejected);
    const decided = RideVerdict.restore(props(VerdictStatus.Verified, [], 'ADMIN'));
    expect(decided.addReasons([mark])).toBe(false);
    expect([decided.status, decided.reasons]).toEqual([VerdictStatus.Verified, []]);
  });
});

describe('pool-duplicate-recording (audit H2)', () => {
  /** a line across the road along `n` road steps: the lane (2.4 m) and a person's wobble, from its own seed */
  const line = (seed: number, n = 200): Map<number, number> => { const r = prng(seed); let d = 2.4; const m = new Map<number, number>(); for (let k = 0; k < n; k++) { d += (r() - 0.5) * 0.12; d = Math.max(1.4, Math.min(3.4, d)); m.set(k, Math.round(d * 100) / 100); } return m; };
  const print = (rideId: string, wallet: string, firstAt: number, p: Map<number, number>): RidePrint => ({ rideId, wallet, firstAt, print: p });

  it('a copy of another rider\'s recording (the same line, even with a few cm of noise) is marked on the LATER ride only; the original is not', () => {
    const victim = line(1), noisy = new Map([...victim].map(([k, d]) => [k, Math.round((d + ((k * 7919) % 11 - 5) / 100) * 100) / 100]));   // ±5 cm
    expect(printMatch(victim, noisy).share).toBeGreaterThan(0.9);
    const marks = duplicateRecordings(1, [print('orig', 'honest', 1000, victim), print('copy', 'thief', 2000, noisy)]);
    expect(marks).toEqual([expect.objectContaining({ rideId: 'copy', wallet: 'thief', reasons: [expect.objectContaining({ code: 'pool-duplicate-recording', severity: 'flag' })] })]);
  });

  it('two honest drivers of the same road do not match; nor does one wallet with itself, or a pair sharing under 1 km of road', () => {
    const honest = Array.from({ length: 8 }, (_, i) => print(`r${i}`, `w${i}`, i, line(100 + i)));
    expect(duplicateRecordings(1, honest)).toEqual([]);
    for (let i = 1; i < honest.length; i++) expect(printMatch(honest[0]!.print, honest[i]!.print).share).toBeLessThan(0.5);
    const same = line(7);
    expect(duplicateRecordings(1, [print('a', 'w', 1, same), print('b', 'w', 2, same)])).toEqual([]);   // the same wallet driving the same line twice is no theft
    const short = new Map([...same].slice(0, DUPLICATE_MIN_COMMON - 1));
    expect(duplicateRecordings(1, [print('a', 'w1', 1, short), print('b', 'w2', 2, short)])).toEqual([]);
  });

  it('poolAttention appends the duplicate mark to the copy\'s other marks; a copy an admin rejected is out already', () => {
    const p = line(3);
    const rides = [ride('honest', 10, 100, { rideId: 'orig' }), ride('thief', 10, 101, { rideId: 'copy' })];
    const marks = poolAttention(1, rides, [old('honest'), old('thief')], [print('orig', 'honest', 1, p), print('copy', 'thief', 2, p)]);
    expect(marks.map((m) => [m.rideId, m.reasons.map((r) => r.code)])).toEqual([['copy', ['pool-duplicate-recording']]]);
    const decided = [rides[0]!, ride('thief', 10, 101, { rideId: 'copy', verdict: 'rejected', overridden: true })];
    expect(poolAttention(1, decided, [old('honest'), old('thief')], [print('orig', 'honest', 1, p), print('copy', 'thief', 2, p)])).toEqual([]);
  });
});
