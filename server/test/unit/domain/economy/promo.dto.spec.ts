import { PromoCode } from '../../../../src/domain/economy/promo-code.entity.js';
import { describeEffect, toPromoDto } from '../../../../src/domain/economy/promo.dto.js';
import { aPromo, ticketEffect } from '../../../support/promos.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');

describe('describeEffect – the one line a code is known by', () => {
  it('tickets', () => {
    expect(describeEffect(ticketEffect({ credits: 1 }))).toBe('1 × 1h ride ticket');
    expect(describeEffect(ticketEffect({ credits: 3, tier: '8h' }))).toBe('3 × 8h ride tickets');
    expect(describeEffect(ticketEffect({ credits: 2, poolId: 7 }))).toBe('2 × 1h ride tickets (pool #7)');
  });
  it('free rides', () => {
    expect(describeEffect({ kind: 'ride', tier: '8h' })).toBe('one free 8h ride (not for sale)');
    expect(describeEffect({ kind: 'free_rides', count: 1 })).toBe('1 free ride');
    expect(describeEffect({ kind: 'free_rides', count: 3 })).toBe('3 free rides');
  });
  it('cosmetics – the slot reads as words', () => {
    expect(describeEffect({ kind: 'cosmetic', slot: 'truck_color', item: 'blue' })).toBe('truck color: blue');
    expect(describeEffect({ kind: 'cosmetic', slot: 'gearbox', item: 'chrome' })).toBe('gearbox: chrome');
  });
});

describe('toPromoDto', () => {
  it('flattens a code into epoch ms with its label and state', () => {
    const promo = aPromo(NOW, { description: 'Hi', note: 'private', expiresAt: new Date(NOW.getTime() + 1000) });
    expect(toPromoDto(promo, NOW)).toEqual({
      code: 'HELLO', effect: ticketEffect(), label: '2 × 1h ride tickets', description: 'Hi', state: 'active', maxRedemptions: 10, redeemed: 0, perWallet: 1,
      startsAt: NOW.getTime(), expiresAt: NOW.getTime() + 1000, disabledAt: null, note: 'private', createdAt: NOW.getTime(),
    });
    expect(toPromoDto(promo, new Date(NOW.getTime() + 1000)).state).toBe('ended');
  });
  it('reads a disabled code as such', () => {
    const p = PromoCode.restore({ ...aPromo(NOW).snapshot(), disabledAt: NOW });
    expect(toPromoDto(p, NOW)).toMatchObject({ state: 'disabled', disabledAt: NOW.getTime() });
  });
});
