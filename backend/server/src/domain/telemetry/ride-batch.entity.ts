import { BadRequestError } from '../shared/errors.js';
import type { RoadPlan } from '../road/road-plan.js';
import { summariseBatch, type BatchSummary } from './batch-summary.js';
import { unsafeSamples } from './sample-safety.js';
import { BATCH_MAX_BYTES, SAMPLE_COUNT_SLACK, SAMPLE_HZ, SAMPLE_RATE_SLACK, TRAFFIC_MAX_BYTES, TRAFFIC_MAX_FRAMES, type RecordingAllowance } from './telemetry-rules.js';

/** One input event: milliseconds since the ride started (wall time), the key / dash-button code, 1 = pressed 0 = released. */
export type InputEvent = [t: number, code: string, down: 0 | 1];

/** What the client uploads (already validated at the HTTP boundary). `samples` rows are `[t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch]` in GAME seconds,
    + the replay columns `clock, flags, inputs` (telemetry-rules.ts SAMPLE_*_COL – never judged). */
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
  /** Hashed lossless frame inputs for the server-stamped traffic protocol. */
  trafficProof?: string;
  /** Optional client aux. Hashed after trafficProof. Absent keeps the canonical text unchanged. Oversized aux is dropped, not refused. */
  aux?: Record<string, unknown>;
  /** 2 = this batch carries a session-key MAC. Absent = v1. Not part of the canonical text. */
  protocol?: 2;
  /** lowercase hex HMAC-SHA256. Present only with protocol 2. Not part of the canonical text. */
  mac?: string;
  /** base64 deflate-raw of optional v2.1 streams. Not part of the canonical text and not judged at 10 Hz. */
  streams?: string;
  /** Enforce mode. Five deflate-raw payloads plus the tick window. Not part of the canonical text. */
  named?: { inp: string; clk: string; chk: string; mg: string; env: string; startTick: number; endTick: number };
}

/** Aux JSON larger than this is dropped (like an oversized traffic track), never a 400. */
export const AUX_MAX_CHARS = 64_000;

export function clampAux<T extends { aux?: Record<string, unknown> }>(body: T): T {
  if (body.aux === undefined) return body;
  if (JSON.stringify(body.aux).length > AUX_MAX_CHARS) {
    const { aux: _drop, ...rest } = body;
    return rest as T;
  }
  return body;
}

export interface RideBatchProps {
  rideId: string;
  seq: number;
  prevHash: string;
  hash: string | null;
  /** the server recomputed the client's hash and it matched */
  hashOk: boolean;
  /** the server's own SHA-256 of the canonical text (null: a row stored before it was kept) – the attestation's leaf of a batch the client could not hash */
  serverHash: string | null;
  t0: number;
  t1: number;
  samples: number;
  inputs: number;
  /** canonical JSON size */
  bytes: number;
  body: BatchBody;
  /** what the verdict reads (batch-summary.ts) – measured when the batch was accepted */
  summary: BatchSummary;
  receivedAt: Date;
}

/** What judging a ride reads per batch: the chain columns and the summary – never the samples themselves. A RideBatch is one; the repository lists them without the payload. */
export interface BatchFacts {
  seq: number;
  prevHash: string;
  hash: string | null;
  hashOk: boolean;
  /** absent / null on rows stored before it was kept */
  serverHash?: string | null;
  t0: number;
  t1: number;
  summary: BatchSummary;
  /** when the server took it (absent where the reader did not ask) */
  receivedAt?: Date;
}

/** A stored recording batch. The chain (seq continuity, prevHash links) is judged over the whole ride by the verdict; here only the batch itself is checked. */
export class RideBatch {
  private constructor(private readonly p: RideBatchProps) {}

  /** The text both sides hash – key order fixed, `hash` itself left out. `protocol` and `mac` stay out: the MAC is over this text. The client builds the same string (client/js/telemetry.js). */
  static canonical(body: Omit<BatchBody, 'hash'>): string {
    const kept = clampAux(body);
    return JSON.stringify({
      seq: kept.seq, prevHash: kept.prevHash, t0: kept.t0, t1: kept.t1, samples: kept.samples, inputs: kept.inputs,
      ...(kept.trafficProof !== undefined ? { trafficProof: kept.trafficProof } : {}),
      ...(kept.aux !== undefined ? { aux: kept.aux } : {}),
    });
  }

