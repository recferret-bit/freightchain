import { MAX_SPEED } from '../rides/ride-rules.js';
import type { InputEvent } from './ride-batch.entity.js';
import type { RoadLayout } from '../road/road-layout.js';
import type { RoadPlan } from '../road/road-plan.js';
import { SAMPLE_TIME_SLACK, SAMPLE_WIDTH } from './telemetry-rules.js';
import { measureWorld, parseWorldFacts, type WorldFacts } from './world-facts.js';

/* What the verdict needs from a batch, measured ONCE when the batch is accepted and stored beside it (telemetry.RideBatch.summary) – so judging a ride
   reads a few hundred bytes per batch instead of inflating and parsing every 10 Hz sample under the player lock (≈ 2–4 MB for a 1 h shift, 15–30 MB
   for 8 h). The summary holds MEASUREMENTS, never decisions: the thresholds (domain/verdict/verdict-rules.ts) are applied at judging time, so a rule
   change re-judges old batches too. Input events are small (a few hundred per batch) and the timing checks need every one, so they are kept as they are. */

export interface BatchSummary {
  /** summary format – bump when the shape changes (a batch stored with an older one is re-summarised from its payload) */
  v: number;
  samples: number;
  /** [t, s] of the first and the last sample (null = no samples) */
  first: [number, number] | null;
  last: [number, number] | null;
  maxSpeed: number;
  /** the step between two consecutive samples with the largest distance over what the governor allows: ds − MAX_SPEED × dt (null = fewer than two samples) */
  worstStep: Step | null;
  /** the same for the steps where the game may have moved the truck onto the other road of a fork (RoadLayout.forkSwitch – from the server's layout, the
      plan): s may jump ≈ 3 m forward there, so the judge allows it more (verdict-rules.ts FORK_SWITCH_SLACK_METRES). Only steps over the governor; absent
      when there is none (and in every summary from before the forks – those are read as they are, no version bump needed) */
  forkStep?: Step;
  /** a sample that is malformed or out of order, with the verdict's code for it (null = all well-formed) */
  fault: { code: 'bad-sample' | 'sample-out-of-order'; detail: string } | null;
  inputs: InputEvent[];
  /** the samples against the server's road (world-facts.ts): hole passes, off-road spells, speed gained without gas. Measured when the batch was accepted;
      null = not measured (a batch stored before the server rebuilt the road, re-summarised from its payload without the ride's seed) */
  world: WorldFacts | null;
}

export interface Step { ds: number; dt: number; t: number; over: number }

export const SUMMARY_VERSION = 1;

const round = (v: number, p = 100) => Math.round(v * p) / p;

/** Measure one batch; `plan` = the ride's road rebuilt from its seed (null: the world facts are not measured), `prefix` = the previous batch's samples
    (its tail is measured with this batch, so a pass across the cut is measured – world-facts.ts). */
export function summariseBatch(seq: number, t0: number, t1: number, samples: readonly (readonly number[])[], inputs: readonly InputEvent[], plan: RoadPlan | null = null, prefix: readonly (readonly number[])[] = []): BatchSummary {
  const out: BatchSummary = { v: SUMMARY_VERSION, samples: samples.length, first: null, last: null, maxSpeed: 0, worstStep: null, fault: null, inputs: inputs.map((e) => [e[0], e[1], e[2]]), world: plan ? measureWorld(samples, plan, prefix) : null };
  let prev: readonly number[] | null = null;
  for (const row of samples) {
    const [t = NaN, s = NaN, , , v = NaN] = row;
    if (row.length < SAMPLE_WIDTH) { out.fault ??= { code: 'bad-sample', detail: `a sample in batch ${seq} has ${row.length} values` }; break; }
    if (t < t0 - SAMPLE_TIME_SLACK || t > t1 + SAMPLE_TIME_SLACK || (prev && t < (prev[0] ?? 0) - SAMPLE_TIME_SLACK)) {
      out.fault ??= { code: 'sample-out-of-order', detail: `sample at t=${t} s is outside batch ${seq} or out of order` };
      break;
    }
    out.first ??= [round(t, 1000), round(s, 1000)]; // 3 decimals: the client rounds its rows already; a stored JSON number must read back equal
    out.last = [round(t, 1000), round(s, 1000)];
    out.maxSpeed = Math.max(out.maxSpeed, v);
    if (prev) step(out, prev, row, plan?.layout ?? null);
    prev = row;
  }
  out.maxSpeed = round(out.maxSpeed);
  return out;
}

/** The largest step over the governor so far – the one the teleport check looks at. Exported so the chain of batches can measure the step across a boundary.
    `layout` = the ride's road: a step over the governor that may be a fork's road switch is kept apart (forkStep); without it every step is a plain one. */
export function step(out: BatchSummary, prev: readonly number[], row: readonly number[], layout: Pick<RoadLayout, 'forkSwitch'> | null = null): void {
  const dt = Math.max(0, (row[0] ?? 0) - (prev[0] ?? 0)), ds = Math.abs((row[1] ?? 0) - (prev[1] ?? 0)), over = ds - MAX_SPEED * dt;
  const m: Step = { ds: round(ds, 10), dt: round(dt), t: row[0] ?? 0, over: round(over, 10) };
  if (over > 0 && layout?.forkSwitch(prev[1] ?? 0, row[1] ?? 0)) { if (!out.forkStep || over > out.forkStep.over) out.forkStep = m; return; } // (asked only over the governor: a step under it is no teleport in either bucket)
  if (!out.worstStep || over > out.worstStep.over) out.worstStep = m;
}

/** The stored JSON, validated; null when it is missing or of another version (the caller re-summarises from the payload). */
export function parseSummary(raw: unknown): BatchSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<BatchSummary>;
  if (s.v !== SUMMARY_VERSION || typeof s.samples !== 'number' || !Array.isArray(s.inputs) || typeof s.maxSpeed !== 'number') return null;
  return { v: SUMMARY_VERSION, samples: s.samples, first: s.first ?? null, last: s.last ?? null, maxSpeed: s.maxSpeed, worstStep: s.worstStep ?? null, ...(s.forkStep ? { forkStep: s.forkStep } : {}), fault: s.fault ?? null, inputs: s.inputs as InputEvent[], world: parseWorldFacts(s.world) };
}
