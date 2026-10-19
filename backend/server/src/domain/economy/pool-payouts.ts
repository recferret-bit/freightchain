/*
 * How a pool's PRIZE share is divided among its ranked riders (docs/spec/pool.md: skill prizes, no draw). Of the pool, prize = prizeBps of the pot
 * (70 % by default) – the program caps every pay_prize at that bound. Within it, in parts of 70: the top 3 get 25 / 15 / 10, and 20 parts are shared equally
 * by the top 20 (ranks 1–20, so the top 3 get a share of both). Integer lamports, floors only: the sum never exceeds the prize; whatever is not paid (fewer riders,
 * rounding) stays in the vault and goes to the seed treasury at close.
 */
export const TOP3_PARTS = [25, 15, 10] as const;
export const TOP20_PARTS = 20;
export const TOP20_SIZE = 20;
const TOTAL_PARTS = TOP3_PARTS.reduce((a, b) => a + b, 0) + TOP20_PARTS;

export interface PrizePayout {
  rank: number;
  wallet: string;
  lamports: number;
}

/** `ranked` = the pool's ranking, best first (one entry per wallet). */
export function poolPayouts(prizeLamports: number, ranked: readonly string[]): PrizePayout[] {
  if (!Number.isInteger(prizeLamports) || prizeLamports < 0) throw new RangeError('the prize is a whole number of lamports');
  const top20Pool = Math.floor((prizeLamports * TOP20_PARTS) / TOTAL_PARTS);
  const top20 = ranked.slice(0, TOP20_SIZE);
  const each = top20.length > 0 ? Math.floor(top20Pool / top20.length) : 0;
  return top20.map((wallet, i) => ({
    rank: i + 1, wallet, lamports: each + (i < TOP3_PARTS.length ? Math.floor((prizeLamports * (TOP3_PARTS[i] as number)) / TOTAL_PARTS) : 0),
  })).filter((p) => p.lamports > 0);
}
