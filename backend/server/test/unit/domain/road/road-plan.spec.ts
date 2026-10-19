import { RoadLayout } from '../../../../src/domain/road/road-layout.js';
import { RoadPlan, roadPlanFor } from '../../../../src/domain/road/road-plan.js';
import { CHUNK_LEN, HOLE_FIRST } from '../../../../src/domain/road/road-rules.js';

describe('the server\'s road plan', () => {
  it('is a pure function of the seed: the same seed, the same holes; another seed, another road', () => {
    const a = RoadPlan.forSeed(1234).holesBetween(0, 50_000), b = RoadPlan.forSeed(1234).holesBetween(0, 50_000), c = RoadPlan.forSeed(4321).holesBetween(0, 50_000);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(15);
    expect(c).not.toEqual(a);
  });

  it('never puts a hole on the depot road, the turn, the first HOLE_FIRST metres, a junction or a lane taper', () => {
    const plan = RoadPlan.forSeed(77), net = plan.layout;
    for (const h of plan.holesBetween(0, 60_000)) {
      expect(h.s).toBeGreaterThanOrEqual(net.Sm + HOLE_FIRST);
      expect(net.plain(h.s, 70)).toBe(true);
      expect(Math.floor(h.s / CHUNK_LEN)).toBe(h.ci);
      expect(net.lanes(h.s, Math.sign(h.lat))).toBeGreaterThanOrEqual(1);
    }
  });

  it('a window is chunk-aligned and holds exactly the chunks in it; a cached plan per seed is the same object', () => {
    const w = RoadPlan.forSeed(5).window('r', 100, 3000);
    expect([w.from, w.to]).toEqual([96, 3008]);
    expect(w.holes.every((h) => h.ci * CHUNK_LEN >= w.from && h.ci * CHUNK_LEN < w.to)).toBe(true);
    expect(roadPlanFor(5)).toBe(roadPlanFor(5));
  });

  it('the off-road answer: the lanes (+ .5 m) are road, the sand beside them is not, the start junction is not answered', () => {
    const net = new RoadLayout(9);
    let s = net.knownFrom + 3000;
    while (net.near(s - 100, s + 100).length) s += 50;   // away from junctions (their aprons and side roads are road too)
    const [l, r] = net.edges(s);
    expect(net.onRoad(s, 0)).toBe(true);
    expect(net.onRoad(s, r + 0.4)).toBe(true);
    expect(net.onRoad(s, r + 12)).toBe(false);
    expect(net.onRoad(s, l - 12)).toBe(false);
    expect(net.onRoad(net.Sm + 10, 40)).toBeNull();
  });
});
