import { MAX_REPORTED_DISTANCE, MAX_SPEED } from '../rides/ride-rules.js';
import { PREFIX_ROWS } from './world-facts.js';
import { BATCH_MAX_TRAVEL_METRES, MAX_GAME_SECONDS, SAMPLE_MAX_WIDTH, SAMPLE_TIME_SLACK, SAMPLE_WIDTH, SAMPLE_WORK_SLACK_METRES } from './telemetry-rules.js';

/** Resource bounds, deliberately wider than the verdict's driving rules. Run before ANY road lookup, including on stored payloads whose summary is cached. */
export function unsafeSamples(seq: number, t1: number, samples: readonly (readonly number[])[], prefix: readonly (readonly number[])[] = []): string | null {
  if (!Number.isFinite(t1) || t1 < 0 || t1 > MAX_GAME_SECONDS) return `batch ${seq} holds a time out of range`;
  let previous: readonly number[] | null = null, travel = 0;
  for (const [i, row] of [...prefix.slice(-PREFIX_ROWS), ...samples].entries()) {
    if (!Array.isArray(row) || row.length < SAMPLE_WIDTH) return `a sample in batch ${seq} has ${Array.isArray(row) ? row.length : 0} values`;
    const [t = NaN, s = NaN, d = NaN, , v = NaN, , , hull = NaN] = row;
    if (row.length > SAMPLE_MAX_WIDTH || !row.every(Number.isFinite) || t < 0 || t > MAX_GAME_SECONDS || Math.abs(s) > MAX_REPORTED_DISTANCE
      || Math.abs(d) > 1e4 || v < 0 || v > 1000 || Math.abs(hull) > 1e4) return `sample ${i} of batch ${seq} holds a value out of range`;
    // A future sample clock cannot buy an arbitrarily distant road in a short batch.
    if (Math.abs(s) > SAMPLE_WORK_SLACK_METRES + 2 * MAX_SPEED * Math.min(t, t1 + SAMPLE_TIME_SLACK)) return `sample ${i} of batch ${seq} exceeds the road work bounds`;
    if (previous) {
      const ds = Math.abs(s - previous[1]!), dt = Math.max(0, t - previous[0]!);
      travel += ds;
      if (ds > SAMPLE_WORK_SLACK_METRES + 2 * MAX_SPEED * dt || travel > BATCH_MAX_TRAVEL_METRES) return `batch ${seq} exceeds the road work bounds`;
    }
    previous = row;
  }
  return null;
}
