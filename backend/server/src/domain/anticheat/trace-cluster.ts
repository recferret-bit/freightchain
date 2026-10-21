import { matchingIntervalRun } from './humanness.js';

/** Fraction of the shorter trace that sits in one ≥1 ms-matched run. Top-20 review only. */
export const TRACE_SIMILARITY_THRESHOLD = 0.85;

export interface TraceRow {
  rideId: string;
  wallet: string;
  intervalsMs: readonly number[];
}

export interface TraceFlag {
  rideId: string;
  otherRideId: string;
  similarity: number;
}

/** Pairs in the supplied top-20 whose aligned intervals exceed the threshold and belong to different wallets. */
export function flagSimilarTraces(top: readonly TraceRow[], threshold = TRACE_SIMILARITY_THRESHOLD): TraceFlag[] {
  const rows = top.slice(0, 20);
  const flags: TraceFlag[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.wallet === b.wallet) continue;
      const run = matchingIntervalRun(a.intervalsMs, b.intervalsMs);
      const denom = Math.max(1, Math.min(a.intervalsMs.length, b.intervalsMs.length));
      const similarity = run / denom;
      if (similarity >= threshold) flags.push({ rideId: a.rideId, otherRideId: b.rideId, similarity });
    }
  }
  return flags;
}

/** Raised for an admin when the top 20 contains a similar pair. Null when the window is clean. */
export function clusterAlert(flags: readonly TraceFlag[]): { code: 'trace-cluster'; detail: string } | null {
  if (!flags.length) return null;
  return { code: 'trace-cluster', detail: `${flags.length} similar trace pair(s) in the top 20` };
}
