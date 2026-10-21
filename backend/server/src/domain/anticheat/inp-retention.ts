/** Raw 30 Hz inp is dropped only after 90 days and only once that pool's payout is finalized. Downsampled samples stay. */
export const INP_RETAIN_MS = 90 * 24 * 60 * 60 * 1000;

export interface InpRetentionRow {
  rideId: string;
  inpAt: Date | null;
  /** Null when the ride has no pool, or the pool is not paid out yet. */
  payoutFinalizedAt: Date | null;
}

export function inpPrunable(row: InpRetentionRow, now: Date): boolean {
  if (!row.inpAt || !row.payoutFinalizedAt) return false;
  return now.getTime() - row.inpAt.getTime() >= INP_RETAIN_MS;
}
