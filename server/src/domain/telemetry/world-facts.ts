import { AXLES, HOLE_TYPES, WHEEL } from '../road/road-rules.js';
import type { RoadPlan } from '../road/road-plan.js';
import { SAMPLE_INPUT_COL } from './telemetry-rules.js';

/* The recording measured against the SERVER's road (domain/road): what the truck in the samples did at every hole of the ride's obstacle plan, where it
   was off the tarmac, and whether it ever gained speed with no gas. Measured once, when the batch is accepted (the ride's seed is known then), and stored
   in the batch summary beside the other measurements – the decisions (verdict/world-checks.ts) are taken at judging time, so a threshold change re-judges
   old batches too. Nothing is simulated: these are facts about the samples, compared with a road the client never had a say in. */

/** one axle crossing one pit of a planned hole (forward or back) */
export interface HolePass {
  /** `<hole id>:<pit>:<axle>` – the game hurts the truck once per key per ride, so the judge takes the first pass of a key only */
  key: string;
  hole: string;
  type: string;
  /** 0 front, 1 drive, 2 trailer (road-rules.ts AXLES) */
  axle: number;
  /** game time the axle passed the pit's centre */
  t: number;
  /** the pit's centre along the road */
  s: number;
  /** +1 forward, -1 reversing */
  dir: number;
  /** metres between the nearer wheel and the pit's edge, across the road: < 0 = the wheel ran through the pit, > 0 = it went past */
  miss: number;
  /** speed and hull just before the axle reached the pit (the last sample before its edge) and just after it passed the centre */
  v0: number;
  hull0: number;
  v1: number;
  hull1: number;
  /** no sample before the pit in this batch NOR in the previous batch's tail (the previous batch was not stored yet, or this is the first): not measurable */
  edge: boolean;
}

export interface WorldFacts {
  /** measurement format */
  v: number;
  holes: HolePass[];
  /** [t from, t to] of each spell off the tarmac (by the server's road; the start junction's area is not judged) */
  offroad: [number, number][];
  /** [t, Δv] of each step where the speed rose although the gas pedal was up at both samples and no gas key went down in between (flat road: impossible) */
  gasless: [number, number][];
}

/** NOT bumped for the fork switch (no pass is measured across it): a stored measurement of another version reads back as null and the batch would lose its
    road check – and no ride with a fork was measured before (forks came with the free levels) */
export const WORLD_FACTS_VERSION = 1;
/** a pass is recorded when the nearer wheel came within this many metres of the pit (further away it is just road) */
const PASS_REACH = 6;
/** the "before" sample must be this far before the pit's edge (the game hurts the axle as it enters the ellipse) */
const BEFORE_EDGE = 0.3;
/** a speed rise below this is the rows' rounding, not a rise (they hold 2 decimals) */
const RISE_NOISE = 0.05;
const MAX_GASLESS = 64;
/** rows of the previous batch measured with a batch: the client decides where a batch is cut, so a pass across the cut must be measured all the same
    (the "before" sample of a pass is at most a few metres back – 30 rows is 3 s) */
export const PREFIX_ROWS = 30;
const GAS_BIT = 1; // client/js/input-bits.js CONTROLS[0] = 'gas' (replay-inputs.spec.ts pins the order)

const col = (row: readonly number[], i: number): number => row[i] ?? Number.NaN;
const r2 = (v: number) => Math.round(v * 100) / 100;

const usable = (row: readonly number[]) => [0, 1, 2, 4, 7, 8].every((i) => Number.isFinite(col(row, i)));

/** `prefix` = the last rows of the previous batch: a pass or a speed step across the boundary is measured here (once – the previous batch measured only
    the steps inside it); off-road spells are this batch's own rows. */
export function measureWorld(samples: readonly (readonly number[])[], plan: RoadPlan, prefix: readonly (readonly number[])[] = []): WorldFacts {
  const own = samples.filter(usable), before = prefix.filter(usable).slice(-PREFIX_ROWS), rows = [...before, ...own];
  return { v: WORLD_FACTS_VERSION, holes: holePasses(rows, plan, before.length), offroad: offroad(own, plan), gasless: gasless(rows, before.length) };
}

