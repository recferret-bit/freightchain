import { RoadPlan } from '../../../src/domain/road/road-plan.js';
import { summariseBatch } from '../../../src/domain/telemetry/batch-summary.js';
import { measureWorld, parseWorldFacts } from '../../../src/domain/telemetry/world-facts.js';
import { checkWorld, classifyPass, offroadPeak } from '../../../src/domain/verdict/world-checks.js';
import { ASSIST_HULL_DAMAGE } from '../../../src/domain/rides/ride-rules.js';
import { PASS_DAMAGE_SHARE } from '../../../src/domain/verdict/verdict-rules.js';
import { ownLaneHoles, takeHoles } from '../../support/recording.js';

/* The recording against the SERVER's road: a drive through the server's holes must show the damage the game takes there. Rows are built by hand on a
   known seed: a truck cruising in the right-hand lane meets the planned sinkholes in it. */
const SEED = 4242, plan = RoadPlan.forSeed(SEED), [H1, H2] = ownLaneHoles(SEED, 2) as [number, number];
const r2 = (v: number) => Math.round(v * 100) / 100;
/** [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch] (+ clock, flags, inputs when `mask` is given) at 10 Hz from s0 to s1 */
function drive(s0: number, s1: number, { v = 20, d = 2.4, gas = 0.6, mask }: { v?: number; d?: number; gas?: number; mask?: number } = {}): number[][] {
  const rows: number[][] = [];
  for (let t = 0, s = s0; s <= s1; t = r2(t + 0.1), s = r2(s + v * 0.1)) rows.push([t, Math.round(s * 10) / 10, d, 0, v, 1500, 6, 100, gas, 0, 0, 0, ...(mask === undefined ? [] : [12, 3, mask])]);
  return rows;
}
/** each batch measured as on upload: with the samples of the batch before it (`linked` false = the one before had not arrived) */
const judge = (...batches: number[][][]) => judgeAs(true, ...batches);
const judgeAs = (linked: boolean, ...batches: number[][][]) => checkWorld(batches.map((rows, i) => ({ summary: summariseBatch(i, rows[0]![0]!, rows.at(-1)![0]!, rows, [], plan, linked ? batches[i - 1] ?? [] : []) })));
/** the rows cut into batches right where an axle (front by default; all three = every pass of the hole) reaches each of the holes – the client chooses its cuts */
const cutAtHoles = (rows: number[][], holes: number[], axles = [2.2]) => {
  const out: number[][][] = [];
  let from = 0;
  const cuts = [...new Set(holes.flatMap((h) => axles.map((ax) => rows.findIndex((r) => r[1]! + ax >= h - 2))))].sort((a, b) => a - b);
  for (const i of cuts) { out.push(rows.slice(from, i)); from = i; }
  out.push(rows.slice(from));
  return out.filter((b) => b.length);
};
const codes = (r: { reasons: { code: string; severity: string }[] }) => r.reasons.map((x) => `${x.code}:${x.severity}`);

