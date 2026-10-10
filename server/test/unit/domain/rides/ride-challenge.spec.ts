import {
  CHALLENGE_KINDS, CHALLENGE_WINDOW_MS, challengeInterval, challengeKind, firstChallengeAt, nextChallengeAt, parseChallenges, pickChallenge, toChallengeDto,
} from '../../../../src/domain/rides/ride-challenge.js';

/* Ride challenges: the kinds table, when one is due, and how a stored prompt is read back. A new kind is a row in CHALLENGE_KINDS. */
describe('ride-challenge', () => {
  it('the shipped kinds are the four cab actions; each names a label, a key and at least one answering code', () => {
    expect(CHALLENGE_KINDS.map((k) => k.action)).toEqual(['headlights', 'wipers', 'cab', 'washer']);
    expect(CHALLENGE_KINDS.length).toBeGreaterThan(0);
    for (const k of CHALLENGE_KINDS) {
      expect(k.codes.length).toBeGreaterThanOrEqual(1);
      expect(k.label).toMatch(/^[A-Z ]+$/);
      expect(k.key).toBeTruthy();
    }
    expect(challengeKind('wipers').codes).toEqual(['KeyR', 'btn:wiper']);
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

  it('the kind is picked by the draw across CHALLENGE_KINDS', () => {
    const n = CHALLENGE_KINDS.length;
    expect(pickChallenge(0).action).toBe(CHALLENGE_KINDS[0].action);
    expect(pickChallenge(0.99).action).toBe(CHALLENGE_KINDS[n - 1].action);
    expect(pickChallenge(1).action).toBe(CHALLENGE_KINDS[n - 1].action);
  });

  it('the wire view names the label, key and codes; a stored list is validated row by row', () => {
    const c = { id: 'abc', action: 'cab' as const, issuedMs: 1000, deadlineMs: 1000 + CHALLENGE_WINDOW_MS };
    expect(toChallengeDto(c)).toEqual({ id: 'abc', action: 'cab', label: 'SWITCH THE CAB LIGHT', key: 'C', codes: ['KeyC', 'btn:cab'], issuedMs: 1000, deadlineMs: 21_000 });
    expect(parseChallenges([c, { id: 'x', action: 'horn', issuedMs: 1, deadlineMs: 2 }, 'junk', null, { id: 1, action: 'cab', issuedMs: 1, deadlineMs: 2 }])).toEqual([c]);
    expect(parseChallenges(null)).toEqual([]);
    expect(parseChallenges({})).toEqual([]);
  });
});