  /** Accept an upload: sane time span and sample count for it, size cap, and – given the ride's `allowance` – no more game time, batches or bytes
      (`storedBytes` = what the ride holds already) than the wall time since the start allows. `serverHash` = the server's own SHA-256 of the canonical text.
      `plan` = the ride's road rebuilt from its seed: the summary measures the samples against it (world-facts.ts), with `prefix` = the samples of the batch
      before (stored already – a pass across the cut the client chose is measured all the same). */
  static accept(rideId: string, body: BatchBody, serverHash: string, now: Date, allowance?: RecordingAllowance, canonicalText?: string, storedBytes = 0, plan: RoadPlan | null = null, prefix: readonly (readonly number[])[] = []): RideBatch {
    if (body.t1 < body.t0) throw new BadRequestError('batch ends before it starts', 'bad_batch');
    if (allowance && body.t1 > allowance.maxGameSeconds) throw new BadRequestError('batch claims more driving than time has passed since the start', 'bad_batch');
    if (allowance && body.seq > allowance.maxSeq) throw new BadRequestError('too many batches for the time since the start', 'bad_batch');
    if (body.samples.length > (body.t1 - body.t0) * SAMPLE_HZ * SAMPLE_RATE_SLACK + SAMPLE_COUNT_SLACK) throw new BadRequestError('too many samples for the time span', 'bad_batch');
    const bytes = (canonicalText ?? RideBatch.canonical(body)).length; // the caller usually built the text already, to hash it
    if (bytes > BATCH_MAX_BYTES) throw new BadRequestError('batch too large', 'bad_batch');
    if (allowance && storedBytes + bytes > allowance.maxBytes) throw new BadRequestError('the recording is larger than the time since the start allows', 'bad_batch');
    const unsafe = unsafeSamples(body.seq, body.t1, body.samples, prefix);
    if (unsafe) throw new BadRequestError(unsafe, 'bad_batch');
    if (body.traffic && (body.traffic.length > TRAFFIC_MAX_FRAMES || JSON.stringify(body.traffic).length > TRAFFIC_MAX_BYTES)) body = { ...body, traffic: undefined };   // dropped, never refused
    body = clampAux(body); // oversized aux is dropped, never a 400; canonical() already hashed the kept text
    return new RideBatch({
      rideId, seq: body.seq, prevHash: body.prevHash, hash: body.hash, hashOk: body.hash !== null && body.hash === serverHash, serverHash,
      t0: body.t0, t1: body.t1, samples: body.samples.length, inputs: body.inputs.length, bytes, body, summary: summariseBatch(body.seq, body.t0, body.t1, body.samples, body.inputs, plan, prefix, true), receivedAt: now,
    });
  }

  /** `summary` may be missing on a row stored before summaries existed (or of an older version): it is measured again from the body. */
  static restore(props: Omit<RideBatchProps, 'summary' | 'serverHash'> & { summary?: BatchSummary | null; serverHash?: string | null }): RideBatch {
    const summary = props.summary ?? summariseBatch(props.seq, props.t0, props.t1, props.body.samples, props.body.inputs);
    return new RideBatch({ ...props, serverHash: props.serverHash ?? null, summary });
  }

  get rideId(): string { return this.p.rideId; }
  get seq(): number { return this.p.seq; }
  get prevHash(): string { return this.p.prevHash; }
  get hash(): string | null { return this.p.hash; }
  get hashOk(): boolean { return this.p.hashOk; }
  get serverHash(): string | null { return this.p.serverHash; }
  get t0(): number { return this.p.t0; }
  get t1(): number { return this.p.t1; }
  get body(): BatchBody { return this.p.body; }
  get summary(): BatchSummary { return this.p.summary; }
  get receivedAt(): Date { return this.p.receivedAt; }

  snapshot(): RideBatchProps {
    return { ...this.p };
  }
}
