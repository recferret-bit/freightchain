/* Version 1 of the pool ranking. Lower effective time wins. The weights are fixed for a pool once it opens. */

export const SCORE_FORMULA_VERSION = 1;
/** 1 second of effective time per hull point. */
export const DAMAGE_MS_PER_POINT = 1000;
/** 15 seconds of effective time per red light. */
export const RED_LIGHT_MS = 15_000;
export const MG_WRONG_SECONDS = 20;
export const MG_MISSED_SECONDS = 45;

export interface RankableRide {
  finished: boolean;
  verdictTier: string | null;
  durationMs: number;
  mgPenaltySeconds: number;
  damageTotal: number;
  redLights: number;
  distanceM: number;
  finishedAt: Date | null;
}

export function mgPenaltySeconds(wrong: number, missed: number): number {
  return MG_WRONG_SECONDS * Math.max(0, wrong) + MG_MISSED_SECONDS * Math.max(0, missed);
}

export function effectiveDurationMs(row: Pick<RankableRide, 'durationMs' | 'mgPenaltySeconds' | 'damageTotal' | 'redLights'>): number {
  return row.durationMs + row.mgPenaltySeconds * 1000 + row.damageTotal * DAMAGE_MS_PER_POINT + row.redLights * RED_LIGHT_MS;
}

function finishedVerified(row: RankableRide): boolean {
  return row.finished && row.verdictTier === 'verified';
}

/** Finished verified rides first, by effective time, then less damage, then an earlier finish. Everyone else ranks below, by distance then damage. */
export function rankRideResults<T extends RankableRide>(rows: readonly T[], version: number = SCORE_FORMULA_VERSION): T[] {
  if (version !== SCORE_FORMULA_VERSION) throw new Error(`unknown score formula ${version}`);
  const done = rows.filter(finishedVerified);
  const rest = rows.filter((row) => !finishedVerified(row));
  done.sort((a, b) => effectiveDurationMs(a) - effectiveDurationMs(b) || a.damageTotal - b.damageTotal || (a.finishedAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.finishedAt?.getTime() ?? Number.POSITIVE_INFINITY));
  rest.sort((a, b) => b.distanceM - a.distanceM || a.damageTotal - b.damageTotal || (a.finishedAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.finishedAt?.getTime() ?? Number.POSITIVE_INFINITY));
  return [...done, ...rest];
}

/** Verified payout wallets, reordered by the formula when result rows exist. Wallets with no row keep their previous order at the end. */
export function orderWalletsByResults<T extends RankableRide & { wallet: string }>(verifiedWallets: readonly string[], rows: readonly T[], version: number = SCORE_FORMULA_VERSION): string[] {
  if (!rows.length) return [...verifiedWallets];
  const known = new Set(verifiedWallets);
  const ranked = rankRideResults(rows, version).map((row) => row.wallet).filter((wallet) => known.has(wallet));
  for (const wallet of verifiedWallets) if (!ranked.includes(wallet)) ranked.push(wallet);
  return ranked;
}
