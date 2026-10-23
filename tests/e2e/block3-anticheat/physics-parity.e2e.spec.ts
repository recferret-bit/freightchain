import { describe, expect, it } from 'vitest';
import { REPLAY_SIM_HZ, stepAt30Hz } from '../../../frontend/client/shared/physics.js';
import { continueInpAt30Hz, stepInpAt30Hz } from '../../../frontend/client/shared/telemetry-codec.js';
import { drive } from './harness/driver-bot.js';

const HOUR_TICKS = 108_000;
const WINDOW = 50_000;
const inp = [{ tick: 0, gas: 1, brake: 0, gear: 6 }];

const rolling = { v: 18, gear: 4, gas: 0, brake: 0, clutch: 0, rpm: 2000, engineOn: true, park: false, rev: false };

describe('AC-P physics parity', () => {
  it('AC-P1 perfect 108000-tick drive stays under 1500 ms on game and kernel', () => {
    const game = drive({ engine: 'game', profile: 'perfect', ticks: HOUR_TICKS });
    const kernel = drive({ engine: 'kernel', profile: 'perfect', ticks: HOUR_TICKS });
    expect(game.cpuMs).toBeLessThan(1500);
    expect(kernel.cpuMs).toBeLessThan(1500);
    expect(game.ticks).toBe(HOUR_TICKS);
    expect(kernel.ticks).toBe(HOUR_TICKS);
  });

  it('AC-P2 game and kernel speeds and gears match', () => {
    const game = drive({ engine: 'game', profile: 'perfect', ticks: HOUR_TICKS });
    const kernel = drive({ engine: 'kernel', profile: 'perfect', ticks: HOUR_TICKS });
    expect(Math.abs(game.state.v - kernel.state.v)).toBeLessThan(0.001);
    expect(game.state.gear).toBe(kernel.state.gear);
  });

  it('AC-P3 a second kernel run matches the first', () => {
    const first = drive({ engine: 'kernel', profile: 'perfect', ticks: HOUR_TICKS });
    const second = drive({ engine: 'kernel', profile: 'perfect', ticks: HOUR_TICKS });
    expect(second.state).toEqual(first.state);
    expect(second.state.v).toBe(first.state.v);
    expect(second.state.gear).toBe(first.state.gear);
  });

  it('AC-P4 longitudinal state has v and gear, no damage, and REPLAY_SIM_HZ stays 10', () => {
    const run = drive({ engine: 'kernel', profile: 'perfect', ticks: HOUR_TICKS });
    expect(REPLAY_SIM_HZ).toBe(10);
    expect(typeof run.state.v).toBe('number');
    expect(typeof run.state.gear).toBe('number');
    expect(Object.hasOwn(run.state, 'damage')).toBe(false);
    expect(Object.hasOwn(run.state, 's')).toBe(false);
  });

  it('AC-P5 a higher brake lowers v versus coast in one stepAt30Hz', () => {
    const coast = stepAt30Hz(rolling);
    const braked = stepAt30Hz({ ...rolling, brake: 1 });
    expect(braked.v).toBeLessThan(coast.v);
  });

  it('AC-P6 offroad true ends slower than offroad false for the same gas-on state', () => {
    const gasOn = { ...rolling, v: 12, gas: 1, brake: 0, gear: 4 };
    const onRoad = stepAt30Hz(gasOn, undefined, 1, 0.25, false);
    const offRoad = stepAt30Hz(gasOn, undefined, 1, 0.25, true);
    expect(offRoad.v).toBeLessThan(onRoad.v);
  });

  it('AC-P7 gear on the returned state is the gear passed in', () => {
    const stepped = stepAt30Hz({ ...rolling, gear: 5 });
    expect(stepped.gear).toBe(5);
  });

  it('AC-P8 powerFactor 1.5 is not slower than powerFactor 1', () => {
    const gasOn = { ...rolling, v: 12, gas: 1, brake: 0, gear: 4 };
    const base = stepAt30Hz(gasOn, undefined, 1, 0.25, false);
    const boosted = stepAt30Hz(gasOn, undefined, 1.5, 0.25, false);
    expect(boosted.v).toBeGreaterThanOrEqual(base.v);
  });

  it('AC-P9 the first 50000 ticks of continueInpAt30Hz match one stepInpAt30Hz', () => {
    const direct = stepInpAt30Hz(null, inp, WINDOW);
    const continued = continueInpAt30Hz(stepInpAt30Hz(null, inp, 0), inp, 0, WINDOW);
    expect(continued.v).toBe(direct.v);
    expect(continued.gear).toBe(direct.gear);
  });

  it('AC-P10 continuing the rest matches one stepInpAt30Hz of 108000 on v', () => {
    const whole = stepInpAt30Hz(null, inp, HOUR_TICKS);
    const mid = continueInpAt30Hz(stepInpAt30Hz(null, inp, 0), inp, 0, WINDOW);
    const rest = continueInpAt30Hz(mid, inp, WINDOW, HOUR_TICKS);
    expect(rest.v).toBe(whole.v);
  });

  it('AC-P11 the split checkpoint matches gear at tick 108000', () => {
    const whole = stepInpAt30Hz(null, inp, HOUR_TICKS);
    const mid = continueInpAt30Hz(stepInpAt30Hz(null, inp, 0), inp, 0, WINDOW);
    const rest = continueInpAt30Hz(mid, inp, WINDOW, HOUR_TICKS);
    expect(rest.gear).toBe(whole.gear);
  });

  it('AC-P12 the checkpoint state still has no damage field', () => {
    const mid = continueInpAt30Hz(stepInpAt30Hz(null, inp, 0), inp, 0, WINDOW);
    const rest = continueInpAt30Hz(mid, inp, WINDOW, HOUR_TICKS);
    expect(typeof rest.v).toBe('number');
    expect(typeof rest.gear).toBe('number');
    expect(Object.hasOwn(rest, 'damage')).toBe(false);
    expect(Object.hasOwn(rest, 'fuel')).toBe(false);
  });
});
