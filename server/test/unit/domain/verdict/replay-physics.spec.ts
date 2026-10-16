import { ReplayPhysics } from '../../../../src/domain/verdict/replay-physics.js';
import { integrateLongitudinal, longitudinalForces, SIMULATION_CONFIG, type LongitudinalState } from '../../../../src/domain/shared/index.js';

const driving: LongitudinalState = { v: 15, gas: 1, brake: 0, clutch: 0, gear: 5, rpm: 2000, engineOn: true, rev: false, park: false };
const row = (t: number, v: number, s: Partial<LongitudinalState> = {}) => {
  const state = { ...driving, ...s };
  return [t, t * 15, 2.4, 0, v, state.rpm, state.gear, 100, state.gas, state.brake, 0, state.clutch, 12,
    (state.engineOn ? 1 : 0) | (state.park ? 4 : 0) | (state.rev ? 1024 : 0), 0, 0];
};

describe('shared browser force law and carried replay speed', () => {
  const force = (s: Partial<LongitudinalState>, pw = 1, eff = 1, off = false) => longitudinalForces({ ...driving, ...s }, SIMULATION_CONFIG, pw, eff, off).acceleration;
  it('neutral and an open clutch coast without torque even at full throttle', () => {
    const drag = -.18 - .0013 / 2.5 * 15 ** 2;
    expect(force({ gear: 0 })).toBeCloseTo(drag, 10);
    expect(force({ clutch: 1 })).toBeCloseTo(drag, 10);
    expect(force({})).toBeGreaterThan(drag);
  });
  it('uses RPM, engine state, brake fade, parking brake, cold power and reverse direction', () => {
    expect(force({ rpm: 700 })).toBeLessThan(force({}));
    expect(force({ rpm: 3100 })).toBeLessThan(-4);
    expect(force({ engineOn: false, brake: 1 })).toBe(force({ engineOn: false }));
    expect(force({ brake: 1 }) - force({})).toBeCloseTo(-5.5);
    expect(force({ brake: 1 }, 1, .25) - force({})).toBeCloseTo(-5.5 * .25);
    expect(force({ park: true }) - force({})).toBeCloseTo(-9);
    expect(force({}, .5)).toBeLessThan(force({}));
    expect(force({ gear: -1, rev: false })).toBeLessThan(0);
    expect(force({ gear: -1, rev: true })).toBeGreaterThan(0);
    expect(force({}, 1, 1, true) - force({})).toBeCloseTo(-1.2);
  });
  it('independently integrates actual forces at 20 and 60 Hz over a full braking trajectory', () => {
    let coarse = 15, fine = 15;
    for (let i = 0; i < 50; i++) {
      coarse = integrateLongitudinal({ ...driving, gas: 0, brake: .4, v: coarse }, SIMULATION_CONFIG, 1, 1, false, .1, 2);
      fine = integrateLongitudinal({ ...driving, gas: 0, brake: .4, v: fine }, SIMULATION_CONFIG, 1, 1, false, .1, 6);
    }
    expect(coarse).toBeLessThan(3);
    expect(Math.abs(coarse - fine)).toBeLessThan(.03);
  });
  it.each([{ brake: 1 }, { gear: 0 }, { clutch: 1 }, { park: true }, { engineOn: false }])('detects constant speed under sustained $brake / $gear / $clutch / $park / $engineOn without resetting from each sample', (state) => {
    const sim = new ReplayPhysics();
    for (let i = 1; i <= 100; i++) {
      sim.step(row((i - 1) / 10, 15, state), row(i / 10, 15, state), false);
      sim.step(row(i / 10, 15, state), row(i / 10, 15, state), false);
    }
    expect(sim.violations).toBeGreaterThan(3);
    expect(sim.maxExcess).toBeGreaterThan(.8);
  });
  it('accepts a braking trajectory with warm brakes and carries state through downward collision corrections', () => {
    const sim = new ReplayPhysics(); let v = 15;
    for (let i = 1; i <= 100; i++) {
      const before = v;
      v = integrateLongitudinal({ ...driving, brake: .8, v }, SIMULATION_CONFIG, 1, .7, false, .1, 6);
      if (i === 10) v *= .5;
      sim.step(row((i - 1) / 10, before, { brake: .8 }), row(i / 10, v, { brake: .8 }), false);
    }
    expect(sim.violations).toBe(0);
  });
  it('resets uncertainty across a recording gap', () => {
    const sim = new ReplayPhysics();
    for (let i = 1; i <= 20; i++) sim.step(row((i - 1) / 10, 15, { brake: 1 }), row(i / 10, 15, { brake: 1 }), false);
    const prior = sim.violations;
    sim.step(row(2, 15, { brake: 1 }), row(4, 15, { brake: 1 }), false);
    sim.step(row(4, 15, { brake: 1 }), row(4.1, 15, { brake: 1 }), false);
    expect(sim.violations).toBe(prior);
  });
});
