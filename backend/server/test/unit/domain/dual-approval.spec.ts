import { needsDualApproval } from '../../../src/domain/admin/dual-approval.js';

describe('needsDualApproval', () => {
  it('holds money changes and not an ordinary setting', () => {
    expect(needsDualApproval('POST', '/api/admin/rides/r/verdict', {})).toBe(true);
    expect(needsDualApproval('POST', '/api/admin/settings', { key: 'referral_ride_cap_lamports' })).toBe(true);
    expect(needsDualApproval('POST', '/api/admin/settings', { key: 'free_on_signup' })).toBe(false);
    expect(needsDualApproval('POST', '/api/admin/promos', { promo: { effect: { kind: 'tickets' } } })).toBe(true);
    expect(needsDualApproval('GET', '/api/admin/settings', {})).toBe(false);
  });
});
