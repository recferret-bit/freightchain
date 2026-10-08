import { allowClientProperties, isClientEvent } from '../../../../src/domain/analytics/client-events.js';

describe('the promo events of the browser plane', () => {
  it('are allowlisted, with only the properties named', () => {
    for (const name of ['promo_invite_viewed', 'promo_invite_submitted', 'promo_redeem_clicked']) expect(isClientEvent(name), name).toBe(true);
    expect(allowClientProperties('promo_invite_viewed', { code: 'WELCOME', extra: 1 })).toEqual({ code: 'WELCOME' });
    expect(allowClientProperties('promo_invite_submitted', { code: 'WELCOME', signed_in: false, from_link: true, nonce: 'x' })).toEqual({ code: 'WELCOME', signed_in: false, from_link: true });
    expect(allowClientProperties('promo_redeem_clicked', { surface: 'promo', prefilled: true, signature: 's' })).toEqual({ surface: 'promo', prefilled: true });
  });
  it('drop on a float or a long string, like every client event; the server events cannot be minted', () => {
    expect(allowClientProperties('promo_redeem_clicked', { surface: 'promo', prefilled: 1.5 })).toBeNull();
    expect(allowClientProperties('promo_invite_viewed', { code: 'x'.repeat(201) })).toBeNull();
    for (const name of ['promo_redeemed', 'cosmetic_equipped', 'promo_created', 'promo_disabled']) expect(isClientEvent(name), name).toBe(false);
  });
});
