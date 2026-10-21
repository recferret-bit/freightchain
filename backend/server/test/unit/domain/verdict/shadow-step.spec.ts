import { readFileSync } from 'node:fs';
import { REPLAY_SIM_HZ, SHADOW_STEP_DT, stepAt30Hz } from '../../../../src/domain/shared/index.js';
import { RULES_VERSION } from '../../../../src/domain/verdict/verdict-rules.js';

describe('shadow 1/30 step', () => {
  it('repeats on the same input and is not the live 10 Hz replay', () => {
    expect(REPLAY_SIM_HZ).toBe(10);
    expect(SHADOW_STEP_DT).toBeCloseTo(1 / 30);
    expect(RULES_VERSION).toBe(7);
    const state = { v: 4, gear: 3, clutch: 0, gas: 0.6, brake: 0, rpm: 1800, engineOn: true, park: false, rev: false };
    const once = stepAt30Hz(state);
    const twice = stepAt30Hz(state);
    expect(twice).toEqual(once);
    expect(state.v).toBe(4);
    const replay = readFileSync(new URL('../../../../src/domain/verdict/replay-engine.ts', import.meta.url), 'utf8');
    expect(replay).not.toContain('stepAt30Hz');
  });
});
