import { HOLE_TYPES, OFFROAD_FAIL_SECONDS, holeDamage } from '../road/road-rules.js';
import type { BatchFacts } from '../telemetry/ride-batch.entity.js';
import type { HolePass } from '../telemetry/world-facts.js';
import {
  GASLESS_MIN_DV, GASLESS_REJECT_GAIN, GASLESS_REJECT_STEPS, OBSTACLE_IGNORED_REJECT, OBSTACLE_UNMEASURED_FLAG, OFFROAD_FACTOR, OFFROAD_SLACK_SECONDS, PASS_CLEAR_METRES, PASS_DAMAGE_SHARE, PASS_MIN_DAMAGE,
} from './verdict-rules.js';
import type { VerdictReason } from './verdict.dto.js';

/* The recording against the SERVER's road. The server rebuilt the ride's road from its seed (domain/road) and handed the game that obstacle plan; every
   batch was measured against it when it arrived (telemetry/world-facts.ts). Here the measurements are judged:
   - a planned hole the truck's wheels ran through at speed must show in the hull – the game takes damage ∝ v² per axle. A game with the holes taken out
     drives straight through them undamaged: 'obstacle-ignored' (≥ OBSTACLE_IGNORED_REJECT holes) rejects, one such hole flags ('obstacle-no-impact').
     Where the client cuts its batches does not matter: each batch is measured with the tail of the one before; a pass that still could not be measured
     (batches stored out of order – before 2026-10 the server took them so; it refuses that now) counts, and OBSTACLE_UNMEASURED_FLAG such holes flag ('obstacle-unmeasured');
   - the game ends a ride after OFFROAD_FAIL_SECONDS off the tarmac: a recording that stays off much longer ignored that ('offroad-ignored', reject);
   - the road is flat, so only the engine can speed the truck up: speed gained with the gas pedal up and no gas key pressed is impossible
     ('accel-without-gas': GASLESS_REJECT_GAIN m/s or GASLESS_REJECT_STEPS steps reject, fewer flag).
   What this does NOT catch: a modified game that drives over the holes AND fakes the hull loss is a game that hit the holes – the check is that the
   recording is consistent with the server's road, not that the client is honest. Traffic is simulated in the browser and not part of the plan. */

export type PassKind = 'hit' | 'ignored' | 'avoided' | 'grazed' | 'crawled' | 'reversed' | 'wreck' | 'unmeasured';

export interface WorldScores {
  /** planned holes the truck came near, and per outcome (a hole counts once: hit if any axle took damage, ignored if every judged axle drove through it undamaged) */
  holes: number;
  hit: number;
  avoided: number;
  ignored: number;
  /** axle passes by outcome */
  passes: Partial<Record<PassKind, number>>;
  /** the longest the truck was off the tarmac, on the game's clock (off accrues, back on drains it 2× – as the game counts) */
  offroadSeconds: number;
  gaslessSteps: number;
  gaslessGain: number;
}

const reject = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'reject' });
const flag = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'flag' });
const round = (v: number, p = 10) => Math.round(v * p) / p;

/** What one axle pass shows. Exported for spectators (the watch page marks the passes) and the audit tool. */
export function classifyPass(p: HolePass): { kind: PassKind; expected: number; got: number } {
  const T = HOLE_TYPES[p.type], got = Math.max(0, round(p.hull0 - p.hull1, 100));
  const expected = T ? Math.min(holeDamage(T, p.v0, p.axle), Math.max(0, p.hull0)) : 0;
  const kind: PassKind = p.dir < 0 ? 'reversed' : p.miss > PASS_CLEAR_METRES ? 'avoided' : p.miss > -PASS_CLEAR_METRES ? 'grazed' : p.hull0 <= 0.5 ? 'wreck'
    : expected < PASS_MIN_DAMAGE ? 'crawled' : p.edge ? 'unmeasured' : got >= expected * PASS_DAMAGE_SHARE ? 'hit' : 'ignored';
  return { kind, expected: round(expected, 100), got };
}

/** the first pass of each key (the game hurts the truck once per pit and axle per ride – a second pass over it, e.g. after reversing, costs nothing) */
export function firstPasses(batches: readonly Pick<BatchFacts, 'summary'>[]): HolePass[] {
  const seen = new Map<string, HolePass>();
  for (const p of batches.flatMap((b) => b.summary.world?.holes ?? []).sort((a, b) => a.t - b.t)) if (!seen.has(p.key)) seen.set(p.key, p);
  return [...seen.values()];
}

export interface HoleOutcome { hole: string; type: string; s: number; t: number; outcome: 'hit' | 'ignored' | 'avoided' | 'unmeasured' | 'other'; expected: number; got: number }

/** per hole: hit if an axle took damage, ignored if at least one axle pass was judged and none took any, unmeasured if an axle ran through it at a
    damaging speed and could not be measured, avoided if every wheel went past */
