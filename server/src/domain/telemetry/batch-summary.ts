import { MAX_SPEED } from '../rides/ride-rules.js';
import type { InputEvent } from './ride-batch.entity.js';
import type { RoadLayout } from '../road/road-layout.js';
import type { RoadPlan } from '../road/road-plan.js';
import { SAMPLE_INPUT_COL, SAMPLE_TIME_SLACK, SAMPLE_WIDTH } from './telemetry-rules.js';
import { unsafeSamples } from './sample-safety.js';
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
  /* Since the pentest of 2026-10 (fix-plan H1 / H3) – optional, absent in older summaries (absent = not measured: the verdict has no opinion there,
     so no SUMMARY_VERSION bump, which would drop the road facts of every older batch – their re-summary has no plan). */
  /** the longest game-time gap between two consecutive samples (s; absent = fewer than two samples) */
  gap?: number;
  /** speed of the first and the last sample (the boundary step's allowance across batches) */
  edgeV?: [number, number];
  /** rows that repeat the previous row's game time (the game samples on its own clock: never – a forger repeating rows to fill a batch) */
  dupT?: number;
  /** Σ Δs and Σ min(max(v of the two samples), MAX_SPEED) × Δt over the batch's steps – a fork's road switch left out of both (v capped: the game clamps
    it at the governor exactly, so a speedometer read above it buys no distance). Their difference is how far s ran ahead
      of the recorded speed: the game integrates s from v (ds = v·cosψ / (1 − k·d)), so only curves, a push and rounding add to it */
  motion?: { ds: number; vdt: number };
  /** rising edges of the gas bit in the input column (SAMPLE_INPUT_COL); null = the batch has no input column */
  gasEdges?: number | null;
  /** the recording's fingerprint: [s ÷ PRINT_METRES, d] – where across the road the truck was each time it entered the next PRINT_METRES of road. Keyed by
      the ROAD, not the clock (a copy shifted in time still matches); two drivers rarely hold the same line to a few cm over a kilometre – a recording copied
      from another rider of the same pool does (pentest H2, verdict/pool-attention.ts duplicateRecordings) */
  print?: [number, number][];
  /** the samples against the server's road (world-facts.ts): hole passes, off-road spells, speed gained without gas. Measured when the batch was accepted;
      null = not measured (a batch stored before the server rebuilt the road, re-summarised from its payload without the ride's seed) */
  world: WorldFacts | null;
}

export interface Step { ds: number; dt: number; t: number; over: number }

export const SUMMARY_VERSION = 1;
/** two samples of one game instant may differ by this much in s (rounding to 0.1 m) – more is a forged row */
export const ZERO_DT_METRES = 0.2;
/** the fingerprint's step along the road (m) */
export const PRINT_METRES = 25;
/** the gas pedal's bit in the input column (client/js/input-bits.js) */
const GAS_BIT = 1;

const round = (v: number, p = 100) => Math.round(v * p) / p;

/** Measure one batch; `plan` = the ride's road rebuilt from its seed (null: the world facts are not measured), `prefix` = the previous batch's samples
    (its tail is measured with this batch, so a pass across the cut is measured – world-facts.ts). */
