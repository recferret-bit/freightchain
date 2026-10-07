import { MAX_SPEED } from '../rides/ride-rules.js';
import type { RideBatch } from '../telemetry/ride-batch.entity.js';
import {
  AGREE_METRES, AGREE_SHARE, COVERAGE_FLAG, COVERAGE_REJECT, GAS_CODES, MOVED_METRES, SAMPLE_TIME_SLACK, SAMPLE_WIDTH, SPEED_TOLERANCE, TELEPORT_FACTOR, TELEPORT_SLACK_METRES,
} from './verdict-rules.js';
import type { VerdictReason } from './verdict.dto.js';

/* Validation of the recording itself – is it complete, untampered, inside the truck's bounds and in agreement with what the ride reported?
   Pure functions over the stored batches; nothing is re-simulated. Sample rows: [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch]. */

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
}

const reject = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'reject' });
const flag = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'flag' });
const round = (v: number, p = 100) => Math.round(v * p) / p;

/** seq 0, 1, 2… with no hole; batch 0 chained to the ride id, every later one to its predecessor's hash; every hash recomputed by the server. */
export function checkChain(ride: RideFacts, batches: readonly RideBatch[]): VerdictReason[] {
  if (batches.length === 0) return [reject('no-recording', 'no recording was uploaded for this ride')];
  const out: VerdictReason[] = [];
  const missing = batches.findIndex((b, i) => b.seq !== i);
  if (missing >= 0) out.push(reject('missing-batches', `batch ${missing} is missing`));
  const broken = batches.findIndex((b, i) => b.prevHash !== (i === 0 ? ride.rideId : batches[i - 1]?.hash));
  if (broken >= 0) out.push(reject('chain-broken', `batch ${batches[broken]?.seq} does not follow the one before it`));
  const unhashed = batches.filter((b) => !b.hashOk).map((b) => b.seq);
  if (unhashed.length) out.push(reject('hash-mismatch', `batch ${unhashed.slice(0, 5).join(', ')} hash does not match its content`));
  return out;
}

/** Every sample well-formed, in time order inside its batch, under the governor, and no jump the truck could not make between two samples. */
export function checkSamples(batches: readonly RideBatch[]): { reasons: VerdictReason[]; maxSpeed: number } {
  let prev: number[] | null = null, maxSpeed = 0;
  for (const b of batches) {
    for (const row of b.body.samples) {
      const [t = NaN, s = NaN, , , v = NaN] = row;
      if (row.length < SAMPLE_WIDTH) return { reasons: [reject('bad-sample', `a sample in batch ${b.seq} has ${row.length} values`)], maxSpeed };
      if (t < b.t0 - SAMPLE_TIME_SLACK || t > b.t1 + SAMPLE_TIME_SLACK || (prev && t < (prev[0] ?? 0) - SAMPLE_TIME_SLACK)) {
        return { reasons: [reject('sample-out-of-order', `sample at t=${t} s is outside batch ${b.seq} or out of order`)], maxSpeed };
      }
      if (v < 0 || v > MAX_SPEED * SPEED_TOLERANCE) return { reasons: [reject('over-governor', `recorded ${round(v)} m/s (governor ${MAX_SPEED})`)], maxSpeed: Math.max(maxSpeed, v) };
      maxSpeed = Math.max(maxSpeed, v);
      if (prev) {
        const dt = Math.max(0, t - (prev[0] ?? 0)), ds = Math.abs(s - (prev[1] ?? 0));
        if (ds > MAX_SPEED * dt * TELEPORT_FACTOR + TELEPORT_SLACK_METRES) return { reasons: [reject('teleport', `${round(ds, 10)} m in ${round(dt)} s at t=${t} s`)], maxSpeed };
      }
      prev = row;
    }
  }
  return { reasons: [], maxSpeed };
}

/** The recording must end where the ride said it ended, and cover the time the server credited. A recording whose LAST batch never arrived ends early:
    the distance the truck could have covered in the missing seconds (governor × slack) is allowed, so a lost tail only costs coverage – it does not reject. */
export function checkAgreement(ride: RideFacts, batches: readonly RideBatch[]): { reasons: VerdictReason[]; recordedSeconds: number; coverage: number } {
  const recordedSeconds = batches.reduce((sum, b) => sum + Math.max(0, b.t1 - b.t0), 0);
  const coverage = ride.driveSeconds > 0 ? recordedSeconds / ride.driveSeconds : 1;
  const out: VerdictReason[] = [];
  const last = batches.flatMap((b) => b.body.samples).at(-1);
  const missingSeconds = Math.max(0, ride.driveSeconds - (last?.[0] ?? 0));
  if (last && Math.abs((last[1] ?? 0) - ride.distance) > AGREE_METRES + AGREE_SHARE * ride.distance + MAX_SPEED * TELEPORT_FACTOR * missingSeconds) {
    out.push(reject('recording-mismatch', `the recording ends at ${Math.round(last[1] ?? 0)} m, the ride at ${Math.round(ride.distance)} m`));
  }
  if (coverage < COVERAGE_REJECT) out.push(reject('recording-incomplete', `the recording covers ${Math.round(coverage * 100)} % of the ${Math.round(ride.driveSeconds)} s driven`));
  else if (coverage < COVERAGE_FLAG) out.push(flag('recording-gaps', `the recording covers ${Math.round(coverage * 100)} % of the ${Math.round(ride.driveSeconds)} s driven`));
  return { reasons: out, recordedSeconds, coverage };
}

/** A truck that moved was driven: there are input events, and the gas was pressed. */
export function checkInputsPresent(ride: RideFacts, batches: readonly RideBatch[]): VerdictReason[] {
  if (ride.distance <= MOVED_METRES) return [];
  const downs = batches.flatMap((b) => b.body.inputs).filter((e) => e[2] === 1);
  if (downs.length === 0) return [reject('no-inputs', `${Math.round(ride.distance)} m driven without a single input event`)];
  if (!downs.some((e) => GAS_CODES.includes(e[1]))) return [reject('no-throttle-input', `${Math.round(ride.distance)} m driven without pressing the gas`)];
  return [];
}

export function recordingScores(batches: readonly RideBatch[], recordedSeconds: number, coverage: number, maxSpeed: number): RecordingScores {
  return {
    batches: batches.length, samples: batches.reduce((n, b) => n + b.body.samples.length, 0), inputs: batches.reduce((n, b) => n + b.body.inputs.length, 0),
    recordedSeconds: round(recordedSeconds), coverage: round(coverage, 1000), maxSpeed: round(maxSpeed),
  };
}
