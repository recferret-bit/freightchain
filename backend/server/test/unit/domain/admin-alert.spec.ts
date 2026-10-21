import { alertForAudit } from '../../../src/domain/admin/admin-alert.js';
import type { AdminActionRecord } from '../../../src/domain/admin/admin.dto.js';

const at = new Date(Date.UTC(2036, 9, 8, 12));
const row = (over: Partial<AdminActionRecord>): AdminActionRecord => ({
  wallet: 'Abcd123456789wxyz', action: 'auth.signin', target: 't', detail: {}, requestId: 'r', at, ...over,
});

describe('alertForAudit', () => {
  it('queues a sign-in and a money setting, and skips an ordinary read', () => {
    const signIn = alertForAudit(row({}), '1');
    expect(signIn).toMatchObject({ id: '1', kind: 'auth.signin', money: false, status: 'pending', text: expect.stringContaining('Abcd…wxyz') });
    expect(signIn?.text.includes('123456789')).toBe(false);
    const money = alertForAudit(row({ action: 'setting.update', target: 'referral_ride_cap_lamports' }), '2');
    expect(money?.money).toBe(true);
    expect(money?.text.startsWith('MONEY ')).toBe(true);
    expect(alertForAudit(row({ action: 'read.player' }), '3')).toBeNull();
    expect(alertForAudit(row({ action: 'cli.pool:payout', wallet: 'cli:ada' }), '4')?.money).toBe(true);
    expect(alertForAudit(row({ action: 'promo.create', detail: { effect: { kind: 'tickets' } } }), '5')?.money).toBe(true);
  });
});
