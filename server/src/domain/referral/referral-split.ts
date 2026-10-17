import { poolPayouts, TOP20_PARTS, TOP20_SIZE, TOP3_PARTS } from '../economy/pool-payouts.js';

/**
 * How a pool's prize share and its referral share become leaves of one winners root.
 * The referral pot is attributed with the same weights as prizes. A sponsored winner's referrer takes the bigger part of that
 * winner's slice, up to the per-pool cap. Whatever that slice does not pay the referrer is split across the other top-20 riders.
 * An unsponsored winner keeps their own slice. Floors only; the sum sourced from the referral pot never exceeds it.
 */

export interface ShareLeaf {
  /** 1-based, best first. Referrer leaves have no rank here – the payout job appends them after the riders. */
  rank: number;
  wallet: string;
  lamports: number;
}

export interface ReferrerLeaf {
  wallet: string;
  lamports: number;
}

export interface AllocatedShares {
  riders: ShareLeaf[];
  referrers: ReferrerLeaf[];
}

export interface AllocateInput {
  prizePot: number;
  referralPot: number;
  /** best first, one wallet each */
  ranked: readonly string[];
  /** the referrer when this rider's best ride in the pool was an on-chain ticket and the referrer is still eligible; otherwise null */
  referrerOf: (wallet: string) => string | null;
  /** the bigger part of a sponsored slice, in basis points (8000 = 80%) */
  referrerPartBps: number;
  /** lamports one referrer may take from this pool, across every winner they brought */
  rideCap: number;
}

const whole = (n: number, what: string): void => {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${what} is a whole number of lamports`);
};

/** Integer weight of finish `index` (0-based) among `n` finishers. Same shape as poolPayouts: top-3 parts plus an equal top-20 part. */
function rankWeight(index: number, n: number): number {
  const top3 = index < TOP3_PARTS.length ? (TOP3_PARTS[index] as number) : 0;
  return top3 * n + TOP20_PARTS;
}

/** Floor-split `total` by rank weight. Dust goes to the best finish in the set, so a remainder is not swept to the seed treasury while a rider exists. */
function distribute(total: number, indexes: readonly number[], n: number): Map<number, number> {
  const out = new Map<number, number>();
  if (total <= 0 || indexes.length === 0) return out;
  const weights = indexes.map((i) => rankWeight(i, n));
  const sum = weights.reduce((a, b) => a + b, 0);
  let paid = 0;
  indexes.forEach((i, k) => {
    const cut = Math.floor((total * (weights[k] as number)) / sum);
    out.set(i, cut);
    paid += cut;
  });
  const dust = total - paid;
  if (dust > 0) {
    const best = Math.min(...indexes);
    out.set(best, (out.get(best) ?? 0) + dust);
  }
  return out;
}

export function allocatePoolShares(input: AllocateInput): AllocatedShares {
  whole(input.prizePot, 'prize pot');
  whole(input.referralPot, 'referral pot');
  whole(input.rideCap, 'ride cap');
  if (!Number.isInteger(input.referrerPartBps) || input.referrerPartBps < 0 || input.referrerPartBps > 10_000) {
    throw new RangeError('referrer part is 0..10000 bps');
  }
  const n = Math.min(input.ranked.length, TOP20_SIZE);
  const prizes = poolPayouts(input.prizePot, input.ranked);
  const slices = poolPayouts(input.referralPot, input.ranked);
  const bonus = new Map<number, number>();
  const owed = new Map<string, number>();
  const contributed = new Set<number>();
  let remainder = 0;

  for (const slice of slices) {
    const index = slice.rank - 1;
    const referrer = input.referrerOf(slice.wallet);
    if (!referrer || referrer === slice.wallet) {
      bonus.set(index, (bonus.get(index) ?? 0) + slice.lamports);
      continue;
    }
    const raw = Math.floor((slice.lamports * input.referrerPartBps) / 10_000);
    const room = Math.max(0, input.rideCap - (owed.get(referrer) ?? 0));
    const pay = Math.min(raw, room);
    if (pay > 0) owed.set(referrer, (owed.get(referrer) ?? 0) + pay);
    const left = slice.lamports - pay;
    if (left > 0) {
      remainder += left;
      contributed.add(index);
    }
  }

  const others: number[] = [];
  for (let i = 0; i < n; i++) if (!contributed.has(i)) others.push(i);
  const targets = others.length > 0 ? others : Array.from({ length: n }, (_, i) => i);
  if (remainder > 0 && targets.length > 0) {
    for (const [i, v] of distribute(remainder, targets, n)) bonus.set(i, (bonus.get(i) ?? 0) + v);
  }

  const riders: ShareLeaf[] = prizes.map((p) => ({ rank: p.rank, wallet: p.wallet, lamports: p.lamports + (bonus.get(p.rank - 1) ?? 0) }));
  for (const [i, v] of bonus) {
    if (v > 0 && !riders.some((r) => r.rank === i + 1)) {
      const wallet = input.ranked[i];
      if (wallet) riders.push({ rank: i + 1, wallet, lamports: v });
    }
  }
  riders.sort((a, b) => a.rank - b.rank);
  const referrers = [...owed.entries()].filter(([, lamports]) => lamports > 0).map(([wallet, lamports]) => ({ wallet, lamports }));
  return { riders: riders.filter((r) => r.lamports > 0), referrers };
}

/** Lamports of `shares` that came from the referral pot: rider leaves minus the plain prize payout. Never above `referralPot`. */
export function referralPaid(shares: AllocatedShares, prizePot: number, ranked: readonly string[]): number {
  const prize = new Map(poolPayouts(prizePot, ranked).map((p) => [p.wallet, p.lamports]));
  const extra = shares.riders.reduce((sum, r) => sum + r.lamports - (prize.get(r.wallet) ?? 0), 0);
  return extra + shares.referrers.reduce((sum, r) => sum + r.lamports, 0);
}
