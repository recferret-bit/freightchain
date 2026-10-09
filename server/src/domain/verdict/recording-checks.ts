import { MAX_SPEED } from '../rides/ride-rules.js';
import { step, type BatchSummary } from '../telemetry/batch-summary.js';
import type { BatchFacts } from '../telemetry/ride-batch.entity.js';
import {
  AGREE_METRES, AGREE_SHARE, COVERAGE_FLAG, COVERAGE_REJECT, GAS_CODES, MOVED_METRES, SPEED_TOLERANCE, TELEPORT_FACTOR, TELEPORT_SLACK_METRES,
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

/** Every sample well-formed, in time order inside its batch, under the governor, and no jump the truck could not make between two samples – also across a batch boundary. */
export function checkSamples(batches: readonly BatchFacts[]): { reasons: VerdictReason[]; maxSpeed: number } {
  let maxSpeed = 0, prevLast: [number, number] | null = null;
  for (const b of batches) {
    const s = b.summary;
    if (s.fault) return { reasons: [reject(s.fault.code, s.fault.detail)], maxSpeed };
    if (s.maxSpeed < 0 || s.maxSpeed > MAX_SPEED * SPEED_TOLERANCE) return { reasons: [reject('over-governor', `recorded ${round(s.maxSpeed)} m/s (governor ${MAX_SPEED})`)], maxSpeed: Math.max(maxSpeed, s.maxSpeed) };
    maxSpeed = Math.max(maxSpeed, s.maxSpeed);
    const worst: BatchSummary = { ...s, worstStep: s.worstStep ? { ...s.worstStep } : null };
    if (prevLast && s.first) step(worst, prevLast, s.first);   // the step from the last sample of the batch before to the first of this one
    const w = worst.worstStep;
    if (w && w.ds > MAX_SPEED * w.dt * TELEPORT_FACTOR + TELEPORT_SLACK_METRES) return { reasons: [reject('teleport', `${round(w.ds, 10)} m in ${round(w.dt)} s at t=${w.t} s`)], maxSpeed };
    if (s.last) prevLast = s.last;
  }
  return { reasons: [], maxSpeed };
}

/** The recording must end where the ride said it ended, and cover the time the server credited. A recording whose LAST batch never arrived ends early:
    the distance the truck could have covered in the missing seconds (governor × slack) is allowed, so a lost tail only costs coverage – it does not reject. */
export function checkAgreement(ride: RideFacts, batches: readonly BatchFacts[]): { reasons: VerdictReason[]; recordedSeconds: number; coverage: number } {
  const recordedSeconds = batches.reduce((sum, b) => sum + Math.max(0, b.t1 - b.t0), 0);
  const coverage = ride.driveSeconds > 0 ? recordedSeconds / ride.driveSeconds : 1;
  const out: VerdictReason[] = [];
  const last = [...batches].reverse().find((b) => b.summary.last)?.summary.last ?? null;
  const missingSeconds = Math.max(0, ride.driveSeconds - (last?.[0] ?? 0));
  if (last && Math.abs(last[1] - ride.distance) > AGREE_METRES + AGREE_SHARE * ride.distance + MAX_SPEED * TELEPORT_FACTOR * missingSeconds) {
    out.push(reject('recording-mismatch', `the recording ends at ${Math.round(last[1])} m, the ride at ${Math.round(ride.distance)} m`));
  }
  if (coverage < COVERAGE_REJECT) out.push(reject('recording-incomplete', `the recording covers ${Math.round(coverage * 100)} % of the ${Math.round(ride.driveSeconds)} s driven`));
  else if (coverage < COVERAGE_FLAG) out.push(flag('recording-gaps', `the recording covers ${Math.round(coverage * 100)} % of the ${Math.round(ride.driveSeconds)} s driven`));
  return { reasons: out, recordedSeconds, coverage };
}

/** A truck that moved was driven: there are input events, and the gas was pressed. */
export function checkInputsPresent(ride: RideFacts, batches: readonly BatchFacts[]): VerdictReason[] {
  if (ride.distance <= MOVED_METRES) return [];
  const downs = batches.flatMap((b) => b.summary.inputs).filter((e) => e[2] === 1);
  if (downs.length === 0) return [reject('no-inputs', `${Math.round(ride.distance)} m driven without a single input event`)];
  if (!downs.some((e) => GAS_CODES.includes(e[1]))) return [reject('no-throttle-input', `${Math.round(ride.distance)} m driven without pressing the gas`)];
  return [];
}

export function recordingScores(batches: readonly BatchFacts[], recordedSeconds: number, coverage: number, maxSpeed: number): RecordingScores {
  return {
    batches: batches.length, samples: batches.reduce((n, b) => n + b.summary.samples, 0), inputs: batches.reduce((n, b) => n + b.summary.inputs.length, 0),
    recordedSeconds: round(recordedSeconds), coverage: round(coverage, 1000), maxSpeed: round(maxSpeed), unhashed: batches.filter((b) => b.hash === null).length,
  };
}
