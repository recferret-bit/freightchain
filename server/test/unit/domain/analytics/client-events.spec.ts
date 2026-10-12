import { CLIENT_EVENTS, allowClientProperties, isClientEvent } from '../../../../src/domain/analytics/client-events.js';

describe('the promo events of the browser plane', () => {
  it('are allowlisted, with only the properties named', () => {
    for (const name of ['promo_invite_viewed', 'promo_invite_submitted', 'promo_redeem_clicked', 'garage_part_clicked']) expect(isClientEvent(name), name).toBe(true);
    expect(allowClientProperties('promo_invite_viewed', { code: 'WELCOME', extra: 1 })).toEqual({ code: 'WELCOME' });
    expect(allowClientProperties('promo_invite_submitted', { code: 'WELCOME', signed_in: false, from_link: true, nonce: 'x' })).toEqual({ code: 'WELCOME', signed_in: false, from_link: true });
    expect(allowClientProperties('promo_redeem_clicked', { surface: 'promo', prefilled: true, signature: 's' })).toEqual({ surface: 'promo', prefilled: true });
    expect(allowClientProperties('garage_part_clicked', { slot: 'dice', item: 'pink', owned: false, code: 'X' })).toEqual({ slot: 'dice', item: 'pink', owned: false });
  });
  it('drop on a float or a long string, like every client event; the server events cannot be minted', () => {
    expect(allowClientProperties('promo_redeem_clicked', { surface: 'promo', prefilled: 1.5 })).toBeNull();
    expect(allowClientProperties('promo_invite_viewed', { code: 'x'.repeat(201) })).toBeNull();
    for (const name of ['promo_redeemed', 'cosmetic_equipped', 'garage_saved', 'promo_created', 'promo_disabled']) expect(isClientEvent(name), name).toBe(false);
  });
  it('keeps one web vital and drops a float value', () => {
    expect(CLIENT_EVENTS).toHaveLength(42);
    expect(allowClientProperties('chain_card_flipped', { card: 'proof', wallet: 'x' })).toEqual({ card: 'proof' });
    expect(allowClientProperties('faq_item_opened', { item: 'wallet', via: 'hover', wallet: 'x' })).toEqual({ item: 'wallet', via: 'hover' });
    expect(allowClientProperties('agreement_toggled', { kind: 'age18', on: true, wallet: 'x' })).toEqual({ kind: 'age18', on: true });
    expect(isClientEvent('web_vital')).toBe(true);
    expect(isClientEvent('whitepaper_viewed')).toBe(true);
    expect(isClientEvent('tier_selected')).toBe(false);
    expect(allowClientProperties('whitepaper_viewed', { surface: 'whitepaper', chapter: 'onchain' })).toEqual({ surface: 'whitepaper' });
    expect(allowClientProperties('web_vital', { surface: 'whitepaper', metric: 'LCP', value: 1234, rating: 'good', navigation: 'navigate', extra: true })).toEqual({
      surface: 'whitepaper', metric: 'LCP', value: 1234, rating: 'good', navigation: 'navigate',
    });
    expect(allowClientProperties('web_vital', { surface: 'landing', metric: 'CLS', value: 0, rating: 'good' })).toEqual({ surface: 'landing', metric: 'CLS', value: 0, rating: 'good' });
    expect(allowClientProperties('web_vital', { surface: 'lobby', metric: 'CLS', value: 0.12, rating: 'needs-improvement' })).toBeNull();
  });
});
