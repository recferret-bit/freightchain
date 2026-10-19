import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RoadPlan } from '../../../src/domain/road/road-plan.js';
import { FORK, FORK_SWITCH_JUMP, FORK_SWITCH_REACH } from '../../../src/domain/road/road-rules.js';
import * as roadPlans from '../../../src/domain/road/road-plan.js';
import { summariseBatch } from '../../../src/domain/telemetry/batch-summary.js';
import { RideBatch, type BatchBody, type BatchFacts } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { measureWorld } from '../../../src/domain/telemetry/world-facts.js';
import { checkSamples } from '../../../src/domain/verdict/recording-checks.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { checkWorld } from '../../../src/domain/verdict/world-checks.js';
import { hashBatch, takeHoles } from '../../support/recording.js';

// the judge's road plan, spied on (passed through): it must be built only when a step asks for it
vi.mock('../../../src/domain/road/road-plan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domain/road/road-plan.js')>();
  return { ...actual, roadPlanFor: vi.fn(actual.roadPlanFor) };
});

/* A FORK: crossing the commit point (FORK.commit m after the split) the game re-measures the truck on the road it is nearer to (client/js/net/orchestrator.js
   switchFork) – between two samples d jumps by the gap between the roads and s by up to ≈ 3 m forward. The server knows where that can happen from its own
   layout (RoadLayout.forkSwitch – never the client's column 15): no hole pass is claimed across that step, and its jump is allowed FORK_SWITCH_SLACK_METRES.
   The seed is one of the ~4 % of forks with a planned sinkhole within one switch step of the commit point (free-2, seed 67). */
const SEED = 67, TRIP = 'free-2', plan = RoadPlan.forSeed(SEED, TRIP);
const FORK_SEG = plan.layout.segAt(4170), C = FORK_SEG.s0 + FORK.commit;
const HOLE = plan.holesNear(C - 10, C + 10).find((h) => Math.abs(h.s - C) < 3)!;
const V = 28, STEP = V * 0.1, JUMP = 3; // at the governor, and the largest forward jump the switch makes
const START_T = 200; // enough driving time to reach this fork before the sampled excerpt starts
const r2 = (v: number) => Math.round(v * 100) / 100;
type Row = number[];
const row = (t: number, s: number, d: number): Row => [r2(t), r2(s), d, 0, V, 1900, 7, 100, 0.8, 0, 0, 0];

/** a drive over the commit point at 28 m/s: on the other road (d `before`, measured on the old spine) up to the sample at `pS`, then – re-measured on the
    new road – at d `after`, the next sample STEP + JUMP further on. Returns the rows and the index of the first sample on the new road. */
function switchDrive(pS: number, { before = 7.6, after = 1.4, shift = 0 }: { before?: number; after?: number; shift?: number } = {}): { rows: Row[]; at: number } {
  const rows: Row[] = [];
  for (let k = 20; k >= 0; k--) rows.push(row(START_T + (20 - k) * 0.1, pS - k * STEP + shift, before));
  for (let k = 0; k < 30; k++) rows.push(row(START_T + (21 + k) * 0.1, pS + STEP + JUMP + k * STEP + shift, after));
  return { rows, at: 21 };
}
/** the drive axle (−0.4 m) crosses the pit's centre 45 % into the switch step – the game never hurt it (before the switch it was beside the pit, after it, past it) */
const P_S = HOLE ? r2(HOLE.s + 0.4 - 0.45 * (STEP + JUMP)) : 0;
const facts = (rows: Row[], seq = 0, p: RoadPlan | null = plan, prefix: Row[] = []): BatchFacts =>
  ({ seq, prevHash: '', hash: null, hashOk: false, t0: rows[0]![0]!, t1: rows.at(-1)![0]!, summary: summariseBatch(seq, rows[0]![0]!, rows.at(-1)![0]!, rows, [], p, prefix) });
const codes = (r: { reasons: { code: string; severity: string }[] }) => r.reasons.map((x) => `${x.code}:${x.severity}`);

