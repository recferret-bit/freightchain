import { PromoCode } from '../../../src/domain/economy/promo-code.entity.js';
import type { PromoCodeProps } from '../../../src/domain/economy/promo.types.js';
import { BadRequestError } from '../../../src/domain/shared/errors.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const base = { code: 'early-bird', poolId: null, tier: '1h' as const, credits: 2, maxRedemptions: 100, perWallet: 1, expiresAt: null, note: 'launch' };
const restore = (over: Partial<PromoCodeProps> = {}) => PromoCode.restore({ ...base, code: 'EARLY-BIRD', redeemed: 0, disabledAt: null, createdAt: NOW, ...over });

describe('PromoCode – making codes', () => {
  it('normalizes what people type: case and spaces never matter', () => {
    expect(PromoCode.normalize(' early  Bird ')).toBe('EARLYBIRD');
    expect(PromoCode.isValidCode('early-bird')).toBe(true);
    expect(PromoCode.isValidCode('x')).toBe(false);
    expect(PromoCode.isValidCode('no way!')).toBe(false);
  });
  it('creates a stored upper-case code with nothing redeemed yet', () => {
    expect(PromoCode.create({ ...base, now: NOW }).snapshot()).toEqual({ ...base, code: 'EARLY-BIRD', redeemed: 0, disabledAt: null, createdAt: NOW });
  });
  it('refuses nonsense: a bad code, no tickets, no per-wallet use, a zero cap', () => {
    for (const bad of [{ code: 'a!' }, { credits: 0 }, { credits: 1.5 }, { perWallet: 0 }, { maxRedemptions: 0 }]) {
      expect(() => PromoCode.create({ ...base, ...bad, now: NOW }), JSON.stringify(bad)).toThrow(BadRequestError);
    }
    expect(PromoCode.create({ ...base, maxRedemptions: null, now: NOW }).snapshot().maxRedemptions).toBeNull(); // unlimited is fine
  });
  it('refuses a code that would be born expired (a time-zone slip in promo:create must fail loudly)', () => {
    expect(() => PromoCode.create({ ...base, expiresAt: NOW, now: NOW })).toThrow(/must be in the future/);
    expect(() => PromoCode.create({ ...base, expiresAt: new Date(NOW.getTime() - 1), now: NOW })).toThrow(BadRequestError);
    expect(PromoCode.create({ ...base, expiresAt: new Date(NOW.getTime() + 1), now: NOW }).snapshot().expiresAt).toEqual(new Date(NOW.getTime() + 1));
  });
});

describe('PromoCode – who may redeem', () => {
  it('a fresh code is redeemable', () => {
    expect(restore().whyNotRedeemable(NOW, 0)).toBeNull();
  });
  it('a disabled code is not', () => {
    expect(restore({ disabledAt: NOW }).whyNotRedeemable(NOW, 0)).toMatch(/no longer valid/);
  });
  it('an expired code is not – at the very instant it expires too', () => {
    expect(restore({ expiresAt: new Date(NOW.getTime() + 1) }).whyNotRedeemable(NOW, 0)).toBeNull();
    expect(restore({ expiresAt: NOW }).whyNotRedeemable(NOW, 0)).toMatch(/expired/);
  });
  it('a fully redeemed code is not; an unlimited one never is', () => {
    expect(restore({ redeemed: 100 }).whyNotRedeemable(NOW, 0)).toMatch(/fully redeemed/);
    expect(restore({ redeemed: 99 }).whyNotRedeemable(NOW, 0)).toBeNull();
    expect(restore({ maxRedemptions: null, redeemed: 1_000_000 }).whyNotRedeemable(NOW, 0)).toBeNull();
  });
  it('a wallet may use a code only perWallet times', () => {
    expect(restore({ perWallet: 2 }).whyNotRedeemable(NOW, 1)).toBeNull();
    expect(restore({ perWallet: 2 }).whyNotRedeemable(NOW, 2)).toMatch(/already redeemed/);
  });
  it('exposes what the redemption grants', () => {
    const p = restore({ poolId: 7, credits: 3 });
    expect([p.code, p.tier, p.poolId, p.credits, p.perWallet]).toEqual(['EARLY-BIRD', '1h', 7, 3, 1]);
  });
});