export function holeOutcomes(passes: readonly HolePass[]): HoleOutcome[] {
  const byHole = new Map<string, HolePass[]>();
  for (const p of passes) byHole.set(p.hole, [...(byHole.get(p.hole) ?? []), p]);
  return [...byHole.values()].map((ps) => {
    const c = ps.map((p) => ({ p, ...classifyPass(p) })), first = ps[0]!;
    const has = (k: PassKind) => c.some((x) => x.kind === k);
    const outcome = has('hit') ? 'hit' : has('ignored') ? 'ignored' : has('unmeasured') ? 'unmeasured' : c.every((x) => x.kind === 'avoided') ? 'avoided' : 'other';
    return { hole: first.hole, type: first.type, s: first.s, t: Math.min(...ps.map((p) => p.t)), outcome, expected: round(c.reduce((a, x) => a + (x.kind === 'hit' || x.kind === 'ignored' ? x.expected : 0), 0)), got: round(c.reduce((a, x) => a + (x.kind === 'hit' || x.kind === 'ignored' ? x.got : 0), 0)) };
  });
}

/** null scores = no batch of this ride was measured against the road (recorded before the server rebuilt it): nothing to judge */
export function checkWorld(batches: readonly Pick<BatchFacts, 'summary'>[]): { reasons: VerdictReason[]; scores: WorldScores | null } {
  const measured = batches.filter((b) => b.summary.world);
  if (!measured.length) return { reasons: [], scores: null };
  const passes = firstPasses(measured), holes = holeOutcomes(passes), kinds: Partial<Record<PassKind, number>> = {};
  for (const p of passes) { const k = classifyPass(p).kind; kinds[k] = (kinds[k] ?? 0) + 1; }
  const ignored = holes.filter((h) => h.outcome === 'ignored'), unmeasured = holes.filter((h) => h.outcome === 'unmeasured');
  const offroadSeconds = offroadPeak(measured.flatMap((b) => b.summary.world!.offroad));
  const gasless = measured.flatMap((b) => b.summary.world!.gasless).filter(([, dv]) => dv >= GASLESS_MIN_DV), gain = round(gasless.reduce((a, [, dv]) => a + dv, 0), 100);
  const scores: WorldScores = { holes: holes.length, hit: holes.filter((h) => h.outcome === 'hit').length, avoided: holes.filter((h) => h.outcome === 'avoided').length, ignored: ignored.length, passes: kinds, offroadSeconds: round(offroadSeconds), gaslessSteps: gasless.length, gaslessGain: gain };
  const reasons: VerdictReason[] = [];
  const where = ignored.slice(0, 3).map((h) => `${h.type} at ${Math.round(h.s)} m (t ${Math.round(h.t)} s: ${h.got} % hull lost, the game takes ${h.expected} %)`).join('; ');
  if (ignored.length >= OBSTACLE_IGNORED_REJECT) reasons.push(reject('obstacle-ignored', `drove through ${ignored.length} of the ${holes.length} planned holes it reached without a scratch – ${where}`));
  else if (ignored.length) reasons.push(flag('obstacle-no-impact', `drove through a planned hole without a scratch – ${where}`));
  if (unmeasured.length >= OBSTACLE_UNMEASURED_FLAG) reasons.push(flag('obstacle-unmeasured', `${unmeasured.length} planned holes driven through could not be measured (their batches were stored out of order) – a person should look`));
  const offLimit = OFFROAD_FAIL_SECONDS * OFFROAD_FACTOR + OFFROAD_SLACK_SECONDS;
  if (offroadSeconds > offLimit) reasons.push(reject('offroad-ignored', `${round(offroadSeconds)} s off the road – the game ends the ride after ${OFFROAD_FAIL_SECONDS} s`));
  if (gain >= GASLESS_REJECT_GAIN || gasless.length >= GASLESS_REJECT_STEPS) reasons.push(reject('accel-without-gas', `the truck gained ${gain} m/s in ${gasless.length} steps with the gas pedal up – on a flat road only the engine can do that`));
  else if (gasless.length) reasons.push(flag('accel-without-gas', `the truck gained ${gain} m/s in ${gasless.length} step${gasless.length > 1 ? 's' : ''} with the gas pedal up`));
  return { reasons, scores };
}

/** the game's off-road counter replayed over the spells: off accrues, back on the road it drains at twice the rate – its highest value */
export function offroadPeak(spells: readonly (readonly [number, number])[]): number {
  let off = 0, peak = 0, last: number | null = null;
  for (const [a, b] of [...spells].sort((x, y) => x[0] - y[0])) {
    if (last !== null) off = Math.max(0, off - 2 * Math.max(0, a - last));
    off += Math.max(0, b - a);
    peak = Math.max(peak, off);
    last = b;
  }
  return peak;
}
