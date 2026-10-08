import { BadRequestError } from '../shared/errors.js';
import { BATCH_MAX_BYTES, SAMPLE_COUNT_SLACK, SAMPLE_HZ, SAMPLE_RATE_SLACK, TRAFFIC_MAX_BYTES, TRAFFIC_MAX_FRAMES, type RecordingAllowance } from './telemetry-rules.js';

/** One input event: milliseconds since the ride started (wall time), the key / dash-button code, 1 = pressed 0 = released. */
export type InputEvent = [t: number, code: string, down: 0 | 1];

/** What the client uploads (already validated at the HTTP boundary). `samples` rows are `[t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch]` in GAME seconds. */
export interface BatchBody {
  seq: number;
  /** the previous batch's hash – the ride id for seq 0 */
  prevHash: string;
  t0: number;
  t1: number;
  samples: number[][];
  inputs: InputEvent[];
  /** the client's SHA-256 of `RideBatch.canonical(body)`; null = it could not hash */
  hash: string | null;
  /** the nearby traffic for replays (frames [t, …7 numbers per vehicle]) – not part of the canonical text, never judged; absent = none recorded */
  traffic?: number[][];
}

export interface RideBatchProps {
  rideId: string;
  seq: number;
  prevHash: string;
  hash: string | null;
  /** the server recomputed the client's hash and it matched */
  hashOk: boolean;
  t0: number;
  t1: number;
  samples: number;
  inputs: number;
  /** canonical JSON size */
  bytes: number;
  body: BatchBody;
  receivedAt: Date;
}

/** A stored recording batch. The chain (seq continuity, prevHash links) is judged over the whole ride by the verdict; here only the batch itself is checked. */
export class RideBatch {
  private constructor(private readonly p: RideBatchProps) {}

  /** The text both sides hash – key order fixed, `hash` itself left out. The client builds the same string (client/js/telemetry.js). */
  static canonical(body: Omit<BatchBody, 'hash'>): string {
    return JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs });
  }

  /** Accept an upload: sane time span and sample count for it, size cap, and – given the ride's `allowance` – no more game time or batches than the
      wall time since the start allows. `serverHash` = the server's own SHA-256 of the canonical text. */
  static accept(rideId: string, body: BatchBody, serverHash: string, now: Date, allowance?: RecordingAllowance, canonicalText?: string): RideBatch {
    if (body.t1 < body.t0) throw new BadRequestError('batch ends before it starts', 'bad_batch');
    if (allowance && body.t1 > allowance.maxGameSeconds) throw new BadRequestError('batch claims more driving than time has passed since the start', 'bad_batch');
    if (allowance && body.seq > allowance.maxSeq) throw new BadRequestError('too many batches for the time since the start', 'bad_batch');
    if (body.samples.length > (body.t1 - body.t0) * SAMPLE_HZ * SAMPLE_RATE_SLACK + SAMPLE_COUNT_SLACK) throw new BadRequestError('too many samples for the time span', 'bad_batch');
    const bytes = (canonicalText ?? RideBatch.canonical(body)).length; // the caller usually built the text already, to hash it
    if (bytes > BATCH_MAX_BYTES) throw new BadRequestError('batch too large', 'bad_batch');
    if (body.traffic && (body.traffic.length > TRAFFIC_MAX_FRAMES || JSON.stringify(body.traffic).length > TRAFFIC_MAX_BYTES)) body = { ...body, traffic: undefined };   // dropped, never refused
    return new RideBatch({
      rideId, seq: body.seq, prevHash: body.prevHash, hash: body.hash, hashOk: body.hash !== null && body.hash === serverHash,
      t0: body.t0, t1: body.t1, samples: body.samples.length, inputs: body.inputs.length, bytes, body, receivedAt: now,
    });
  }

  static restore(props: RideBatchProps): RideBatch {
    return new RideBatch({ ...props });
  }

  get rideId(): string { return this.p.rideId; }
  get seq(): number { return this.p.seq; }
  get prevHash(): string { return this.p.prevHash; }
  get hash(): string | null { return this.p.hash; }
  get hashOk(): boolean { return this.p.hashOk; }
  get t0(): number { return this.p.t0; }
  get t1(): number { return this.p.t1; }
  get body(): BatchBody { return this.p.body; }
  get receivedAt(): Date { return this.p.receivedAt; }

  snapshot(): RideBatchProps {
    return { ...this.p };
  }
}
