import { createHash } from 'node:crypto';
import type { Agent } from './client.js';
import { HasherPort } from '../../src/application/ports/shared/hasher.port.js';
import type { ChallengeDto } from '../../src/domain/rides/ride-challenge.js';
import type { BatchBody, InputEvent } from '../../src/domain/telemetry/ride-batch.entity.js';
import { RideBatch } from '../../src/domain/telemetry/ride-batch.entity.js';
import type { BatchReceiptDto } from '../../src/domain/telemetry/telemetry.dto.js';
import { RoadPlan } from '../../src/domain/road/road-plan.js';
import { AXLES, HOLE_TYPES, WHEEL, holeDamage } from '../../src/domain/road/road-rules.js';

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
  /** metres the recording ends at – the distance the ride reports at /end (default 14 m/s × seconds) */
  distance?: number;
  /** answers to the dispatch prompts: a press + release of `code` at `atMs` (ms since the start, the recording's input clock) */
  answers?: PromptAnswer[];
  /** append the replay columns the game writes (clock, switches, inputs – telemetry-rules.ts SAMPLE_*_COL); default: the 12 judged ones only */
  replay?: boolean;
  /** the ride's seed: the drive takes the damage the GAME takes at every hole of the server's plan its wheels run through (an honest recording).
      Without it the hull stays at 100 – a game with the holes taken out, which the verdict rejects once the drive crosses planned holes ('obstacle-ignored'). */
  road?: number;
  /** the ride's trip (Ride.trip – where its holes may start: the free run has none within its reach); default null = HOLE_FIRST */
  trip?: string | null;
}

/** client/js/input-bits.js, the bits these recordings use (the drift spec test/unit/domain/replay-inputs.spec.ts holds them to the client's table) */
export const INPUT_BIT = { gas: 1, left: 4, right: 8, clutch: 16, up: 32, wiper: 1 << 14, wash: 1 << 15, head: 1 << 16, cab: 1 << 17, mouse: 1 << 25 } as const;
const BIT_OF: Record<string, number> = { KeyW: INPUT_BIT.gas, KeyA: INPUT_BIT.left, KeyD: INPUT_BIT.right, ShiftLeft: INPUT_BIT.clutch, KeyE: INPUT_BIT.up,
  KeyR: INPUT_BIT.wiper, KeyX: INPUT_BIT.wash, KeyL: INPUT_BIT.head, KeyC: INPUT_BIT.cab };
/** the input column of the sample at `t` game seconds, as the game builds it: held then OR pressed since the previous sample (synthetic recordings: wall ms = game s × 1000) */
export function inputMaskAt(events: readonly InputEvent[], t: number, period = 0.1): number {
  let m = 0;
  const held = new Set<string>();
  for (const [ms, code, down] of events) {
    if (ms > t * 1000) break;
    if (down) { held.add(code); if (ms > (t - period) * 1000) m |= BIT_OF[code] ?? 0; } else held.delete(code);
  }
  for (const c of held) m |= BIT_OF[c] ?? 0;
  return m;
}

export interface PromptAnswer { atMs: number; code: string }

/** The answers a person gives: the prompt's first key, `reactionMs` after the server issued it (the heartbeat responses carry the prompts). */
export const answersFor = (challenges: readonly ChallengeDto[], reactionMs = 600): PromptAnswer[] =>
  challenges.map((c) => ({ atMs: c.issuedMs + reactionMs, code: c.codes[0] as string }));

const round = (v: number, p: number) => Math.round(v / p) * p + 0; // + 0: no -0 (JSON writes it as 0, so a round trip would not compare equal)

