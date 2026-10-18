import { MAX_SPEED } from '../rides/ride-rules.js';
import type { RoadLayout } from '../road/road-layout.js';
import { step, type BatchSummary, type Step } from '../telemetry/batch-summary.js';
import type { BatchFacts } from '../telemetry/ride-batch.entity.js';
import { isPhoneInput, SAMPLE_HZ } from '../telemetry/telemetry-rules.js';
import {
  AGREE_METRES, AGREE_SHARE, COVERAGE_FLAG, COVERAGE_REJECT, FORK_SWITCH_SLACK_METRES, GAS_CODES, INPUT_EDGE_RATIO, INPUT_EDGE_SLACK, MISMATCH_METRES, MISMATCH_SHARE, MOVED_METRES,
  SAMPLE_GAP_REJECT, SPEED_TOLERANCE, TELEPORT_FACTOR, TELEPORT_SLACK_METRES,
} from './verdict-rules.js';
import type { VerdictReason } from './verdict.dto.js';

/* Validation of the recording itself – is it complete, untampered, inside the truck's bounds and in agreement with what the ride reported?
   Pure functions over the batches' FACTS (chain columns + the summary measured when each batch was accepted – domain/telemetry/batch-summary.ts);
   the samples themselves are never read again, and nothing is re-simulated. */

export interface RideFacts {
  rideId: string;
  /** the server's own driven seconds (heartbeat-credited) */
  driveSeconds: number;
  /** the distance the ride ended with */
  distance: number;
  ranked?: boolean;
  cleanMetres?: number | null;
}

export interface RecordingScores {
  batches: number;
  samples: number;
  inputs: number;
  recordedSeconds: number;
  coverage: number;
  maxSpeed: number;
  /** batches the client sent without a hash (its digest failed) – the server hashed them itself */
  unhashed: number;
  /** the longest game-time gap between two samples, across batches too (s; absent = not measured) */
  maxGap?: number;
  /** Σ Δs − Σ max(v)·Δt over the ride (m; absent = not measured): how far the position ran ahead of the recorded speed */
  speedExcess?: number;
  /** rising edges of the gas bit in the samples, and gas presses among the input events (absent = no input column) */
  gasEdges?: number;
  gasPresses?: number;
}

const reject = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'reject' });
const flag = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'flag' });
const round = (v: number, p = 100) => Math.round(v * p) / p;

/** The link batch n+1 must carry for batch n: n's hash, or `unhashed-<seq>` when the client could not hash n (client/js/telemetry.js). */
export const expectedLink = (prev: BatchFacts): string => prev.hash ?? `unhashed-${prev.seq}`;

/** seq 0, 1, 2… with no hole; batch 0 chained to the ride id, every later one to its predecessor; a hash the server could not reproduce rejects;
    a batch the client sent UNHASHED only flags – the server hashed it on arrival, so a missing client hash proves nothing by itself. */
export function checkChain(ride: RideFacts, batches: readonly BatchFacts[]): VerdictReason[] {
  if (batches.length === 0) return [reject('no-recording', 'no recording was uploaded for this ride')];
  const out: VerdictReason[] = [];
  const missing = batches.findIndex((b, i) => b.seq !== i);
  if (missing >= 0) out.push(reject('missing-batches', `batch ${missing} is missing`));
  const broken = batches.findIndex((b, i) => b.prevHash !== (i === 0 ? ride.rideId : expectedLink(batches[i - 1] as BatchFacts)));
  if (broken >= 0) out.push(reject('chain-broken', `batch ${batches[broken]?.seq} does not follow the one before it`));
  const wrong = batches.filter((b) => b.hash !== null && !b.hashOk).map((b) => b.seq);
  if (wrong.length) out.push(reject('hash-mismatch', `batch ${wrong.slice(0, 5).join(', ')} hash does not match its content`));
  const unhashed = batches.filter((b) => b.hash === null).map((b) => b.seq);
  if (unhashed.length) out.push(flag('unhashed-batch', `batch ${unhashed.slice(0, 5).join(', ')} arrived without the client's hash`));
  return out;
}

/** Every sample well-formed, in time order inside its batch, under the governor, and no jump the truck could not make between two samples – also across a batch boundary.
    A step where the game may have moved the truck onto the other road of a fork (the summary's forkStep; across a boundary: `layout`, the ride's road) is
    allowed FORK_SWITCH_SLACK_METRES more. Without `layout` a boundary step is a plain one. */
