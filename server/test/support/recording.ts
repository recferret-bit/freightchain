import { createHash } from 'node:crypto';
import type { Agent } from './client.js';
import { HasherPort } from '../../src/application/ports/shared/hasher.port.js';
import type { BatchBody, InputEvent } from '../../src/domain/telemetry/ride-batch.entity.js';
import { RideBatch } from '../../src/domain/telemetry/ride-batch.entity.js';
import type { BatchReceiptDto } from '../../src/domain/telemetry/telemetry.dto.js';

/* Synthetic ride recordings for the tests: the same batch shape and hash chain the game client produces (client/js/telemetry.js), so the server's
   chain and human-likeness checks can be exercised without a browser. `humanRecording` jitters every hold and pause the way a person does;
   `botRecording` repeats identical timings, which the verdict must flag. */

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export class TestHasher extends HasherPort {
  sha256Hex(text: string): string { return sha256(text); }
}

/** The client's hash of a batch (over the canonical text, `hash` itself excluded). */
export const hashBatch = (b: Omit<BatchBody, 'hash'>): string => sha256(RideBatch.canonical(b));

/** mulberry32 – the game's own PRNG, so a recording is reproducible from its seed. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RecordingOptions {
  /** driven seconds the recording covers */
  seconds: number;
  batchSeconds?: number;
  seed?: number;
  /** 'human' = jittered holds and pauses · 'bot' = metronome timings · 'none' = no input events at all */
  inputs?: 'human' | 'bot' | 'none';
  /** cruise speed, m/s */
  speed?: number;
}

const round = (v: number, p: number) => Math.round(v / p) * p + 0; // + 0: no -0 (JSON writes it as 0, so a round trip would not compare equal)

/** The input events of a drive: gas held in long stretches, steering taps left / right, a clutch + gear change at the start. Times in ms (wall clock). */
function inputEvents(seconds: number, kind: 'human' | 'bot', rnd: () => number): InputEvent[] {
  const bell = () => (rnd() + rnd() + rnd()) / 3; // ≈ normal, 0..1
  const jitter = (base: number, spread: number) => (kind === 'human' ? base * Math.exp(spread * (bell() - 0.5) * 2) : base);
  const ev: InputEvent[] = [];
  const press = (t: number, code: string, hold: number) => { ev.push([round(t, 1), code, 1], [round(t + hold, 1), code, 0]); };
  press(800, 'ShiftLeft', jitter(1400, 0.3)); press(1100, 'KeyE', jitter(90, 0.4));
  let t = 2500;
  const end = seconds * 1000;
  while (t < end) {
    const hold = jitter(4000, 0.6), gap = jitter(900, 0.7);
    press(t, 'KeyW', Math.min(hold, end - t - 1));
    let s = t + jitter(600, 0.5);
    while (s < t + hold - 200) { press(s, rnd() < 0.5 ? 'KeyA' : 'KeyD', jitter(220, 0.6)); s += jitter(1800, 0.6); }
    t += hold + gap;
  }
  return ev.sort((a, b) => a[0] - b[0]);
}

/** `samples` rows: [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch] at 10 Hz of game time. */
function sampleRows(t0: number, t1: number, speed: number, rnd: () => number): number[][] {
  const rows: number[][] = [];
  for (let t = t0; t < t1 - 1e-9; t = round(t + 0.1, 0.1)) {
    const v = Math.min(speed, t * 1.2); // a gentle launch, then cruise
    rows.push([round(t, 0.1), round(v * t * 0.5 + (t > speed / 1.2 ? 0 : 0), 0.1), round(2.4 + (rnd() - 0.5) * 0.6, 0.01), round((rnd() - 0.5) * 0.02, 0.001), round(v, 0.01), Math.round(900 + v * 60), v < 3 ? 1 : v < 10 ? 3 : 5, 100, v < speed ? 1 : 0.6, 0, round((rnd() - 0.5) * 0.3, 0.01), 0]);
  }
  return rows;
}

/** A whole recording as the client would upload it: hash-chained batches of `batchSeconds` each, covering `seconds` of driving. */
export function recording(rideId: string, opts: RecordingOptions): BatchBody[] {
  const batchSeconds = opts.batchSeconds ?? 15, rnd = prng(opts.seed ?? 1), kind = opts.inputs ?? 'human';
  const events = kind === 'none' ? [] : inputEvents(opts.seconds, kind, rnd);
  const batches: BatchBody[] = [];
  let prevHash = rideId;
  for (let seq = 0, t0 = 0; t0 < opts.seconds; seq++, t0 += batchSeconds) {
    const t1 = Math.min(opts.seconds, t0 + batchSeconds);
    const inputs = events.filter((e) => e[0] >= t0 * 1000 && e[0] < t1 * 1000);
    const body = { seq, prevHash, t0, t1, samples: sampleRows(t0, t1, opts.speed ?? 24, rnd), inputs };
    const hash = hashBatch(body);
    batches.push({ ...body, hash });
    prevHash = hash;
  }
  return batches;
}

/** Uploads every batch through the real route; returns the receipts (and fails the test on a non-200). */
export async function upload(agent: Agent, rideId: string, batches: BatchBody[]): Promise<BatchReceiptDto[]> {
  const out: BatchReceiptDto[] = [];
  for (const b of batches) out.push((await agent.post(`/api/rides/${rideId}/batches`).send(b).expect(200)).body as BatchReceiptDto);
  return out;
}