describe('the recording against the server\'s road', () => {
  it('the test seed has two sinkholes in the right-hand lane early on', () => {
    expect(H1).toBeGreaterThan(plan.layout.Sm);
    expect(H2).toBeGreaterThan(H1);
  });

  it('an honest drive through the planned holes takes the game\'s damage → nothing to say; every hole HIT', () => {
    const rows = drive(0, H2 + 40);
    expect(takeHoles(rows, SEED)).toBeGreaterThan(20); // 2 sinkholes × 3 axles at 20 m/s
    const w = judge(rows);
    expect(w.reasons).toEqual([]);
    expect(w.scores).toMatchObject({ hit: 2, ignored: 0, gaslessSteps: 0 });
    expect(w.scores!.passes.hit).toBe(6);
  });

  it('ASSIST (a free ride\'s half-wear mode) still passes: an honest assisted drive loses ASSIST_HULL_DAMAGE of the hull the holes cost – every hole is a HIT, nothing is said', () => {
    const rows = drive(0, H2 + 40);
    takeHoles(rows, SEED);
    for (const r of rows) r[7] = r2(100 - (100 - r[7]!) * ASSIST_HULL_DAMAGE);   // what client/js/sim/damage.js hurt() does under assist
    const w = judge(rows);
    expect(w.reasons).toEqual([]);
    expect(w.scores).toMatchObject({ hit: 2, ignored: 0 });
  });

  it('the assist factor is the game\'s (drift) and stays clear of the share a pass must lose, with room to spare', async () => {
    const { CFG } = (await import(/* @vite-ignore */ new URL('../../../../client/js/config.js', import.meta.url).href)) as { CFG: { ASSIST: { HULL_DMG: number } } };
    expect(CFG.ASSIST.HULL_DMG).toBe(ASSIST_HULL_DAMAGE);
    expect(ASSIST_HULL_DAMAGE).toBeGreaterThanOrEqual(PASS_DAMAGE_SHARE * 1.5);
  });

  it('a game with the holes taken out drives through them undamaged → REJECTED obstacle-ignored, naming where', () => {
    const w = judge(drive(0, H2 + 40));
    expect(codes(w)).toEqual(['obstacle-ignored:reject']);
    expect(w.reasons[0]!.detail).toContain(`sinkhole at ${Math.round(H1)} m`);
    expect(w.scores).toMatchObject({ hit: 0, ignored: 2 });
  });

  it('the client cuts its batches right at each pit: the pass is measured all the same (with the batch before) → still obstacle-ignored', () => {
    const rows = drive(0, H2 + 40), batches = cutAtHoles(rows, [H1, H2]);
    expect(batches.length).toBe(3);
    expect(codes(judge(...batches))).toEqual(['obstacle-ignored:reject']);
    const honest = drive(0, H2 + 40); takeHoles(honest, SEED);
    expect(judge(...cutAtHoles(honest, [H1, H2])).reasons).toEqual([]);
  });

  it('…and if those batches came in out of order (the one before was not stored yet), the holes cannot be measured – that flags (obstacle-unmeasured)', () => {
    const w = judgeAs(false, ...cutAtHoles(drive(0, H2 + 40), [H1, H2], [2.2, -0.4, -11.5]));   // a cut before every axle of every hole
    expect(codes(w)).toEqual(['obstacle-unmeasured:flag']);
    expect(w.scores!.passes.unmeasured).toBeGreaterThanOrEqual(2);
  });

  it('one such hole only flags (obstacle-no-impact) – a person looks at it', () => {
    expect(codes(judge(drive(0, H1 + 40)))).toEqual(['obstacle-no-impact:flag']);
  });

  it('going round the holes (the oncoming lane) or crawling through them is fine: avoided / crawled, never judged', () => {
    expect(judge(drive(0, H2 + 40, { d: -2.4 }))).toMatchObject({ reasons: [], scores: { avoided: 2, hit: 0, ignored: 0 } });
    const crawl = judge(drive(H1 - 20, H1 + 20, { v: 2.5 }));
    expect(crawl.reasons).toEqual([]);
    expect(crawl.scores!.passes.crawled).toBe(3);
  });

  it('a pass whose "before" sample is in the previous batch is not measured – and the first pass of a pit and axle is the one that counts (reversing back over it costs nothing in the game)', () => {
    const rows = drive(H1 - 3, H1 + 20); // starts inside the reach of the front axle: no sample before the pit
    const w = measureWorld(rows, plan);
    expect(w.holes.find((p) => p.axle === 0)?.edge).toBe(true);
    expect(classifyPass(w.holes.find((p) => p.axle === 0)!).kind).toBe('unmeasured');
    const there = drive(H1 - 30, H1 + 20), back = drive(H1 - 30, H1 + 20).reverse().map((r, i) => [r2(6 + i * 0.1), ...r.slice(1)]);
    takeHoles(there, SEED);
    const both = measureWorld([...there, ...back], plan);
    expect(both.holes.some((p) => p.dir < 0)).toBe(true);
    expect(judge([...there, ...back]).reasons).toEqual([]);
  });

  it('speed gained with the gas pedal up and no gas key between two samples: flat road, impossible → accel-without-gas (reject from 2 m/s or 5 steps; one step flags)', () => {
    const rows = drive(0, 200, { gas: 0, mask: 0 }).map((r, i) => { r[4] = r2(5 + i * 0.2); return r; });
    expect(codes(judge(rows))).toContain('accel-without-gas:reject');
    const one = drive(0, 200, { gas: 0, mask: 0 }); one[10]![4] = 20.3;
    expect(codes(judge(one))).toContain('accel-without-gas:flag');
    const withGas = drive(0, 200, { gas: 0, mask: 1 }).map((r, i) => { r[4] = r2(5 + i * 0.2); return r; }); // the gas key went down between the samples
    expect(codes(judge(withGas))).not.toContain('accel-without-gas:reject');
    const noColumn = drive(0, 200, { gas: 0 }).map((r, i) => { r[4] = r2(5 + i * 0.2); return r; }); // a recording from before the input column: no opinion
    expect(judge(noColumn).scores!.gaslessSteps).toBe(0);
  });

  it('off the tarmac for longer than the game allows → offroad-ignored; the game\'s counter drains twice as fast back on the road', () => {
    let s = plan.layout.knownFrom + 2000;
    while (plan.layout.near(s - 400, s + 2000).length) s += 500;
    expect(codes(judge(drive(s, s + 800, { v: 20, d: 30 })))).toEqual(['offroad-ignored:reject']); // 40 s in the sand
    expect(judge(drive(s, s + 300, { v: 20, d: 30 })).reasons).toEqual([]); // 15 s: the game would still be going
    expect(offroadPeak([[0, 15], [16, 30]])).toBe(27); // 15, −2 for the second back on the road, +14
    expect(offroadPeak([[0, 15], [30, 40], [41, 56]])).toBe(23); // drained to 0 by the 15 s back on the road, then 10, −2, +15
  });

  it('a recording measured before the server rebuilt the road has no world facts: nothing judged; a stored measurement reads back', () => {
    expect(checkWorld([{ summary: summariseBatch(0, 0, 1, drive(0, 20), []) }])).toEqual({ reasons: [], scores: null });
    const w = measureWorld(drive(0, H1 + 40), plan);
    expect(parseWorldFacts(JSON.parse(JSON.stringify(w)))).toEqual(w);
    expect(parseWorldFacts({ v: 99 })).toBeNull();
  });
});