export function checkSamples(batches: readonly BatchFacts[], layout: Pick<RoadLayout, 'forkSwitch'> | null = null): { reasons: VerdictReason[]; maxSpeed: number } {
  let maxSpeed = 0, prevLast: [number, number] | null = null;
  for (const b of batches) {
    const s = b.summary;
    if (s.fault) return { reasons: [reject(s.fault.code, s.fault.detail)], maxSpeed };
    if (s.maxSpeed < 0 || s.maxSpeed > MAX_SPEED * SPEED_TOLERANCE) return { reasons: [reject('over-governor', `recorded ${round(s.maxSpeed)} m/s (governor ${MAX_SPEED})`)], maxSpeed: Math.max(maxSpeed, s.maxSpeed) };
    maxSpeed = Math.max(maxSpeed, s.maxSpeed);
    const worst: BatchSummary = { ...s, worstStep: s.worstStep ? { ...s.worstStep } : null, ...(s.forkStep ? { forkStep: { ...s.forkStep } } : {}) };
    if (prevLast && s.first) step(worst, prevLast, s.first, layout);   // the step from the last sample of the batch before to the first of this one
    const jump = ([w, slack, why]: [Step | null | undefined, number, string]) => w && w.ds > MAX_SPEED * w.dt * TELEPORT_FACTOR + TELEPORT_SLACK_METRES + slack ? reject('teleport', `${round(w.ds, 10)} m in ${round(w.dt)} s at t=${w.t} s${why}`) : null;
    const tp = jump([worst.worstStep, 0, '']) ?? jump([worst.forkStep, FORK_SWITCH_SLACK_METRES, ' (at a fork, where the road switches)']);
    if (tp) return { reasons: [tp], maxSpeed };
    if (s.last) prevLast = s.last;
  }
  return { reasons: [], maxSpeed };
}

/** The game time a batch really recorded: its declared span, but no more than its samples cover – neither in count (10 Hz) nor in their own span –
    so neither empty batches declaring [t0, t1] nor two samples 15 s apart nor 150 rows of one instant pass for a recorded batch (audit H1). */
export const recordedSecondsOf = (b: BatchFacts): number => {
  const s = b.summary, span = s.first && s.last ? s.last[0] - s.first[0] + 1 / SAMPLE_HZ : 0;
  if (s.fault) return Math.max(0, b.t1 - b.t0);   // its samples stop at the fault, which rejects on its own – no coverage noise beside it
  return Math.max(0, Math.min(b.t1 - b.t0, (s.samples - (s.dupT ?? 0)) / SAMPLE_HZ, span));   // rows of one instant record no time
};

/** The recording must end where the ride said it ended, and cover the time the server credited – or, if the server credited less than the distance needs
    at the governor, that time (a game clock that stood still while the truck moved credits nothing). A recording whose LAST batch never arrived ends early:
    the distance the truck could have covered in the missing seconds (governor × slack) is allowed, so a lost tail only costs coverage – it does not reject. */
export function checkAgreement(ride: RideFacts, batches: readonly BatchFacts[]): { reasons: VerdictReason[]; recordedSeconds: number; coverage: number } {
  const recordedSeconds = batches.reduce((sum, b) => sum + recordedSecondsOf(b), 0);
  const needed = Math.max(ride.driveSeconds, ride.distance / (MAX_SPEED * SPEED_TOLERANCE));
  const coverage = needed > 0 ? recordedSeconds / needed : 1;
  const out: VerdictReason[] = [];
  if (ride.distance > MOVED_METRES && batches.every((b) => b.summary.samples === 0)) out.push(reject('recording-empty', `${Math.round(ride.distance)} m driven and not one sample recorded`));
  const last = [...batches].reverse().find((b) => b.summary.last)?.summary.last ?? null;
  const missingSeconds = Math.max(0, ride.driveSeconds - (last?.[0] ?? 0));
  if (last && Math.abs(last[1] - ride.distance) > AGREE_METRES + AGREE_SHARE * ride.distance + MAX_SPEED * TELEPORT_FACTOR * missingSeconds) {
    out.push(reject('recording-mismatch', `the recording ends at ${Math.round(last[1])} m, the ride at ${Math.round(ride.distance)} m`));
  }
  if (ride.ranked) {
    const damaged = batches.find((b) => typeof b.summary.firstDamageS === 'number');
    if (damaged && typeof damaged.summary.firstDamageS === 'number') {
      const claimedClean = ride.cleanMetres ?? ride.distance;
      if (claimedClean > damaged.summary.firstDamageS + AGREE_METRES) {
        out.push(reject('clean-mismatch', `the ride claimed ${Math.round(claimedClean)} m clean, but the recording took hull damage at ${Math.round(damaged.summary.firstDamageS)} m`));
      }
    }
  }
  if (coverage < COVERAGE_REJECT) out.push(reject('recording-incomplete', `the recording covers ${Math.round(coverage * 100)} % of the ${Math.round(needed)} s driven`));
  else if (coverage < COVERAGE_FLAG) out.push(flag('recording-gaps', `the recording covers ${Math.round(coverage * 100)} % of the ${Math.round(needed)} s driven`));
  return { reasons: out, recordedSeconds, coverage };
}

/** How the samples move: no long gap between two of them, and a position that does not run ahead of its own speedometer – the game integrates s from v,
    so over a whole ride Σ Δs ≈ Σ v·Δt (audit H3: a generator advancing s at 50 m/s with v on the 28 m/s governor). Measured since 2026-10: a ride with
    a batch from before (no `gap` / `motion` in its summary) gets no opinion on that part. `layout` = the ride's road: a fork's road switch at a batch
    boundary is left out as inside a batch. */
