import { readFileSync } from 'node:fs';
import { RoadLayout } from '../../../../src/domain/road/road-layout.js';
import { RoadPlan } from '../../../../src/domain/road/road-plan.js';
import * as R from '../../../../src/domain/road/road-rules.js';

/* The server judges a ride on ITS rebuild of the road (domain/road) – the game draws and drives on its own (client/js/net/network.js + net/obstacles.js).
   If the two ever disagreed, an honest driver would be judged against holes that were not on their screen. These run the GAME'S OWN MODULES (plain ES
   modules, no three.js) beside the port on many seeds and fail on any difference: the layout, every hole, and the constants they are built from. */

const clientUrl = (f: string) => new URL(`../../../../../client/js/${f}`, import.meta.url);
// a dynamic import with a computed specifier: the game's modules are plain JS without types
const load = async (f: string): Promise<Record<string, any>> => (await import(/* @vite-ignore */ clientUrl(f).href)) as Record<string, any>;

const SEEDS = [1, 2, 7, 42, 1234, 99_991, 2_147_483_647, 3_000_000_001, 0xdeadbeef, 4_294_967_295, ...Array.from({ length: 30 }, (_, i) => (i * 2_654_435_761) >>> 0)];
const REACH = 60_000; // m – beyond a 30-minute shift at the governor (≈ 50 km)

