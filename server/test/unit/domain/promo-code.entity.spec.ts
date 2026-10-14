import { PromoCode } from '../../../src/domain/economy/promo-code.entity.js';
import type { PromoCodeProps } from '../../../src/domain/economy/promo.types.js';
import { BadRequestError, ConflictError } from '../../../src/domain/shared/errors.js';
import { promoInput, ticketEffect } from '../../support/promos.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const HOUR = 3_600_000;
const base = promoInput({ code: 'early-bird', maxRedemptions: 100, note: 'launch' });
const restore = (over: Partial<PromoCodeProps> = {}) => PromoCode.restore({
  code: 'EARLY-BIRD', effect: ticketEffect(), description: null, maxRedemptions: 100, perWallet: 1, startsAt: NOW, expiresAt: null, note: 'launch', redeemed: 0, disabledAt: null, createdAt: NOW, ...over,
});

describe('PromoCode – making codes', () => {
  it('normalizes what people type: case and spaces never matter', () => {
    expect(PromoCode.normalize(' early  Bird ')).toBe('EARLYBIRD');
    expect(PromoCode.isValidCode('early-bird')).toBe(true);
    expect(PromoCode.isValidCode('x')).toBe(false);
    expect(PromoCode.isValidCode('no way!')).toBe(false);
  });
  it('creates a stored upper-case code with nothing redeemed yet, starting now unless told otherwise', () => {
    expect(PromoCode.create({ ...base, now: NOW }).snapshot()).toEqual({ ...base, code: 'EARLY-BIRD', startsAt: NOW, redeemed: 0, disabledAt: null, createdAt: NOW });
    const later = new Date(NOW.getTime() + HOUR);
    expect(PromoCode.create({ ...base, startsAt: later, now: NOW }).snapshot().startsAt).toEqual(later);
  });
  it('trims the description and the note; blank ones are none; both are length-bounded', () => {
    const s = PromoCode.create({ ...base, description: '  Welcome!  ', note: '   ', now: NOW }).snapshot();
    expect([s.description, s.note]).toEqual(['Welcome!', null]);
    expect(() => PromoCode.create({ ...base, description: 'x'.repeat(201), now: NOW })).toThrow(BadRequestError);
    expect(() => PromoCode.create({ ...base, note: 'x'.repeat(501), now: NOW })).toThrow(BadRequestError);
  });
  it('refuses nonsense: a bad code, no per-wallet use, a zero cap', () => {
    for (const bad of [{ code: 'a!' }, { perWallet: 0 }, { maxRedemptions: 0 }]) {
      expect(() => PromoCode.create({ ...base, ...bad, now: NOW }), JSON.stringify(bad)).toThrow(BadRequestError);
    }
    expect(PromoCode.create({ ...base, maxRedemptions: null, now: NOW }).snapshot().maxRedemptions).toBeNull(); // unlimited is fine
  });
  it('refuses a code that would be born expired (a time-zone slip must fail loudly) or end before it starts', () => {
    expect(() => PromoCode.create({ ...base, expiresAt: NOW, now: NOW })).toThrow(/must be in the future/);
    expect(() => PromoCode.create({ ...base, expiresAt: new Date(NOW.getTime() - 1), now: NOW })).toThrow(BadRequestError);
    expect(PromoCode.create({ ...base, expiresAt: new Date(NOW.getTime() + 1), now: NOW }).snapshot().expiresAt).toEqual(new Date(NOW.getTime() + 1));
    const start = new Date(NOW.getTime() + 2 * HOUR);
    expect(() => PromoCode.create({ ...base, startsAt: start, expiresAt: new Date(NOW.getTime() + HOUR), now: NOW })).toThrow(/end after it starts/);
    expect(() => PromoCode.create({ ...base, startsAt: start, expiresAt: start, now: NOW })).toThrow(/end after it starts/);
  });
});