export function checkMotion(ride: RideFacts, batches: readonly BatchFacts[], layout: Pick<RoadLayout, 'forkSwitch'> | null = null): { reasons: VerdictReason[]; maxGap?: number; speedExcess?: number } {
  const withSamples = batches.filter((b) => (b.summary.first && b.summary.last) || b.summary.fault);   // a faulted batch stays in: it breaks the steps (an EMPTY one does not)
  if (withSamples.length === 0) return { reasons: [] };
  let maxGap = 0, gapsKnown = true, excess = 0, motionKnown = true;
  withSamples.forEach((b, i) => {
    const s = b.summary;
    if (s.fault) return;   // a batch with a fault rejects on its own; its cut-short samples say nothing here – nor the steps beside it (below)
    if (s.samples > 1) { if (s.gap === undefined) gapsKnown = false; else maxGap = Math.max(maxGap, s.gap); }
    if (!s.motion || !s.edgeV) motionKnown = false; else excess += s.motion.ds - s.motion.vdt;
    const before = withSamples[i - 1]?.summary;
    if (!before || before.fault || !before.last || !s.first) return;   // across an EMPTY batch too (it is not in withSamples; the chain rejects a missing one): an empty batch at a pit must not hide the step
    const dt = Math.max(0, s.first[0] - before.last[0]), ds = s.first[1] - before.last[1];
    maxGap = Math.max(maxGap, dt);
    const over = before.edgeV && s.edgeV ? ds - Math.max(before.edgeV[1], s.edgeV[0]) * dt : 0;
    if (over <= 0 || !layout?.forkSwitch(before.last[1], s.first[1])) excess += over;   // the road is asked only when s ran ahead (it is built lazily)
  });
  const out: VerdictReason[] = [];
  if (gapsKnown && maxGap > SAMPLE_GAP_REJECT) out.push(reject('sample-gap', `${round(maxGap, 10)} s of driving without a sample`));
  if (motionKnown && excess > MISMATCH_METRES + MISMATCH_SHARE * ride.distance) out.push(reject('speed-mismatch', `the position ran ${Math.round(excess)} m ahead of the recorded speed over ${Math.round(ride.distance)} m`));
  return { reasons: out, ...(gapsKnown ? { maxGap: round(maxGap, 1000) } : {}), ...(motionKnown ? { speedExcess: round(excess, 10) } : {}) };
}

/** A truck that moved was driven: there are input events, and the gas was pressed. */
export function checkInputsPresent(ride: RideFacts, batches: readonly BatchFacts[]): VerdictReason[] {
  if (ride.distance <= MOVED_METRES) return [];
  const downs = batches.flatMap((b) => b.summary.inputs).filter((e) => e[2] === 1 && !isPhoneInput(e));
  if (downs.length === 0) return [reject('no-inputs', `${Math.round(ride.distance)} m driven without a single input event`)];
  if (!downs.some((e) => GAS_CODES.includes(e[1]))) return [reject('no-throttle-input', `${Math.round(ride.distance)} m driven without pressing the gas`)];
  return [];
}

/** The samples' gas bit against the input events: the game sets the bit while a gas key is held, so it cannot rise far more often than a gas key went down
    (a few edges come free: a key held before the recording started). Only when every batch has the input column; flag only. */
export function checkInputsAgree(batches: readonly BatchFacts[]): { reasons: VerdictReason[]; gasEdges?: number; gasPresses?: number } {
  if (batches.length === 0 || batches.some((b) => typeof b.summary.gasEdges !== 'number')) return { reasons: [] };
  const gasEdges = batches.reduce((n, b) => n + (b.summary.gasEdges ?? 0), 0);
  const gasPresses = batches.flatMap((b) => b.summary.inputs).filter((e) => e[2] === 1 && GAS_CODES.includes(e[1])).length;
  const reasons = gasEdges > gasPresses * INPUT_EDGE_RATIO + INPUT_EDGE_SLACK ? [flag('inputs-mismatch', `the samples show the gas pressed ${gasEdges} times, the input events ${gasPresses}`)] : [];
  return { reasons, gasEdges, gasPresses };
}

export function recordingScores(batches: readonly BatchFacts[], recordedSeconds: number, coverage: number, maxSpeed: number, extra: Pick<RecordingScores, 'maxGap' | 'speedExcess' | 'gasEdges' | 'gasPresses'> = {}): RecordingScores {
  return {
    batches: batches.length, samples: batches.reduce((n, b) => n + b.summary.samples, 0), inputs: batches.reduce((n, b) => n + b.summary.inputs.filter((e) => !isPhoneInput(e)).length, 0),
    recordedSeconds: round(recordedSeconds), coverage: round(coverage, 1000), maxSpeed: round(maxSpeed), unhashed: batches.filter((b) => b.hash === null).length, ...extra,
  };
}
