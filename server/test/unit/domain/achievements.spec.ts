import { ACHIEVEMENTS, FAMILY_NAMES, TIER_NAMES, earnedIds, progressOf, type Facts } from '../../../src/domain/achievements/achievements.js';

const none: Facts = { started: 0, paidShifts: 0, totalMetres: 0, nightShifts: 0, cleanRuns: 0, siberiaShifts: 0, freeUnassisted: 0, completedFreeLevels: [] };
const families = [...new Set(ACHIEVEMENTS.map((a) => a.family))];

/* the ids production unlock rows already reference – FROZEN (docs/agents/achievements.md): a rename or a changed meaning of tier 1 breaks them */
const LEGACY = ['first-mile', 'shift-complete', 'night-owl', 'century', 'clean-run', 'cold-start', 'on-my-own', 'free-easy', 'free-crossroads', 'free-hard', 'top-20'];

describe('achievement tiers', () => {
  it('keeps every legacy id, as tier 1 of its family (free levels: tiers 1-3 of the licence)', () => {
    for (const id of LEGACY) expect(ACHIEVEMENTS.map((a) => a.id), id).toContain(id);
    expect(ACHIEVEMENTS.find((a) => a.id === 'free-crossroads')).toMatchObject({ family: 'licence', tier: 2 });
  });

  it('ids are unique; names fit the 32 bytes of an on-chain name', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(Buffer.byteLength(a.name), a.id).toBeLessThanOrEqual(32);
  });

  it('every mintable family is a ladder of 3-4 tiers 1..n, each harder than the one before', () => {
    for (const family of families.filter((f) => f !== 'podium')) {
      const tiers = ACHIEVEMENTS.filter((a) => a.family === family).sort((a, b) => a.tier - b.tier);
      expect(tiers.map((t) => t.tier), family).toEqual(tiers.map((_, i) => i + 1));
      expect(tiers.length, family).toBeGreaterThanOrEqual(3);
      expect(tiers.length, family).toBeLessThanOrEqual(TIER_NAMES.length);
      if (family !== 'licence') for (let i = 1; i < tiers.length; i++) expect(tiers[i]!.target, `${family} ${i + 1}`).toBeGreaterThan(tiers[i - 1]!.target); // the licence's tiers are different levels, each target 1
      expect(FAMILY_NAMES[family]).toBeTruthy();
    }
  });

  it('a tier is earned exactly at its target, one short is not', () => {
    for (const a of ACHIEVEMENTS.filter((x) => x.measure)) {
      const f: Facts = { ...none, started: 0 };
      const at = (value: number): Facts => ({
        ...f,
        started: a.family === 'road' ? value : 0, paidShifts: a.family === 'shift' ? value : 0, totalMetres: a.family === 'distance' ? value * 1000 : 0, nightShifts: a.family === 'night' ? value : 0,
        cleanRuns: a.family === 'clean' ? value : 0, siberiaShifts: a.family === 'siberia' ? value : 0, freeUnassisted: a.family === 'solo' ? value : 0,
        completedFreeLevels: a.family === 'licence' && value >= 1 ? [a.tier] : [],
      });
      expect(earnedIds(at(a.target)), `${a.id} at target`).toContain(a.id);
      expect(earnedIds(at(a.target - 1)), `${a.id} one short`).not.toContain(a.id);
    }
  });

  it('progress is clamped to the target and says when it is done', () => {
    const tier2 = ACHIEVEMENTS.find((a) => a.id === 'first-mile-2')!;
    expect(progressOf(tier2, { ...none, started: 4 })).toEqual({ value: 4, target: 10, done: false });
    expect(progressOf(tier2, { ...none, started: 400 })).toEqual({ value: 10, target: 10, done: true });
    expect(progressOf(ACHIEVEMENTS.find((a) => a.id === 'century-2')!, { ...none, totalMetres: 499_999 })).toMatchObject({ value: 499, done: false });
    expect(progressOf(ACHIEVEMENTS.find((a) => a.id === 'top-20')!, { ...none, started: 9 })).toEqual({ value: 0, target: 1, done: false });
  });
});
