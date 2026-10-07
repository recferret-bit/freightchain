import { ACHIEVEMENTS, earnedIds, type Facts } from '../src/achievements/achievements.js';

const none: Facts = { started: 0, completed: 0, totalMetres: 0, completedAtNight: false, cleanRun: false, completedSiberia: false };
const earn = (f: Partial<Facts>) => earnedIds({ ...none, ...f });

describe('achievement rules', () => {
  it('nothing earned before riding', () => expect(earn({})).toEqual([]));
  it('first mile = a started ride; shift complete needs a completed one', () => {
    expect(earn({ started: 1 })).toEqual(['first-mile']);
    expect(earn({ started: 1, completed: 1 })).toEqual(['first-mile', 'shift-complete']);
  });
  it('night owl / clean run / cold start need a COMPLETED ride flag', () => {
    expect(earn({ completedAtNight: true })).toEqual(['night-owl']);
    expect(earn({ cleanRun: true })).toEqual(['clean-run']);
    expect(earn({ completedSiberia: true })).toEqual(['cold-start']);
  });
  it('century at exactly 100 km, not 99.9', () => { expect(earn({ totalMetres: 99_999 })).toEqual([]); expect(earn({ totalMetres: 100_000 })).toEqual(['century']); });
  it('top 20 is awarded at round close, never by a rule', () => {
    expect(ACHIEVEMENTS.find(a => a.id === 'top-20')?.rule).toBeNull();
    expect(earn({ started: 9, completed: 9, totalMetres: 1e9, completedAtNight: true, cleanRun: true, completedSiberia: true })).not.toContain('top-20');
  });
  it('ids are unique', () => expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length));
});