function holePasses(rows: readonly (readonly number[])[], plan: RoadPlan, from: number): HolePass[] {
  const out: HolePass[] = [];
  for (let i = Math.max(1, from); i < rows.length; i++) {
    const p = rows[i - 1]!, q = rows[i]!;
    if (col(q, 0) <= col(p, 0)) continue;
    if (plan.layout.forkSwitch(col(p, 1), col(q, 1))) continue; // the step the game may have moved the truck onto the other road of a fork: d jumps by the gap between the roads, so where the wheels ran in between is unknown – no pass is claimed (not `edge`: OBSTACLE_UNMEASURED_FLAG of those would flag an honest driver)
    AXLES.forEach((ax, axle) => {
      const ap = col(p, 1) + ax, aq = col(q, 1) + ax;
      if (ap === aq) return;
      const lo = Math.min(ap, aq), hi = Math.max(ap, aq), dir = aq > ap ? 1 : -1;
      for (const h of plan.holesNear(lo - 4, hi + 4)) {
        const T = HOLE_TYPES[h.type];
        if (!T) continue;
        T.ells.forEach((e, pit) => {
          const cs = h.s + e.ds;
          if (!(cs > lo && cs <= hi)) return;
          const f = (cs - ap) / (aq - ap), d = col(p, 2) + f * (col(q, 2) - col(p, 2)), cl = h.lat + e.dl;
          const miss = Math.min(Math.abs(d - WHEEL - cl), Math.abs(d + WHEEL - cl)) - e.b;
          if (miss > PASS_REACH) return;
          const edge = cs - dir * e.a; // where the axle meets the pit
          let b = i - 1;
          while (b >= 0 && (col(rows[b]!, 1) + ax - edge) * dir > -BEFORE_EDGE) b--;
          const before = b >= 0 ? rows[b]! : p, after = rows[i + 1] && col(rows[i + 1]!, 7) < col(q, 7) ? rows[i + 1]! : q; // the next sample too, if the hull fell further there
          out.push({
            key: `${h.id}:${pit}:${axle}`, hole: h.id, type: h.type, axle, t: r2(col(p, 0) + f * (col(q, 0) - col(p, 0))), s: r2(cs), dir, miss: r2(miss),
            v0: r2(col(before, 4)), hull0: r2(col(before, 7)), v1: r2(col(q, 4)), hull1: r2(col(after, 7)), edge: b < 0,
          });
        });
      }
    });
  }
  return out;
}

function offroad(rows: readonly (readonly number[])[], plan: RoadPlan): [number, number][] {
  const out: [number, number][] = [];
  let from: number | null = null;
  for (const row of rows) {
    const off = plan.layout.onRoad(col(row, 1), col(row, 2)) === false;
    if (off && from === null) from = col(row, 0);
    if (!off && from !== null) { out.push([from, col(row, 0)]); from = null; }
  }
  if (from !== null) out.push([from, col(rows[rows.length - 1]!, 0)]);
  return out;
}

function gasless(rows: readonly (readonly number[])[], from: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = Math.max(1, from); i < rows.length && out.length < MAX_GASLESS; i++) {
    const p = rows[i - 1]!, q = rows[i]!;
    if (q.length <= SAMPLE_INPUT_COL || p.length <= SAMPLE_INPUT_COL) continue; // a recording from before the input column: a tap between two samples cannot be seen
    const dv = col(q, 4) - col(p, 4);
    if (dv > RISE_NOISE && col(p, 8) <= 0.01 && col(q, 8) <= 0.01 && !(col(q, SAMPLE_INPUT_COL) & GAS_BIT)) out.push([r2(col(q, 0)), r2(dv)]);
  }
  return out;
}

/** a stored measurement, validated (null = none, or another format) */
export function parseWorldFacts(raw: unknown): WorldFacts | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const w = raw as Partial<WorldFacts>;
  if (w.v !== WORLD_FACTS_VERSION || !Array.isArray(w.holes) || !Array.isArray(w.offroad) || !Array.isArray(w.gasless)) return null;
  return { v: w.v, holes: w.holes, offroad: w.offroad, gasless: w.gasless };
}