describe('the server\'s road = the game\'s road (drift)', () => {
  let game: { net: any; CFG: any; obstacles: any; patterns: any };
  beforeAll(async () => {
    const [network, config, obstacles, patterns] = await Promise.all([load('net/network.js'), load('config.js'), load('net/obstacles.js'), load('net/patterns.js')]);
    game = { net: network.net, CFG: config.CFG, obstacles, patterns };
  });

  it('the constants the road is built from are the game\'s', () => {
    const { CFG } = game;
    expect([CFG.CHUNK_LEN, CFG.START_ACCESS, CFG.START_TURN_R, CFG.HOLES, CFG.HOLE_CHANCE, CFG.HOLE_FIRST, CFG.OFFROAD_FAIL_SECONDS, CFG.MAX_SPEED])
      .toEqual([R.CHUNK_LEN, R.START_ACCESS, R.START_TURN_R, R.HOLES_ON, R.HOLE_CHANCE, R.HOLE_FIRST, R.OFFROAD_FAIL_SECONDS, R.HOLE_REF_SPEED]);
    expect([CFG.SIGNAL_GREEN, CFG.SIGNAL_CROSS, CFG.SIGNAL_AMBER, CFG.SIGNAL_CLEAR]).toEqual([R.SIGNAL_GREEN, R.SIGNAL_CROSS, R.SIGNAL_AMBER, R.SIGNAL_CLEAR]);
    expect(Object.keys(game.patterns.PATTERNS)).toEqual(Object.keys(R.PATTERNS)); // the generator walks them in this order
    for (const [id, p] of Object.entries(R.PATTERNS)) {
      const g = game.patterns.PATTERNS[id];
      expect({ lanes: g.lanes, seg: g.seg, len: g.len, bends: g.bends, junction: g.junction, fork: g.fork }, id).toEqual(p);
    }
    const F = game.patterns.FORK;
    expect({ len: F.len, commit: F.commit, corridor: F.corridor }).toEqual(R.FORK);
    expect(F.reach).toBe(R.FORK_SWITCH_REACH);
    expect(game.patterns.DEFAULT_WEIGHTS).toEqual(R.DEFAULT_WEIGHTS);
    for (const [id, t] of Object.entries(R.HOLE_TYPES)) {
      const g = game.obstacles.HOLES[id];
      expect({ ells: g.ells, dmg: g.dmg, slow: g.slow, lane: !!g.lane, cones: !!g.cones }, id).toEqual(t);
    }
  });

  it('no route sets its own road-pattern weights – so the layout is the seed\'s alone (the server never needs to know the route)', () => {
    for (const route of ['route66', 'stuart', 'siberia', 'brenner', 'panamerican']) {
      const src = readFileSync(clientUrl(`themes/${route}/index.js`), 'utf8');
      expect(src, route).not.toMatch(/\broads\s*:/);
    }
  });

  it('how the game drives over a hole: the axles, the wheel track, the crawl speed, the damage rule', () => {
    const damage = readFileSync(clientUrl('sim/damage.js'), 'utf8');
    expect(damage).toContain(`const AXLES = [${R.AXLES.map((a) => String(a).replace(/^(-?)0\./, '$1.')).join(', ')}], WHEEL = ${R.WHEEL},`);
    expect(damage).toContain(`clamp(st.v / 28, 0, 1.2) ** 2 * (axle ? ${String(R.REAR_AXLE_SHARE).replace(/^0/, '')} : 1)`);
    expect(damage).toContain(`if (st.v < ${R.CRAWL_SPEED}) return;`);
    expect(damage).toContain(`if (dmg >= ${String(R.MIN_HURT).replace(/^0/, '')}) hurt(`);
    expect(readFileSync(clientUrl('road-plan.js'), 'utf8')).toContain(`const WINDOW = ${R.ROAD_PLAN_WINDOW},`); // the game's plan requests fit the API's window
  });

  it.each(SEEDS)('seed %i: the same segments and junctions, and the same holes, chunk for chunk, over 60 km', (seed) => {
    const { net, obstacles } = game;
    net.setStyle({}); // no route weights (see above), straight road – the curvature is not part of the layout
    net.reset(seed);
    obstacles.clearHoleCache();
    const mine = new RoadLayout(seed).describe(REACH);
    expect(mine.segs.some((g) => g.pat === 'fork' || g.pat === 'dual')).toBe(false); // the old trips never get the new patterns (weight 0) – their layout is unchanged
    net.ensure(REACH);
    const segs = net.segs.filter((g: any) => g.s0 <= REACH).map((g: any) => ({ s0: g.s0, s1: g.s1, nR: g.nR, nL: g.nL, pat: g.pat }));
    const junctions = net.js.filter((j: any) => j.s <= REACH).map((j: any) => ({ id: j.id, kind: j.kind, s: j.s, signal: j.signal, arms: j.kind === 'start' ? [] : j.arms }));
    expect(mine.segs).toEqual(segs);
    expect(mine.junctions).toEqual(junctions);
    const plan = RoadPlan.forSeed(seed), theirs = plan.holesBetween(0, REACH);
    const game_ = [];
    for (let ci = 0; ci * R.CHUNK_LEN < REACH; ci++) {
      const h = obstacles.rollHole(ci);
      if (h) game_.push({ id: h.id, ci: h.ci, type: h.type, s: h.s, lat: h.lat });
    }
    expect(theirs).toEqual(game_);
    expect(theirs.length).toBeGreaterThan(20); // a 60 km road has dozens of sinkholes – the comparison is not vacuous
  });

  it('each trip\'s first natural hole is the same on both sides; the free run has none within its reach (trips.js holesFrom = TRIP_HOLE_FIRST)', async () => {
    const { net, obstacles } = game, trips = await load('trips.js');
    for (const id of Object.keys(trips.TRIPS)) expect(trips.TRIPS[id].holesFrom ?? R.HOLE_FIRST, id).toBe(R.holeFirstOf(id));
    expect(R.holeFirstOf(null)).toBe(R.HOLE_FIRST);   // a ride from before trips
    try {
      trips.setTrip('free');
      for (const seed of SEEDS.slice(0, 12)) {
        net.setStyle({}); net.reset(seed); obstacles.clearHoleCache();
        const theirs = RoadPlan.forSeed(seed, 'free').holesBetween(0, 20_000), game_ = [];
        for (let ci = 0; ci * R.CHUNK_LEN < 20_000; ci++) { const h = obstacles.rollHole(ci); if (h) game_.push({ id: h.id, ci: h.ci, type: h.type, s: h.s, lat: h.lat }); }
        expect(theirs, `seed ${seed}`).toEqual(game_);
        expect(theirs.every((h) => h.s >= net.Sm + 1200)).toBe(true);
        expect(theirs.length).toBeGreaterThan(5);   // further on, the road has its sinkholes as always
      }
    } finally { trips.setTrip('1h'); obstacles.clearHoleCache(); }
  });

  /** the second round of free levels: [crossroads, forks] each layout holds, however the seed falls (net/patterns.js xroad / open – exact by construction) */
  const EXACT: Record<string, [number, number]> = { 'free-g': [1, 0], 'free-1b': [1, 0], 'free-2b': [4, 1], 'free-3b': [6, 2], 'free-1c': [2, 0], 'free-2c': [3, 1] };

  it('each trip\'s LAYOUT knobs are the same on both sides (trips.js road = TRIP_ROADS), and so are its layout and holes', async () => {
    const { net, obstacles } = game, trips = await load('trips.js');
    for (const id of Object.keys(trips.TRIPS)) {
      const r = trips.TRIPS[id].road, mine = R.tripRoadOf(id);
      expect({ first: r?.first ?? ['country'], weights: r?.weights ?? R.DEFAULT_WEIGHTS, holeChance: r?.holeChance ?? 1, firstLen: r?.firstLen ?? [500, 1100] }, id).toEqual(mine);
    }
    try {
      for (const id of Object.keys(R.TRIP_ROADS)) {
        trips.setTrip(id);
        for (const seed of SEEDS.slice(0, 10)) {
          net.setStyle({}); net.reset(seed); obstacles.clearHoleCache();
          const layout = new RoadLayout(seed, id).describe(30_000);
          net.ensure(30_000);
          expect(layout.segs, `${id} seed ${seed}`).toEqual(net.segs.filter((g: any) => g.s0 <= 30_000).map((g: any) => ({ s0: g.s0, s1: g.s1, nR: g.nR, nL: g.nL, pat: g.pat })));
          expect(layout.junctions, `${id} seed ${seed}`).toEqual(net.js.filter((j: any) => j.s <= 30_000).map((j: any) => ({ id: j.id, kind: j.kind, s: j.s, signal: j.signal, arms: j.kind === 'start' ? [] : j.arms })));
          const theirs = RoadPlan.forSeed(seed, id).holesBetween(0, 30_000), game_ = [];
          for (let ci = 0; ci * R.CHUNK_LEN < 30_000; ci++) { const h = obstacles.rollHole(ci); if (h) game_.push({ id: h.id, ci: h.ci, type: h.type, s: h.s, lat: h.lat }); }
          expect(theirs, `${id} seed ${seed}`).toEqual(game_);
          const forks = layout.segs.filter((g) => g.pat === 'fork').length, cross = layout.junctions.filter((j) => j.kind !== 'start');
          if (id === 'free-1') expect(layout.junctions.length).toBe(1); // the first EASY: four lanes, no junction but the start
          if (['free-2', 'free-3'].includes(id)) expect(forks).toBeGreaterThan(0); // the first CROSSROADS / HARD split into two roads at least once
          const exact = EXACT[id];   // the second round: an EXACT number of crossroads (every one a four-way) and forks – and all of them before the finish line
          if (exact) {
            expect([cross.length, forks], `${id} seed ${seed}`).toEqual(exact);
            expect(cross.every((j) => j.kind === 'cross'), `${id} seed ${seed}`).toBe(true);
            const row = trips.TRIPS[id], dist = row.k * 28 * row.seconds, last = cross.at(-1)!;
            expect(last.s, `${id} seed ${seed}: the last crossroads lies before the finish line (${dist} m)`).toBeLessThan(dist - 100);
          }
        }
      }
    } finally { trips.setTrip('1h'); obstacles.clearHoleCache(); }
  });

  it('a fork\'s two roads close: they meet again at the merge with the same heading, so the road after it is where it was', async () => {
    const { net } = game, trips = await load('trips.js'), road = await load('road.js');
    try {
      trips.setTrip('free-2');
      net.setStyle({}); net.reset(42); net.ensure(5000);
      const f = net.forks[0], end = road.roadAt(f.f1 + 50), mid = net.sep((f.f0 + f.f1) / 2);
      net.setChoice(f, 1);
      const end2 = road.roadAt(f.f1 + 50);
      expect(Math.hypot(end.x - end2.x, end.z - end2.z)).toBeLessThan(1e-3);
      expect(Math.abs(end.t - end2.t)).toBeLessThan(1e-6);
      expect(mid).toBeGreaterThan(150); // the two roads are well apart in the middle
      expect(net.sep(f.f0 + R.FORK.commit + R.FORK_SWITCH_REACH)).toBeLessThanOrEqual(R.FORK.corridor + 0.5); // the server's corridor covers the gap at the commit point (and one frame past it)
      expect(net.sep(f.f0 + R.FORK.commit) - 2.8).toBeGreaterThan(R.FORK_SWITCH_JUMP); // the switch moves d by the gap: more than the jump a road switch is told by, even less a step's own drift
    } finally { trips.setTrip('1h'); }
  });

  it('the frame the truck crosses a fork\'s commit point is ON the road in both: sampled one frame past it, still on the road it is leaving – the apron reaches FORK_SWITCH_REACH further on the split side (never at the merge)', async () => {
    const { net } = game, trips = await load('trips.js');
    try {
      trips.setTrip('free-2');
      for (const seed of [42, 67, 1234]) {
        net.setStyle({}); net.reset(seed); net.ensure(8000);
        const mine = new RoadLayout(seed, 'free-2');
        for (const f of net.forks.slice(0, 2)) {
          f.choice = 0;
          const c = f.f0 + R.FORK.commit, other = (s: number) => -net.bulge(f) * net.sep(s);   // the other road's centre line, measured on this one
          for (const ds of [0, 0.7, 1.4]) for (const lane of [-2.4, 2.4]) {
            const s = c + ds, d = other(s) + lane;
            expect(net.onRoad(s, d), `seed ${seed} s ${s} d ${d}`).toBe(true);
            expect(mine.onRoad(s, d), `seed ${seed} s ${s} d ${d}`).toBe(true);
          }
          expect(net.onRoad(c + 3, other(c + 3) + 2.4)).toBe(false); // further on, the other road is not this one's
          expect(mine.forkApron(c + 3)).toBe(false);
          expect(mine.forkApron(f.f1 - R.FORK.commit - 1)).toBe(false); // the merge side: no reach there
          expect(mine.forkApron(f.f1 - R.FORK.commit + 1)).toBe(true);
        }
      }
    } finally { trips.setTrip('1h'); }
  });

  it('the off-road test agrees with the game\'s net.onRoad wherever the server answers (past the start junction)', () => {
    const { net } = game;
    for (const seed of SEEDS.slice(0, 8)) {
      net.setStyle({});
      net.reset(seed);
      const mine = new RoadLayout(seed);
      for (let s = mine.knownFrom; s < 20_000; s += 7.3) for (const d of [-40, -16, -9.5, -6, -4.9, -2, 0, 3, 4.9, 6, 9.5, 16, 40, 300]) {
        const a = mine.onRoad(s, d);
        expect(a, `seed ${seed} s ${s} d ${d}`).toBe(net.onRoad(s, d));
      }
      expect(mine.onRoad(mine.Sm, 30)).toBeNull(); // the start junction's area: the server does not answer, the judge does not count it
    }
  });

  it('on the free trips (free-1: the 1+1 → 2+2 taper out of the depot road; free-2 / free-3: forks): off the forks\' aprons the off-road test agrees; on them the server counts as road everything the game does (and a little more)', async () => {
    const { net } = game, trips = await load('trips.js');
    try {
      for (const id of ['free-1', 'free-2', 'free-3']) {
        trips.setTrip(id);
        for (const seed of SEEDS.slice(0, 5)) {
          net.setStyle({}); net.reset(seed);
          const mine = new RoadLayout(seed, id);
          for (let s = mine.knownFrom; s < 12_000; s += 7.3) for (const d of [-40, -20, -14, -9.5, -6, -2, 0, 3, 6, 9.5, 14, 20, 40]) {
            const a = mine.onRoad(s, d), g = net.onRoad(s, d);
            if (mine.forkApron(s)) { if (g) expect(a, `${id} seed ${seed} s ${s} d ${d}`).toBe(true); }
            else expect(a, `${id} seed ${seed} s ${s} d ${d}`).toBe(g);
          }
          for (let s = mine.Sm; s < mine.knownFrom; s += 1.7) for (const d of [-9.5, -8.9, -6, -4.9, -2, 0, 3, 4.9, 6, 8.9, 9.5]) { // the taper out of the depot road (below knownFrom the server answers only `true`, never `false`)
            const a = mine.onRoad(s, d);
            if (a !== null) expect(a, `${id} seed ${seed} s ${s} d ${d} (taper)`).toBe(net.onRoad(s, d));
          }
        }
      }
    } finally { trips.setTrip('1h'); }
  });
});
