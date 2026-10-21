import { intervalsMs, matchingIntervalRun, type HumannessInput, type InpEvent, type PointerTrace, type StimulusRt } from '../../domain/anticheat/humanness.js';
import { BadRequestError } from '../../domain/shared/errors.js';
import { worldDigest32 } from '../../domain/shared/index.js';
import type { BatchBody } from '../../domain/telemetry/ride-batch.entity.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import type { HasherPort } from '../ports/shared/hasher.port.js';
import { revealRideSalts } from '../rides/ride-salts.js';
import { spawnedWorldIds } from './spawned-world.js';

interface StepEvent { tick: number; gas?: number; brake?: number; gear?: number }
interface DigestPoint { tSec: number; digest: number; s?: number }
interface ParsedStream {
  steps: StepEvent[];
  events: InpEvent[];
  stimuli: StimulusRt[];
  holdsMs: number[];
  pointers: PointerTrace[];
  checks: DigestPoint[];
}

const emptyStream = (): ParsedStream => ({ steps: [], events: [], stimuli: [], holdsMs: [], pointers: [], checks: [] });

function takeRow(out: ParsedStream, row: Record<string, unknown>): void {
  if (typeof row.tick === 'number') out.steps.push({ tick: row.tick, gas: typeof row.gas === 'number' ? row.gas : undefined, brake: typeof row.brake === 'number' ? row.brake : undefined, gear: typeof row.gear === 'number' ? row.gear : undefined });
  if (typeof row.tUs === 'number' && typeof row.code === 'string') out.events.push({ tUs: row.tUs, code: row.code, down: row.down === true, ...(row.trusted === false ? { trusted: false } : {}) });
  if (typeof row.tSec === 'number' && typeof row.digest === 'number') out.checks.push({ tSec: row.tSec, digest: row.digest, ...(typeof row.s === 'number' ? { s: row.s } : {}) });
  if (typeof row.visibleAtUs === 'number' && typeof row.respondedAtUs === 'number') out.stimuli.push({ visibleAtUs: row.visibleAtUs, respondedAtUs: row.respondedAtUs });
  if (typeof row.points === 'number') out.pointers.push({ points: row.points });
  if (typeof row.holdMs === 'number') out.holdsMs.push(row.holdMs);
}

/** Inflated inp/chk JSON. An array is a mix of step, input, and digest rows. An object may split them. */
export function parseEnforceStream(raw: Buffer): ParsedStream {
  let value: unknown;
  try { value = JSON.parse(raw.toString('utf8')); }
  catch { throw new BadRequestError('enforce payload is not the stepper json', 'batch-streams-invalid'); }
  return readStream(value);
}

function readStream(value: unknown): ParsedStream {
  const out = emptyStream();
  if (Array.isArray(value)) {
    for (const row of value) if (row && typeof row === 'object') takeRow(out, row as Record<string, unknown>);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  const rec = value as Record<string, unknown>;
  for (const key of ['steps', 'events', 'checks', 'stimuli', 'pointers']) {
    const part = rec[key];
    if (!Array.isArray(part)) continue;
    const nested = readStream(part);
    out.steps.push(...nested.steps);
    out.events.push(...nested.events);
    out.stimuli.push(...nested.stimuli);
    out.pointers.push(...nested.pointers);
    out.checks.push(...nested.checks);
    out.holdsMs.push(...nested.holdsMs);
  }
  if (Array.isArray(rec.holdsMs)) out.holdsMs.push(...rec.holdsMs.filter((item): item is number => typeof item === 'number'));
  return out;
}

/** Metres along the road at `tSec`, from the chk row or the nearest 10 Hz sample (`[t, s, …]`). */
export function checkpointMetres(samples: readonly (readonly number[])[], tSec: number, explicit?: number): number {
  if (typeof explicit === 'number') return explicit;
  let best = samples[0]?.[1] ?? 0;
  let bestDt = Infinity;
  for (const row of samples) {
    const dt = Math.abs((row[0] ?? 0) - tSec);
    if (dt < bestDt) { bestDt = dt; best = row[1] ?? best; }
  }
  return best;
}

/** `worldDigest32` of the objects this ride's road and traffic already spawned within ±300 m. */
export function serverWorldDigest(seed: number, trip: string | null, s: number): number {
  return worldDigest32(spawnedWorldIds(seed, trip, s));
}

function closestOther(events: readonly InpEvent[], otherTraces: readonly (readonly number[])[]): readonly number[] {
  const gaps = intervalsMs(events);
  let best: readonly number[] = [];
  let run = 0;
  for (const row of otherTraces) {
    const matched = matchingIntervalRun(gaps, row);
    if (matched > run) { run = matched; best = row; }
  }
  return best;
}

export interface EnforceWindow { startTick: number; endTick: number }

export interface EnforceAssessment {
  /** chk points with the server digest beside the client's. The ingest and verdict paths call judgeWorldDigest on these. */
  points: { tSec: number; client: number; server: number }[];
  humanInput: HumannessInput;
  /** Absolute inp steps. The ingest path steps them at 1/30. */
  steps: StepEvent[];
  windows: EnforceWindow[];
}

/**
 * Enforce batches only. Re-derives salts and inflates the named streams.
 * The caller steps inp at 1/30 and judges the world digest and the humanness trace.
 * A batch with no named streams is left to the 10 Hz judge.
 */
export function assessEnforceBatches(hasher: HasherPort, ride: Ride, bodies: readonly BatchBody[], inflate: (raw: Buffer) => Buffer, otherTraces: readonly (readonly number[])[] = []): EnforceAssessment {
  const named = bodies.filter((body) => body.named);
  const empty: EnforceAssessment = { points: [], humanInput: { events: [], otherIntervalsMs: [] }, steps: [], windows: [] };
  if (!named.length) return empty;
  const salts = ride.sessionKey ? revealRideSalts(hasher, ride.id, ride.sessionKey) : null;
  const steps: StepEvent[] = [];
  const events: InpEvent[] = [];
  const stimuli: StimulusRt[] = [];
  const holdsMs: number[] = [];
  const pointers: PointerTrace[] = [];
  const points: { tSec: number; client: number; server: number }[] = [];
  const windows: EnforceWindow[] = [];
  for (const body of named) {
    const window = body.named!;
    const inp = parseEnforceStream(inflate(Buffer.from(window.inp, 'base64')));
    const chk = parseEnforceStream(inflate(Buffer.from(window.chk, 'base64')));
    steps.push(...inp.steps);
    events.push(...inp.events);
    stimuli.push(...inp.stimuli);
    holdsMs.push(...inp.holdsMs);
    pointers.push(...inp.pointers);
    windows.push({ startTick: window.startTick, endTick: window.endTick });
    if (!salts) continue;
    for (const check of chk.checks) {
      const s = checkpointMetres(body.samples, check.tSec, check.s);
      points.push({ tSec: check.tSec, client: check.digest, server: serverWorldDigest(ride.seed, ride.trip, s) });
    }
  }
  return { points, humanInput: { events, stimuli, holdsMs, pointers, otherIntervalsMs: closestOther(events, otherTraces) }, steps, windows };
}
