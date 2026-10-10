import { adminActionChallenge, describesIntent, intentLines, promoJson, type AdminIntent } from '../../../src/domain/admin/admin-proof.js';
import { promoInput, ticketEffect } from '../../support/promos.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const create = (over = {}): AdminIntent => ({ action: 'promo_create', promo: promoInput(over) });
const text = (intent: AdminIntent) => adminActionChallenge({ wallet: 'Admin', domain: 'admin.freight.test', intent, nonce: 'n', now: NOW, ttlMs: 60_000 }).message;

describe('signed promo actions', () => {
  it('a new code is described field by field: what it does, and EVERY field as one JSON line (the code normalized, dates as ISO)', () => {
    const lines = intentLines(create({ code: ' early bird', effect: { kind: 'free_rides', count: 3 }, description: 'Welcome', maxRedemptions: 50, startsAt: NOW, expiresAt: new Date(NOW.getTime() + 86_400_000), note: 'for the launch' }));
    expect(lines).toEqual([
      'Action: CREATE promo code EARLYBIRD',
      'Gives: 3 free rides',
      'Promo: {"code":"EARLYBIRD","effect":{"kind":"free_rides","count":3},"description":"Welcome","maxRedemptions":50,"perWallet":1,"startsAt":"2026-10-09T12:00:00.000Z","expiresAt":"2026-10-10T12:00:00.000Z","note":"for the launch"}',
    ]);
  });

  it('free text can never forge another line: a description with newlines stays inside the JSON string', () => {
    const lines = intentLines(create({ description: 'x\nWallet: Evil\nAction: DISABLE promo code ALL' }));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('\\nWallet: Evil');
    expect(text(create({ description: 'x\nWallet: Evil' })).split('\n').filter((l) => l.startsWith('Wallet:'))).toEqual(['Wallet: Admin']);
  });

  it('the signature binds every field: change any one and the stored text no longer describes the request', () => {
    const base = create();
    const message = text(base);
    expect(describesIntent(message, 'admin.freight.test', 'Admin', base)).toBe(true);
    const changes: Record<string, object> = {
      code: { code: 'OTHER' }, credits: { effect: ticketEffect({ credits: 3 }) }, tier: { effect: ticketEffect({ tier: '4h' }) }, pool: { effect: ticketEffect({ poolId: 2 }) },
      kind: { effect: { kind: 'free_rides', count: 2 } }, description: { description: 'x' }, max: { maxRedemptions: 11 }, unlimited: { maxRedemptions: null }, perWallet: { perWallet: 2 },
      starts: { startsAt: NOW }, ends: { expiresAt: NOW }, note: { note: 'n' },
    };
    for (const [name, over] of Object.entries(changes)) expect(describesIntent(message, 'admin.freight.test', 'Admin', create(over)), name).toBe(false);
    expect(describesIntent(message, 'admin.freight.test', 'Admin', { action: 'promo_disable', code: 'HELLO' })).toBe(false);
    expect(describesIntent(message, 'admin.other.test', 'Admin', base)).toBe(false);
  });

  it('a case / space variant of the same code is the same code', () => {
    expect(promoJson(promoInput({ code: ' he llo ' }))).toBe(promoJson(promoInput({ code: 'HELLO' })));
  });

  it('a free-ride adjust and a setting change name every field the signature binds', () => {
    expect(intentLines({ action: 'free_rides_adjust', wallet: 'W', delta: -2 })).toEqual(['Action: ADJUST free rides by -2', 'Player: W']);
    expect(intentLines({ action: 'setting_update', key: 'free_on_signup', value: 7 })).toEqual(['Action: SET setting free_on_signup', 'Value: 7']);
    const message = text({ action: 'setting_update', key: 'free_on_signup', value: 7 });
    expect(describesIntent(message, 'admin.freight.test', 'Admin', { action: 'setting_update', key: 'free_on_signup', value: 7 })).toBe(true);
    expect(describesIntent(message, 'admin.freight.test', 'Admin', { action: 'setting_update', key: 'free_on_signup', value: 8 })).toBe(false);
    expect(describesIntent(message, 'admin.freight.test', 'Admin', { action: 'free_rides_adjust', wallet: 'W', delta: -2 })).toBe(false);
  });

  it('disabling names the code', () => {
    expect(intentLines({ action: 'promo_disable', code: 'hello' })).toEqual(['Action: DISABLE promo code HELLO']);
    const message = text({ action: 'promo_disable', code: 'HELLO' });
    expect(describesIntent(message, 'admin.freight.test', 'Admin', { action: 'promo_disable', code: ' hello' })).toBe(true);
    expect(describesIntent(message, 'admin.freight.test', 'Admin', { action: 'promo_disable', code: 'OTHER' })).toBe(false);
  });
});