export function summariseBatch(seq: number, t0: number, t1: number, samples: readonly (readonly number[])[], inputs: readonly InputEvent[], plan: RoadPlan | null = null, prefix: readonly (readonly number[])[] = []): BatchSummary {
  const unsafe = unsafeSamples(seq, t1, samples, prefix);
  const out: BatchSummary = { v: SUMMARY_VERSION, samples: samples.length, first: null, last: null, maxSpeed: 0, worstStep: null, fault: null, inputs: inputs.map((e) => [e[0], e[1], e[2]]), world: plan && !unsafe ? measureWorld(samples, plan, prefix) : null };
  if (unsafe) { out.fault = { code: 'bad-sample', detail: unsafe }; return out; }
  let prev: readonly number[] | null = null, gap = 0, ds = 0, vdt = 0, firstV = 0, gasEdges: number | null = 0, gasWas = false, dupT = 0, bucket = Number.NaN;
  const print: [number, number][] = [];
  for (const row of samples) {
    const [t = NaN, s = NaN, , , v = NaN] = row;
    if (row.length < SAMPLE_WIDTH) { out.fault ??= { code: 'bad-sample', detail: `a sample in batch ${seq} has ${row.length} values` }; break; }
    if (t < t0 - SAMPLE_TIME_SLACK || t > t1 + SAMPLE_TIME_SLACK || (prev && t < (prev[0] ?? 0))) {   // the game's clock never runs backwards (st.t only grows)
      out.fault ??= { code: 'sample-out-of-order', detail: `sample at t=${t} s is outside batch ${seq} or out of order` };
      break;
    }
    if (prev && t <= (prev[0] ?? 0) && Math.abs(s - (prev[1] ?? 0)) > ZERO_DT_METRES) {   // the game samples on its own clock: two rows of one instant cannot be apart (pentest S4-05)
      out.fault ??= { code: 'sample-out-of-order', detail: `the truck moved ${round(Math.abs(s - (prev[1] ?? 0)), 10)} m in no time at t=${t} s in batch ${seq}` };
      break;
    }
    out.first ??= [round(t, 1000), round(s, 1000)]; // 3 decimals: the client rounds its rows already; a stored JSON number must read back equal
    out.last = [round(t, 1000), round(s, 1000)];
    out.maxSpeed = Math.max(out.maxSpeed, v);
    const b = Math.floor(s / PRINT_METRES);
    if (b !== bucket) { bucket = b; print.push([b, round(row[2] ?? 0)]); }
    if (prev) {
      step(out, prev, row, plan?.layout ?? null);
      const dt = Math.max(0, t - (prev[0] ?? 0));
      gap = Math.max(gap, dt);
      if (dt === 0) dupT++;
      if (!plan?.layout.forkSwitch(prev[1] ?? 0, s)) { ds += s - (prev[1] ?? 0); vdt += Math.min(MAX_SPEED, Math.max(v, prev[4] ?? 0)) * dt; }
    } else firstV = v;
    const bits = row[SAMPLE_INPUT_COL];
    if (bits === undefined || gasEdges === null) gasEdges = null;
    else { const gas = (bits & GAS_BIT) !== 0; if (gas && !gasWas && prev) gasEdges++; gasWas = gas; }   // never on a batch's first sample: a gas held across the cut is no new press
    prev = row;
  }
  out.maxSpeed = round(out.maxSpeed);
  if (out.first && out.last && prev) {
    out.edgeV = [round(firstV), round(prev[4] ?? 0)];
    out.motion = { ds: round(ds, 1000), vdt: round(vdt, 1000) };
    out.gasEdges = gasEdges;
    out.dupT = dupT;
    out.print = print;
    if (samples.length > 1) out.gap = round(gap, 1000);
  }
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
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const pair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(num);
  const motion = s.motion && num(s.motion.ds) && num(s.motion.vdt) ? { motion: { ds: s.motion.ds, vdt: s.motion.vdt } } : {};
  return {
    v: SUMMARY_VERSION, samples: s.samples, first: s.first ?? null, last: s.last ?? null, maxSpeed: s.maxSpeed, worstStep: s.worstStep ?? null, ...(s.forkStep ? { forkStep: s.forkStep } : {}), fault: s.fault ?? null, inputs: s.inputs as InputEvent[],
    ...(num(s.gap) ? { gap: s.gap } : {}), ...(num(s.dupT) ? { dupT: s.dupT } : {}), ...(Array.isArray(s.print) && s.print.every(pair) ? { print: s.print } : {}), ...(pair(s.edgeV) ? { edgeV: s.edgeV } : {}), ...motion, ...(s.gasEdges === null || num(s.gasEdges) ? { gasEdges: s.gasEdges } : {}),
    world: parseWorldFacts(s.world),
  };
}
