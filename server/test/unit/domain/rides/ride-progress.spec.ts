import { progressMilestones, progressRatio } from '../../../../src/domain/rides/ride-progress.js';

describe('progressMilestones', () => {
  it('emits a band only the first time the ratio crosses it, and never 100', () => {
    expect(progressMilestones(0, 0.24)).toEqual([]);
    expect(progressMilestones(0.24, 0.25)).toEqual([25]);
    expect(progressMilestones(0.25, 0.49)).toEqual([]);
    expect(progressMilestones(0.2, 0.8)).toEqual([25, 50, 75]);
    expect(progressMilestones(0.8, 1)).toEqual([]);
    expect(progressMilestones(0, 1)).toEqual([25, 50, 75]);
  });

  it('the ratio is the slower of time and distance', () => {
    expect(progressRatio(10, 10, 0, 140)).toBe(0);
    expect(progressRatio(3, 10, 40, 140)).toBeCloseTo(40 / 140);
    expect(progressRatio(1, 0, 1, 1)).toBe(0);
  });
});