describe('a fork\'s road switch (the server\'s layout decides where)', () => {
  it('the test seed: a fork whose commit point has a planned sinkhole in the right-hand lane within one switch step', () => {
    expect(FORK_SEG.fork).toBe(true);
    expect(HOLE).toMatchObject({ type: 'sinkhole', lat: 2.4 });
    expect(Math.abs(HOLE.s - C)).toBeLessThan(1);
    expect(P_S).toBeLessThan(C);
    expect(P_S + STEP + JUMP).toBeGreaterThanOrEqual(C);
  });

  it('RoadLayout.forkSwitch: a forward step over the commit point (or starting at most FORK_SWITCH_REACH past it); never backwards, never elsewhere', () => {
    const L = plan.layout;
    expect(L.forkSwitch(C - 3, C + 3)).toBe(true);
    expect(L.forkSwitch(C - 3, C)).toBe(true);
    expect(L.forkSwitch(C + 0.5, C + 6)).toBe(true); // the game sampled the truck one frame past the point, before it moved it
    expect(L.forkSwitch(C + FORK_SWITCH_REACH + 0.1, C + 9)).toBe(false);
    expect(L.forkSwitch(C - 6, C - 0.1)).toBe(false);
    expect(L.forkSwitch(C + 3, C - 3)).toBe(false); // reversing: the game never switches
    expect(L.forkSwitch(FORK_SEG.s1 - FORK.commit - 3, FORK_SEG.s1 - FORK.commit + 3)).toBe(false); // the merge side: no switch there
    expect(RoadPlan.forSeed(SEED).layout.forkSwitch(C - 3, C + 3)).toBe(false); // the same seed on a trip without forks
    expect([plan.layout.canFork, RoadPlan.forSeed(SEED, 'free-3').layout.canFork]).toEqual([true, true]); // a trip that cannot fork answers at once (no layout walk per sample step)
    for (const trip of [null, 'classic', 'free', 'free-1', '1h', '4h', '8h']) expect(RoadPlan.forSeed(SEED, trip).layout.canFork, String(trip)).toBe(false);
    expect(L.forkSwitch(C - 3, C + 5000)).toBe(false); // far too long for a switch (a forged s is never generated out to)
    expect(L.forkSwitch(C - 3, 1e12)).toBe(false);
  });

  it('an honest driver switching roads at the commit point, a pit inside that step: no pass claimed across the jump – the trailer\'s later HIT counts, nothing is said', () => {
    const { rows, at } = switchDrive(P_S);
    expect(takeHoles(rows.slice(at), SEED, TRIP)).toBeGreaterThan(5); // the trailer axle drives through it on the new road – the game hurts it there
    const w = checkWorld([{ summary: summariseBatch(0, rows[0]![0]!, rows.at(-1)![0]!, rows, [], plan) }]);
    expect(w.reasons).toEqual([]);
    expect(w.scores).toMatchObject({ hit: 1, ignored: 0 });
    const keys = measureWorld(rows, plan).holes.filter((p) => p.hole === HOLE.id).map((p) => p.key);
    expect(keys).toContain(`${HOLE.id}:0:2`);
    expect(keys).not.toContain(`${HOLE.id}:0:1`); // the drive axle crossed the pit only inside the switch step
  });

  it('…and one who comes out of the switch in the other lane: no wheel ever touched the pit – nothing is said; without the exemption the jump of d read as the drive axle running THROUGH it undamaged → flagged (the bug)', () => {
    const { rows, at } = switchDrive(P_S, { after: -2.4 });
    expect(takeHoles(rows.slice(at), SEED, TRIP)).toBe(0); // the game hurts nothing: beside the pit before the switch, past it (or beside it) after
    const judgeIt = () => checkWorld([{ summary: summariseBatch(0, rows[0]![0]!, rows.at(-1)![0]!, rows, [], plan) }]);
    expect(judgeIt()).toMatchObject({ reasons: [], scores: { ignored: 0 } });
    const blind = vi.spyOn(plan.layout, 'forkSwitch').mockReturnValue(false);
    try {
      const w = judgeIt();
      expect(codes(w)).toEqual(['obstacle-no-impact:flag']);
      expect(w.reasons[0]!.detail).toContain(`sinkhole at ${Math.round(HOLE.s)} m`);
    } finally { blind.mockRestore(); }
  });

  it('the switch step at 28 m/s with the ≈ 3 m jump is no teleport; the same jump anywhere else still is', () => {
    const at = switchDrive(P_S).rows;
    const s = summariseBatch(0, START_T, START_T + 5, at, [], plan);
    expect(s.forkStep).toMatchObject({ ds: 5.8, dt: 0.1, over: 3 });
    expect(s.worstStep!.over).toBeLessThanOrEqual(0);
    expect(checkSamples([facts(at)]).reasons).toEqual([]);
    expect(STEP + JUMP).toBeGreaterThan(V * 0.1 * 1.2 + 2); // over the plain limit: the slack is what lets it through
    expect(codes(checkSamples([facts(switchDrive(P_S, { shift: 400 }).rows)]))).toEqual(['teleport:reject']); // inside the same fork, away from its commit point
    expect(codes(checkSamples([facts(at, 0, null)]))).toEqual(['teleport:reject']); // a batch measured without the ride's road: a plain step
    expect(codes(checkSamples([facts(switchDrive(C + 0.5).rows)]))).toEqual([]); // the last sample on the old road one frame past the point
    expect(codes(checkSamples([facts(switchDrive(C + FORK_SWITCH_REACH + 0.5).rows)]))).toEqual(['teleport:reject']);
  });

  it('a real teleport in the same batch is not hidden behind the excused switch step', () => {
    const { rows } = switchDrive(P_S);
    for (const r of rows.slice(40)) r[1] = r2(r[1]! + 4); // 2.8 + 4 m in 0.1 s, far from the commit point
    const s = summariseBatch(0, START_T, START_T + 5, rows, [], plan);
    expect(s.forkStep).toBeDefined();
    expect(codes(checkSamples([facts(rows)]))).toEqual(['teleport:reject']);
  });

  it('the switch step across a batch boundary: the judge asks the ride\'s layout – and RideVerdict.judge hands it over', () => {
    const { rows, at } = switchDrive(P_S), a = rows.slice(0, at), b = rows.slice(at);
    const batches = [facts(a, 0), facts(b, 1, plan, a)];
    expect(codes(checkSamples(batches, plan.layout))).toEqual([]);
    expect(codes(checkSamples(batches))).toEqual(['teleport:reject']); // without the layout the boundary step is a plain one
    const T0 = new Date(Date.UTC(2036, 9, 8, 12));
    const judged = (level: 1 | 2) => {
      const ride = Ride.createFree({ id: 'ride-f', wallet: 'w', seed: SEED, minSeconds: 3, now: T0, level });
      ride.start(T0);
      const done = Ride.restore({ ...ride.snapshot(), trip: level === 2 ? 'free-2' : 'free-1', lastS: b.at(-1)![1]!, lastT: START_T + 5, driveSeconds: START_T + 5, lastHbAt: new Date(T0.getTime() + (START_T + 5) * 1000) });
      const bodies: BatchBody[] = [];
      let prevHash = 'ride-f';
      for (const [seq, part] of [a, b].entries()) {
        const body = { seq, prevHash, t0: part[0]![0]!, t1: part.at(-1)![0]!, samples: part, inputs: [] };
        prevHash = hashBatch(body);
        bodies.push({ ...body, hash: prevHash });
      }
      const stored = bodies.map((x, i) => RideBatch.accept('ride-f', x, x.hash!, T0, undefined, undefined, 0, RoadPlan.forSeed(SEED, done.trip), i ? a : []));
      return RideVerdict.judge(done, stored, new Date(T0.getTime() + (START_T + 6) * 1000)).reasons.map((r) => r.code);
    };
    expect(judged(2)).not.toContain('teleport'); // the first round's free-2 trip: the seed's fork is there (rides stamped before the retune keep their road)
    expect(judged(1)).toContain('teleport'); // the first round's free-1: no fork on that road – the same jump is a teleport
  });
  it('a truck that STAYS on its road over the commit point is measured like anywhere else: through the sinkhole there without a scratch = ignored (the exemption is only for the step that jumped)', () => {
    const rows: Row[] = [];
    for (let k = 0; k < 50; k++) rows.push(row(START_T + k * 0.1, r2(C - 60 + k * STEP), 2.4)); // straight on in the pit's lane, the hull never moves
    const over = rows.findIndex((r, i) => i > 0 && rows[i - 1]![1]! < C && r[1]! >= C);
    expect(plan.layout.forkSwitch(rows[over - 1]![1]!, rows[over]![1]!)).toBe(true); // a step the layout would excuse…
    expect(Math.abs(rows[over]![2]! - rows[over - 1]![2]!)).toBeLessThan(FORK_SWITCH_JUMP); // …but d did not jump: no switch happened
    const keys = measureWorld(rows, plan).holes.filter((p) => p.hole === HOLE.id && p.miss < 0).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining([`${HOLE.id}:0:0`, `${HOLE.id}:0:1`, `${HOLE.id}:0:2`]));
    const w = checkWorld([{ summary: summariseBatch(0, rows[0]![0]!, rows.at(-1)![0]!, rows, [], plan) }]);
    expect(w.scores).toMatchObject({ ignored: 1 });
    expect(codes(w)).toEqual(['obstacle-no-impact:flag']);
  });

  it('the sample one frame past the commit point, still on the road the truck is leaving, is ON the road (the apron reaches FORK_SWITCH_REACH further) – no off-road spell', () => {
    const across = -(1.4 + 14.3); // the other road's lane, measured on this one
    for (const pS of [C, C + 0.7, C + 1.4]) {
      const { rows } = switchDrive(pS, { before: across, after: 1.4 });
      expect(measureWorld(rows, plan).offroad, String(pS)).toEqual([]);
    }
    expect(plan.layout.onRoad(C + FORK_SWITCH_REACH + 1, across)).toBe(false); // further on it is not this road
  });

  it('the judge builds the ride\'s road plan only when a step across a batch boundary is over the governor', () => {
    const spy = vi.mocked(roadPlans.roadPlanFor);
    const T0 = new Date(Date.UTC(2036, 9, 8, 12));
    const judge = (parts: Row[][]) => {
      const ride = Ride.createFree({ id: 'ride-l', wallet: 'w', seed: SEED, minSeconds: 3, now: T0, level: 2 });
      ride.start(T0);
      const done = Ride.restore({ ...ride.snapshot(), trip: TRIP, lastS: parts.at(-1)!.at(-1)![1]!, lastT: START_T + 5, driveSeconds: START_T + 5, lastHbAt: new Date(T0.getTime() + (START_T + 5) * 1000) });
      let prevHash = 'ride-l';
      const stored = parts.map((part, seq) => {
        const body = { seq, prevHash, t0: part[0]![0]!, t1: part.at(-1)![0]!, samples: part, inputs: [] };
        prevHash = hashBatch(body);
        return RideBatch.accept('ride-l', { ...body, hash: prevHash }, prevHash, T0, undefined, undefined, 0, RoadPlan.forSeed(SEED, TRIP), seq ? parts[seq - 1]! : []);
      });
      spy.mockClear();
      RideVerdict.judge(done, stored, new Date(T0.getTime() + (START_T + 6) * 1000));
      return spy.mock.calls.length;
    };
    const plain: Row[] = Array.from({ length: 40 }, (_, k) => row(k * 0.1, 1000 + k * STEP, 1.4));
    expect(judge([plain.slice(0, 20), plain.slice(20)])).toBe(0); // nothing over the governor: no road plan
    const { rows, at } = switchDrive(P_S);
    expect(judge([rows.slice(0, at), rows.slice(at)])).toBeGreaterThan(0); // the switch step across the boundary asks
  });
});
