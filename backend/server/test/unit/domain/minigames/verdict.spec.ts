import { minigameVerdictDelta } from '../../../../src/domain/minigames/verdict.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideVerdict } from '../../../../src/domain/verdict/ride-verdict.entity.js';
import { RULES_VERSION } from '../../../../src/domain/verdict/verdict-rules.js';

const now = new Date(Date.UTC(2036, 0, 1));

describe('minigame verdict delta', () => {
  const ride = Ride.createPaidOrder({ id: 'r', wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, priceUsd: 1, lamports: 1, solUsd: 1, now, quoteTtlMs: 60_000 });
  ride.markPaid(1, now);
  ride.start(now);

  it('adds nothing unless the mode is enforce, and a flag never rejects the ride', () => {
    expect(RULES_VERSION).toBe(7);
    expect(minigameVerdictDelta({ mode: 'off', events: [{ id: 'e', clientSafe: false }] })).toEqual([]);
    expect(minigameVerdictDelta({ mode: 'shadow', events: [{ id: 'e', clientSafe: false }] })).toEqual([]);
    const plain = RideVerdict.judge(ride, [], now);
    const shadow = RideVerdict.judge(ride, [], now, [], { mode: 'shadow', events: [{ id: 'e', clientSafe: false }] });
    expect(shadow.reasons).toEqual(plain.reasons);
    expect(shadow.status).toBe(plain.status);
    const flagged = RideVerdict.judge(ride, [], now, [], { mode: 'enforce', events: [{ id: 'e1', clientSafe: false }, { id: 'e2', clientSafe: null }, { id: 'e3', clientSafe: true }] });
    const added = flagged.reasons.filter((r) => r.code === 'mg-unsafe-open');
    expect(added).toEqual([{ code: 'mg-unsafe-open', detail: 'minigame e1 was opened while the client reported an unsafe stop', severity: 'flag' }]);
    expect(flagged.reasons.some((r) => r.severity === 'reject' && !plain.reasons.some((p) => p.code === r.code))).toBe(false);
    expect(RideVerdict.judge(ride, [], now).snapshot().rulesVersion).toBe(7);
  });
});
