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
      expect({ lanes: g.lanes, seg: g.seg, len: g.len, bends: g.bends, junction: g.junction }, id).toEqual(p);
    }
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
});