/** The input events of a drive: gas held in long stretches, steering taps left / right, a clutch + gear change at the start. Times in ms (wall clock). */
function inputEvents(seconds: number, kind: 'human' | 'bot', rnd: () => number): InputEvent[] {
  const bell = () => (rnd() + rnd() + rnd()) / 3; // ≈ normal, 0..1
  const jitter = (base: number, spread: number) => (kind === 'human' ? base * Math.exp(spread * (bell() - 0.5) * 2) : base);
  const ev: InputEvent[] = [];
  const press = (t: number, code: string, hold: number) => { ev.push([round(t, 1), code, 1], [round(t + hold, 1), code, 0]); };
  press(800, 'ShiftLeft', jitter(1400, 0.3)); press(1100, 'KeyE', jitter(90, 0.4));
  let t = kind === 'bot' ? 2537.3 : 2500;   // (a bot's times are exact but not on a coarse-timer grid)
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

/** `samples` rows: [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch] at 10 Hz of game time – a steady drive that reaches `distance` at `seconds`. */
function sampleRows(t0: number, t1: number, seconds: number, distance: number, rnd: () => number, replay?: (t: number) => number[]): number[][] {
  const rows: number[][] = [], v = distance / seconds;
  for (let t = t0; t < t1 - 1e-9; t = round(t + 0.1, 0.1)) {
    rows.push([round(t, 0.1), round((distance * t) / seconds, 0.1), round(2.4 + (rnd() - 0.5) * 0.6, 0.01), round((rnd() - 0.5) * 0.02, 0.001), round(v, 0.01), Math.round(900 + v * 60), 5, 100, 0.6, 0, round((rnd() - 0.5) * 0.3, 0.01), 0, ...(replay?.(round(t, 0.1)) ?? [])]);
  }
  return rows;
}

/** A whole recording as the client would upload it: hash-chained batches of `batchSeconds` each, covering `seconds` of driving. */
export function recording(rideId: string, opts: RecordingOptions): BatchBody[] {
  const batchSeconds = opts.batchSeconds ?? 15, rnd = prng(opts.seed ?? 1), kind = opts.inputs ?? 'human';
  const events = kind === 'none' ? [] : inputEvents(opts.seconds, kind, rnd);
  for (const a of opts.answers ?? []) events.push([round(a.atMs, 1), a.code, 1], [round(a.atMs + 70 + (Math.round(a.atMs) * 7919) % 190, 1), a.code, 0]); // a person's hold, 70–260 ms, not a fixed one (a long drive answers dozens of prompts: a narrow spread would read as uniform holds)
  events.sort((a, b) => a[0] - b[0]);
  const bodies: Omit<BatchBody, 'hash' | 'prevHash'>[] = [];
  for (let seq = 0, t0 = 0; t0 < opts.seconds; seq++, t0 += batchSeconds) {
    const t1 = Math.min(opts.seconds, t0 + batchSeconds);
    const inputs = events.filter((e) => e[0] >= t0 * 1000 && e[0] < t1 * 1000);
    bodies.push({ seq, t0, t1, samples: sampleRows(t0, t1, opts.seconds, opts.distance ?? 14 * opts.seconds, rnd, opts.replay ? (t) => [12.5, 3, inputMaskAt(events, t)] : undefined), inputs });
  }
  if (opts.road !== undefined) takeHoles(bodies.flatMap((b) => b.samples), opts.road, opts.trip ?? null);
  const batches: BatchBody[] = [];
  let prevHash = rideId;
  for (const b of bodies) {
    const body = { seq: b.seq, prevHash, t0: b.t0, t1: b.t1, samples: b.samples, inputs: b.inputs };
    const hash = hashBatch(body);
    batches.push({ ...body, hash });
    prevHash = hash;
  }
  return batches;
}

/** What the game does to the truck at the holes of the server's plan (client/js/sim/damage.js hitHoles): an axle whose wheel enters a pit costs the hull
    holeDamage(type, v, axle), once per pit and axle per ride. Applied to the rows in place, from the step the axle reached the pit on. */
export function takeHoles(rows: number[][], seed: number, trip: string | null = null): number {
  const plan = RoadPlan.forSeed(seed, trip), hit = new Set<string>();
  let lost = 0;
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i - 1], q = rows[i]!;
    if (p) AXLES.forEach((ax, axle) => {
      const a0 = p[1]! + ax, a1 = q[1]! + ax;
      if (a1 <= a0) return;
      for (const h of plan.holesNear(a0 - 4, a1 + 4)) HOLE_TYPES[h.type]!.ells.forEach((e, pit) => {
        const key = `${h.id}:${pit}:${axle}`, entry = h.s + e.ds - e.a, cl = h.lat + e.dl;
        if (hit.has(key) || !(entry > a0 && entry <= a1)) return;
        if (Math.min(Math.abs(q[2]! - WHEEL - cl), Math.abs(q[2]! + WHEEL - cl)) >= e.b) return;
        hit.add(key);
        lost += holeDamage(HOLE_TYPES[h.type]!, p[4]!, axle);
      });
    });
    q[7] = round(Math.max(0, q[7]! - lost), 0.1);
  }
  return lost;
}

/** the first `n` planned holes a truck in the right-hand lane drives through (their centres, m) – to size a drive that must cross some */
export function ownLaneHoles(seed: number, n: number, from = 0, trip: string | null = null): number[] {
  const plan = RoadPlan.forSeed(seed, trip), out: number[] = [];
  for (let s = from; out.length < n && s < 200_000; s += 2000) for (const h of plan.holesBetween(s, s + 2000)) if (out.length < n && Math.abs(h.lat - 2.4) < 0.01) out.push(h.s);
  return out;
}

/** Uploads every batch through the real route; returns the receipts (and fails the test on a non-200). */
export async function upload(agent: Agent, rideId: string, batches: BatchBody[]): Promise<BatchReceiptDto[]> {
  const out: BatchReceiptDto[] = [];
  for (const b of batches) out.push((await agent.post(`/api/rides/${rideId}/batches`).send(b).expect(200)).body as BatchReceiptDto);
  return out;
}