describe('PromoCode – the effect', () => {
  const make = (effect: unknown) => () => PromoCode.create({ ...base, effect: effect as never, now: NOW });
  it('tickets: a paid tier, at least one ticket, a whole non-negative pool id (or none)', () => {
    expect(make(ticketEffect({ poolId: 7, credits: 3 }))().effect).toEqual({ kind: 'tickets', tier: '1h', poolId: 7, credits: 3 });
    for (const bad of [{ credits: 0 }, { credits: 1.5 }, { tier: 'free' }, { poolId: -1 }, { poolId: 1.5 }]) expect(make(ticketEffect(bad as never)), JSON.stringify(bad)).toThrow(BadRequestError);
  });
  it('free rides: 1 to 20 whole rides', () => {
    expect(make({ kind: 'free_rides', count: 3 })().effect).toEqual({ kind: 'free_rides', count: 3 });
    for (const count of [0, 21, 1.5, -1]) expect(make({ kind: 'free_rides', count }), String(count)).toThrow(/free rides: 1–20/);
  });
  it('a cosmetic is not created any more – cab visuals are minted by burning HONK', () => {
    for (const effect of [
      { kind: 'cosmetic', slot: 'wheel', item: 'gold' },
      { kind: 'cosmetic', slot: 'wheel', item: 'classic' },
      { kind: 'cosmetic', slot: 'seat', item: 'x' },
    ]) expect(make(effect)).toThrow(ConflictError);
    try { make({ kind: 'cosmetic', slot: 'wheel', item: 'gold' })(); } catch (error) { expect(error).toMatchObject({ errorCode: 'visuals_are_honk' }); }
  });
  it('a stored cosmetic row still has a shape: assertEffect knows the catalog', () => {
    expect(() => PromoCode.assertEffect({ kind: 'cosmetic', slot: 'wheel', item: 'gold' })).not.toThrow();
    expect(() => PromoCode.assertEffect({ kind: 'cosmetic', slot: 'wheel', item: 'classic' })).toThrow(/not an unlockable wheel/);
    expect(() => PromoCode.assertEffect({ kind: 'cosmetic', slot: 'wheel', item: 'racing' })).toThrow(/not an unlockable wheel/);
    expect(() => PromoCode.assertEffect({ kind: 'cosmetic', slot: 'seat', item: 'x' } as never)).toThrow(/cosmetic slot/);
  });
  it('an unknown kind is refused', () => {
    expect(make({ kind: 'cash', usd: 5 })).toThrow(/unknown promo effect/);
  });
});

describe('PromoCode – where it stands and who may redeem', () => {
  it('a fresh code is active and redeemable', () => {
    expect(restore().stateAt(NOW)).toBe('active');
    expect(restore().whyNotRedeemable(NOW, 0)).toBeNull();
  });
  it('a disabled code is not – and disabled wins over every other state', () => {
    expect(restore({ disabledAt: NOW }).whyNotRedeemable(NOW, 0)).toMatch(/no longer valid/);
    expect(restore({ disabledAt: NOW, redeemed: 100, expiresAt: NOW }).stateAt(NOW)).toBe('disabled');
  });
  it('a code that has not started is scheduled – active from the very instant it starts', () => {
    const start = new Date(NOW.getTime() + HOUR);
    expect(restore({ startsAt: start }).stateAt(NOW)).toBe('scheduled');
    expect(restore({ startsAt: start }).whyNotRedeemable(NOW, 0)).toMatch(/not active yet/);
    expect(restore({ startsAt: start }).whyNotRedeemable(start, 0)).toBeNull();
  });
  it('an expired code is not – at the very instant it expires too', () => {
    expect(restore({ expiresAt: new Date(NOW.getTime() + 1) }).whyNotRedeemable(NOW, 0)).toBeNull();
    expect(restore({ expiresAt: NOW }).whyNotRedeemable(NOW, 0)).toMatch(/expired/);
    expect(restore({ expiresAt: NOW }).stateAt(NOW)).toBe('ended');
  });
  it('a fully redeemed code is exhausted; an unlimited one never is', () => {
    expect(restore({ redeemed: 100 }).whyNotRedeemable(NOW, 0)).toMatch(/fully redeemed/);
    expect(restore({ redeemed: 100 }).stateAt(NOW)).toBe('exhausted');
    expect(restore({ redeemed: 99 }).whyNotRedeemable(NOW, 0)).toBeNull();
    expect(restore({ maxRedemptions: null, redeemed: 1_000_000 }).whyNotRedeemable(NOW, 0)).toBeNull();
  });
  it('a wallet may use a code only perWallet times', () => {
    expect(restore({ perWallet: 2 }).whyNotRedeemable(NOW, 1)).toBeNull();
    expect(restore({ perWallet: 2 }).whyNotRedeemable(NOW, 2)).toMatch(/already redeemed/);
  });
  it('exposes what the redemption grants, and a snapshot is a copy', () => {
    const p = restore({ effect: ticketEffect({ poolId: 7, credits: 3 }), description: 'hi' });
    expect([p.code, p.effect, p.description, p.perWallet]).toEqual(['EARLY-BIRD', { kind: 'tickets', tier: '1h', poolId: 7, credits: 3 }, 'hi', 1]);
    const snap = p.snapshot();
    (snap.effect as { credits: number }).credits = 99;
    expect(p.effect).toMatchObject({ credits: 3 });
  });
});
