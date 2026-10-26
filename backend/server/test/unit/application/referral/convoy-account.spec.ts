import { rewardDto, inviteDto } from '../../../../src/application/referral/convoy-account.js';

describe('Convoy account projection', () => {
  it('keeps actual paid units separate from quoted base and exposes capped, held and historical states', () => {
    const row = { id: 'm1', kind: 'm1' as const, wallet: 'host', referrer: 'host', referee: 'friend', amount: 100, unit: 'ten4' as const, at: new Date(0), dayKey: 'day', weekKey: 'week' };
    expect(rewardDto({ ...row, chainState: 'paid', paidUnits: 12500000n, chainSignature: 'sig' })).toMatchObject({ state: 'paid', amount: 100, paidUnits: '12500000', signature: 'sig', releaseAt: null });
    expect(rewardDto({ ...row, chainState: 'capped', capReason: 'monthly_cap' })).toMatchObject({ state: 'capped', reason: 'monthly_cap' });
    expect(rewardDto({ ...row, chainState: 'held' }).releaseAt).toBe('1970-01-03T00:00:00.000Z');
    expect(rewardDto(row).state).toBe('legacy');
  });
  it('shows capped activation without suggesting that the invite failed', () => {
    const row = { referee: 'friend', referrer: 'host', status: 'active' as const, boundAt: new Date(0), expiresAt: new Date(10), activatedAt: new Date(1), qualifyExpiresAt: new Date(100), m1At: null, m2At: null };
    expect(inviteDto(row, [], false, false)).toMatchObject({ status: 'active', weeks: 0, promo: 'cap_reached', tasksComplete: false });
  });
});
