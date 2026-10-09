import {
  CHALLENGE_KINDS, CHALLENGE_WINDOW_MS, challengeInterval, challengeKind, firstChallengeAt, nextChallengeAt, parseChallenges, pickChallenge, toChallengeDto,
} from '../../../../src/domain/rides/ride-challenge.js';

/* Dispatch prompts: what the server may ask for, when, and how a stored prompt is read back. */
describe('ride-challenge', () => {
  it('every kind is answered by a key AND a dash button, and names the key the driver reads', () => {
    expect(CHALLENGE_KINDS.map((k) => k.action)).toEqual(['headlights', 'wipers', 'cab', 'washer']);
    for (const k of CHALLENGE_KINDS) {
      expect(k.codes).toHaveLength(2);
      expect(k.codes[0]).toBe(`Key${k.key}`);
      expect(k.codes[1]).toMatch(/^btn:/);
      expect(k.label).toMatch(/^[A-Z ]+$/);
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

  it('the kind is picked by the draw across all four', () => {
    expect(pickChallenge(0).action).toBe('headlights');
    expect(pickChallenge(0.3).action).toBe('wipers');
    expect(pickChallenge(0.6).action).toBe('cab');
    expect(pickChallenge(0.99).action).toBe('washer');
    expect(pickChallenge(1).action).toBe('washer');
  });

  it('the wire view names the label, key and codes; a stored list is validated row by row', () => {
    const c = { id: 'abc', action: 'cab' as const, issuedMs: 1000, deadlineMs: 1000 + CHALLENGE_WINDOW_MS };
    expect(toChallengeDto(c)).toEqual({ id: 'abc', action: 'cab', label: 'SWITCH THE CAB LIGHT', key: 'C', codes: ['KeyC', 'btn:cab'], issuedMs: 1000, deadlineMs: 21_000 });
    expect(parseChallenges([c, { id: 'x', action: 'horn', issuedMs: 1, deadlineMs: 2 }, 'junk', null, { id: 1, action: 'cab', issuedMs: 1, deadlineMs: 2 }])).toEqual([c]);
    expect(parseChallenges(null)).toEqual([]);
    expect(parseChallenges({})).toEqual([]);
  });
});
