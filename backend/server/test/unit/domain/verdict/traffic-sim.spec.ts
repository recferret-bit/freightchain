import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TrafficSimulator } from '../../../../src/domain/verdict/traffic-sim.js';
import { SIMULATION_CONFIG, SIMULATION_TRIPS } from '../../../../src/domain/shared/index.js';

const baseline = JSON.parse(readFileSync(new URL('../../../fixtures/simulation/traffic-browser.json', import.meta.url), 'utf8')) as {
  cases: { seed: number; trip: string; route: string; steps: number; initial: unknown[]; hash: string; hurts: number; crossFrames: number; holeFrames: number }[];
};
const load = async (f: string): Promise<Record<string, any>> => import(/* @vite-ignore */ new URL(`../../../../../../frontend/client/js/${f}`, import.meta.url).href);

describe('TrafficSimulator uses the browser traffic model', () => {
  it('keeps verification defaults equal to every browser tunable and frozen trip it consumes', async () => {
    const [{ CFG }, { TRIPS }] = await Promise.all([load('config.js'), load('trips.js')]);
    for (const [key, value] of Object.entries(SIMULATION_CONFIG)) {
      if (key === 'TRUCK') expect(CFG.TRUCK).toMatchObject(value as object);
      else expect(CFG[key], key).toEqual(value);
    }
    expect(Object.keys(SIMULATION_TRIPS)).toEqual(Object.keys(TRIPS));
    for (const [id, trip] of Object.entries(SIMULATION_TRIPS)) {
      const { bends, traffic, cross, calm, start, road } = TRIPS[id];
      expect(trip, id).toEqual({ bends, traffic, cross, calm, start, ...(road ? { road } : {}) });
    }
  });

  it.each(baseline.cases)('matches the pre-refactor browser on $route / $trip (seed $seed)', (test) => {
    const sim = new TrafficSimulator(test.seed, test.trip, undefined, test.route);
    expect(sim.cars.map((a) => [a.id, a.def.type, a.preset, a.dir, a.s, a.v])).toEqual(test.initial);
    const hash = createHash('sha256'), dts = [1 / 60, 1 / 30, .05, .012];
    let t = 0;
    for (let frame = 0; frame < test.steps; frame++) {
      const dt = dts[frame % dts.length]!; t += dt;
      const s = t * 20, heading = sim.geometry.roadAt(s).t;
      const fatal = sim.stepPose(dt, { s, d: 2.4 + Math.sin(t / 3) * 3.2, psi: .1 * Math.sin(t / 4), tyaw: heading + Math.sin(t / 5) * .3,
        v: 20, vel: 20, hull: 100, rev: false, crashV: 0 }, t);
      const fork = sim.net.forkAt(sim.state.s);
      if (fork && sim.state.s > fork.f0 + 205 && sim.net.setChoice(fork, 1)) sim.clearStretch(fork.f0, fork.f1);
      const rows = sim.cars.map((a) => [a.id, a.def.type, a.preset, a.road.main ? 'main' : a.road.j!.id, a.dir, a.s, a.lat, a.v, a.lane, a.target, a.lv, a.state, a.hz, a.dLat, a.dV]);
      const st = sim.state;
      hash.update(JSON.stringify([rows, fatal, st.s, st.d, st.v, st.psi, st.hull, st.crashV], (_k, v: unknown) => typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v));
    }
    expect(hash.digest('hex')).toBe(test.hash);
    expect(sim.contacts.length).toBe(test.hurts);
  });

  it('fixtures exercise contacts, cross traffic and hole avoidance', () => {
    expect(baseline.cases.some((c) => c.hurts > 0)).toBe(true);
    expect(baseline.cases.some((c) => c.crossFrames > 0)).toBe(true);
    expect(baseline.cases.some((c) => c.holeFrames > 0)).toBe(true);
  });

  it('does not truncate a 0.5 second sample interval to one quarter second', () => {
    const a = new TrafficSimulator(42, 'free-1c'), b = new TrafficSimulator(42, 'free-1c');
    a.stepSamplePair([0, 0, 2.4, 0, 0], [.5, 0, 2.4, 0, 0]);
    for (let i = 1; i <= 10; i++) b.stepPose(.05, { ...b.state, s: 0, d: 2.4, v: 0, vel: 0 }, i * .05);
    expect(a.cars.map((c) => [c.id, c.s, c.v])).toEqual(b.cars.map((c) => [c.id, c.s, c.v]));
  });
  it('a duplicate timestamp cannot turn off traffic; a rejected long gap stops stale reconstruction', () => {
    const a = new TrafficSimulator(42, '1h'), b = new TrafficSimulator(42, '1h');
    const p = [0, 0, 2.4, 0, 0], q = [.1, 0, 2.4, 0, 0];
    a.stepSamplePair(p, p); a.stepSamplePair(p, q); b.stepSamplePair(p, q);
    expect(a.cars.map((c) => [c.id, c.s, c.v])).toEqual(b.cars.map((c) => [c.id, c.s, c.v]));
    const before = a.cars.map((c) => c.s);
    a.stepSamplePair(q, [4, 50, 2.4, 0, 20]);
    a.stepSamplePair([4, 50, 2.4, 0, 20], [4.1, 52, 2.4, 0, 20]);
    expect(a.cars.map((c) => c.s)).toEqual(before);
  });

});
