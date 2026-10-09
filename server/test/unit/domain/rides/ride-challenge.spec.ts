import { parseChallenges } from '../../../../src/domain/rides/ride-challenge.js';

/* Historical dispatch prompts: a stored list is read back row by row. Rules v4 no longer issues or judges them. */
describe('ride-challenge', () => {
  it('a stored list keeps the four cab actions and drops anything else', () => {
    const c = { id: 'abc', action: 'cab' as const, issuedMs: 1000, deadlineMs: 21_000 };
    const lights = { id: 'l', action: 'headlights' as const, issuedMs: 1, deadlineMs: 2 };
    const wipers = { id: 'w', action: 'wipers' as const, issuedMs: 3, deadlineMs: 4 };
    const wash = { id: 'x', action: 'washer' as const, issuedMs: 5, deadlineMs: 6 };
    expect(parseChallenges([c, lights, wipers, wash, { id: 'x', action: 'horn', issuedMs: 1, deadlineMs: 2 }, 'junk', null, { id: 1, action: 'cab', issuedMs: 1, deadlineMs: 2 }])).toEqual([c, lights, wipers, wash]);
    expect(parseChallenges(null)).toEqual([]);
    expect(parseChallenges({})).toEqual([]);
  });
});
