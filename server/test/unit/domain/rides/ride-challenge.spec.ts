import {
  CHALLENGE_KINDS, CHALLENGE_WINDOW_MS, challengeInterval, challengeKind, firstChallengeAt, nextChallengeAt, parseChallenges, pickChallenge, toChallengeDto,
  type ChallengeKind,
} from '../../../../src/domain/rides/ride-challenge.js';

const SAMPLE: ChallengeKind = { action: 'test', label: 'DO THE TEST', key: 'T', codes: ['KeyT', 'btn:test'] };

/* Ride-challenge channel: the kinds table is empty today (nothing is issued). The interval / pick / DTO machinery stays for when a row is added. */
describe('ride-challenge', () => {
  it('the shipped kinds table is empty – the channel issues nothing until a row is added', () => {
    expect(CHALLENGE_KINDS).toEqual([]);
    expect(pickChallenge(0)).toBeNull();
    expect(pickChallenge(1)).toBeNull();
    expect(challengeKind('headlights')).toBeUndefined();
    expect(toChallengeDto({ id: 'abc', action: 'headlights', issuedMs: 1000, deadlineMs: 21_000 })).toBeNull();
  });

  it('the interval is the configured one, but a short shift gets at most 4 prompts; 0 switches prompts off', () => {
    expect(challengeInterval(240, 1800)).toBe(240);
    expect(challengeInterval(240, 60)).toBe(15);
    expect(challengeInterval(0, 1800)).toBe(0);
    expect(challengeInterval(-5, 1800)).toBe(0);
  });

  it('the first prompt is due 0.5–1 intervals in, the next 0.6–1.4 after the last – the draw is clamped to 0..1', () => {
    expect(firstChallengeAt(100, 0)).toBe(50);
    expect(firstChallengeAt(100, 1)).toBe(100);
    expect(firstChallengeAt(100, 7)).toBe(100);
    expect(nextChallengeAt(300, 100, 0)).toBe(360);
    expect(nextChallengeAt(300, 100, 1)).toBe(440);
    expect(nextChallengeAt(300, 100, Number.NaN)).toBe(360);
  });

  it('when kinds are supplied, pickChallenge draws across that table and toChallengeDto names label / key / codes', () => {
    const kinds = [SAMPLE, { action: 'other', label: 'OTHER', key: 'O', codes: ['KeyO'] }];
    expect(pickChallenge(0, kinds)?.action).toBe('test');
    expect(pickChallenge(0.99, kinds)?.action).toBe('other');
    expect(pickChallenge(1, kinds)?.action).toBe('other');
    const c = { id: 'abc', action: 'test', issuedMs: 1000, deadlineMs: 1000 + CHALLENGE_WINDOW_MS };
    expect(toChallengeDto(c, kinds)).toEqual({ id: 'abc', action: 'test', label: 'DO THE TEST', key: 'T', codes: ['KeyT', 'btn:test'], issuedMs: 1000, deadlineMs: 21_000 });
  });

  it('parseChallenges drops unknown actions (retired kinds, junk) and keeps a row whose action is in the table', () => {
    const c = { id: 'abc', action: 'test', issuedMs: 1000, deadlineMs: 1000 + CHALLENGE_WINDOW_MS };
    expect(parseChallenges([c, { id: 'x', action: 'horn', issuedMs: 1, deadlineMs: 2 }, 'junk', null], [SAMPLE])).toEqual([c]);
    expect(parseChallenges([c])).toEqual([]); // shipped table is empty
    expect(parseChallenges(null)).toEqual([]);
    expect(parseChallenges({})).toEqual([]);
  });
});
