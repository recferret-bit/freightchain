import { poolPayouts } from '../../../src/domain/economy/pool-payouts.js';
import { allocatePoolShares, referralPaid } from '../../../src/domain/referral/referral-split.js';

const cap = 1_000_000_000;
const part = 8000;

describe('allocatePoolShares', () => {
  it('a lone referred winner: the referrer takes 80%, and the leftover returns to that winner', () => {
    const pot = 1_000;
    const slice = poolPayouts(pot, ['A'])[0]!.lamports;
    const shares = allocatePoolShares({ prizePot: 0, referralPot: pot, ranked: ['A'], referrerOf: () => 'R', referrerPartBps: part, rideCap: cap });
    const toReferrer = Math.floor((slice * part) / 10_000);
    expect(shares.referrers).toEqual([{ wallet: 'R', lamports: toReferrer }]);
    expect(shares.riders).toEqual([{ rank: 1, wallet: 'A', lamports: slice - toReferrer }]);
    expect(referralPaid(shares, 0, ['A'])).toBe(slice);
  });

  it('an unsponsored winner keeps the whole slice; a sponsored winner\'s leftover goes to the other finishers', () => {
    const pot = 10_000;
    const ranked = ['A', 'B'];
    const slices = poolPayouts(pot, ranked);
    const shares = allocatePoolShares({
      prizePot: 0, referralPot: pot, ranked, referrerPartBps: part, rideCap: cap,
      referrerOf: (w) => (w === 'A' ? 'R' : null),
    });
    const a = slices[0]!.lamports;
    const toR = Math.floor((a * part) / 10_000);
    expect(shares.referrers).toEqual([{ wallet: 'R', lamports: toR }]);
    expect(shares.riders.find((r) => r.wallet === 'A')).toBeUndefined();
    const riderB = shares.riders.find((r) => r.wallet === 'B')!;
    expect(riderB.lamports).toBe(slices[1]!.lamports + (a - toR));
    expect(referralPaid(shares, 0, ranked)).toBe(slices[0]!.lamports + slices[1]!.lamports);
  });

  it('pays the referrer nothing past the cap, and the overflow joins the leftover', () => {
    const shares = allocatePoolShares({
      prizePot: 0, referralPot: 1_000_000, ranked: ['A'], referrerOf: () => 'R', referrerPartBps: part, rideCap: 100,
    });
    expect(shares.referrers).toEqual([{ wallet: 'R', lamports: 100 }]);
    const slice = poolPayouts(1_000_000, ['A'])[0]!.lamports;
    expect(shares.riders[0]!.lamports).toBe(slice - 100);
  });

  it('one referrer of two winners is capped once, across both slices', () => {
    const shares = allocatePoolShares({
      prizePot: 0, referralPot: 1_000_000, ranked: ['A', 'B'], referrerOf: () => 'R', referrerPartBps: 10_000, rideCap: 50,
    });
    expect(shares.referrers).toEqual([{ wallet: 'R', lamports: 50 }]);
    expect(referralPaid(shares, 0, ['A', 'B'])).toBe(poolPayouts(1_000_000, ['A', 'B']).reduce((s, p) => s + p.lamports, 0));
  });

  it('adds the referral remainder on top of the prize, and never pays more than the referral pot', () => {
    const ranked = ['A', 'B', 'C'];
    const prizePot = 6_500_000;
    const referralPot = 500_000;
    const shares = allocatePoolShares({
      prizePot, referralPot, ranked, referrerOf: (w) => (w === 'B' ? 'R' : null), referrerPartBps: part, rideCap: cap,
    });
    const prizes = new Map(poolPayouts(prizePot, ranked).map((p) => [p.wallet, p.lamports]));
    for (const r of shares.riders) expect(r.lamports).toBeGreaterThanOrEqual(prizes.get(r.wallet) ?? 0);
    expect(shares.riders.find((r) => r.wallet === 'A')!.lamports).toBeGreaterThan(prizes.get('A')!);
    expect(referralPaid(shares, prizePot, ranked)).toBeLessThanOrEqual(referralPot);
    expect(shares.referrers[0]!.wallet).toBe('R');
  });

  it('a wallet cannot be its own referrer', () => {
    const shares = allocatePoolShares({ prizePot: 0, referralPot: 1000, ranked: ['A'], referrerOf: () => 'A', referrerPartBps: part, rideCap: cap });
    expect(shares.referrers).toEqual([]);
    expect(shares.riders[0]!.lamports).toBe(poolPayouts(1000, ['A'])[0]!.lamports);
  });
});
