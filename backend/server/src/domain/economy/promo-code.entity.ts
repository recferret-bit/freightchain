import { PRESEASON_PROMO_CODE } from '../settings/preseason-event.js';
import { BadRequestError, ConflictError } from '../shared/errors.js';
import { isPaidTierId } from '../rides/ride-tier.js';
import { COSMETIC_SLOTS, isCosmeticSlot, isUnlockableCosmetic } from './cosmetics.js';
import type { PromoCodeProps, PromoEffect, PromoState } from './promo.types.js';

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
export const CONVOY_PROMO_CODE = 'SYSTEM-CONVOY-1H';
export const MAX_FREE_RIDES_PER_CODE = 20;
export const MAX_DESCRIPTION = 200;
export const MAX_NOTE = 500;

/** A promo code (docs/spec/promocodes.md): one effect, redeemable a limited number of times overall and per wallet, between `startsAt` and `expiresAt`, until it is disabled.
 *  That a pinned `poolId` really is a pool of `tier` is checked by the use case that creates the code (it needs the pool). A code is immutable once created apart from being disabled
 *  – so the redemption log always reads against the effect that was actually granted. */
export class PromoCode {
  private constructor(private readonly p: PromoCodeProps) {}

  /** Codes are typed by people: case and surrounding / inner spaces never matter. */
  static normalize(code: string): string {
    return code.replace(/\s+/g, '').toUpperCase();
  }

  static isValidCode(code: string): boolean {
    return CODE_RE.test(PromoCode.normalize(code));
  }

  /** Throws a 400 `bad_promo_code` unless the effect is well formed. */
  static assertEffect(e: PromoEffect): void {
    if (e.kind === 'ride') {
      if (!isPaidTierId(e.tier)) throw new BadRequestError('a ride code gives a 1h, 4h or 8h shift', 'bad_promo_code');
    } else if (e.kind === 'tickets') {
      if (!isPaidTierId(e.tier)) throw new BadRequestError('tickets need a paid tier (1h, 4h or 8h)', 'bad_promo_code');
      if (!Number.isInteger(e.credits) || e.credits < 1) throw new BadRequestError('a promo code must give at least 1 ticket', 'bad_promo_code');
      if (e.poolId !== null && (!Number.isInteger(e.poolId) || e.poolId < 0)) throw new BadRequestError('poolId must be a pool id (or none)', 'bad_promo_code');
    } else if (e.kind === 'free_rides') {
      if (!Number.isInteger(e.count) || e.count < 1 || e.count > MAX_FREE_RIDES_PER_CODE) throw new BadRequestError(`free rides: 1–${MAX_FREE_RIDES_PER_CODE} per redemption`, 'bad_promo_code');
    } else if (e.kind === 'cosmetic') {
      if (!isCosmeticSlot(e.slot)) throw new BadRequestError(`cosmetic slot must be one of ${COSMETIC_SLOTS.join(', ')}`, 'bad_promo_code');
      if (!isUnlockableCosmetic(e.slot, e.item)) throw new BadRequestError(`${String(e.item)} is not an unlockable ${e.slot}`, 'bad_promo_code');
    } else {
      throw new BadRequestError('unknown promo effect', 'bad_promo_code');
    }
  }

  static create(input: Omit<PromoCodeProps, 'redeemed' | 'disabledAt' | 'createdAt' | 'startsAt'> & { startsAt: Date | null; now: Date }): PromoCode {
    if (input.effect.kind === 'cosmetic') throw new ConflictError('cab visuals are minted by burning TEN4', 'visuals_are_honk');
    if (input.effect.kind === 'free_rides') throw new ConflictError('extra free-ride codes are retired; grant a 1h, 4h or 8h ride instead', 'promo_retired');
    if (input.effect.kind === 'ride' && input.perWallet !== 1) throw new BadRequestError('a ride code is redeemed once per wallet', 'bad_promo_code');
    const code = PromoCode.normalize(input.code);
    if (code === CONVOY_PROMO_CODE || code === PRESEASON_PROMO_CODE) throw new BadRequestError('this code is reserved for system grants', 'bad_promo_code');
    if (!CODE_RE.test(code)) throw new BadRequestError('a promo code is 3–32 letters, digits, "-" or "_"', 'bad_promo_code');
    PromoCode.assertEffect(input.effect);
    if (!Number.isInteger(input.perWallet) || input.perWallet < 1) throw new BadRequestError('perWallet must be at least 1', 'bad_promo_code');
    if (input.maxRedemptions !== null && (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1)) throw new BadRequestError('maxRedemptions must be at least 1 (or unlimited)', 'bad_promo_code');
    const description = input.description?.trim() || null;
    if (description && description.length > MAX_DESCRIPTION) throw new BadRequestError(`the description is at most ${MAX_DESCRIPTION} characters`, 'bad_promo_code');
    const note = input.note?.trim() || null;
    if (note && note.length > MAX_NOTE) throw new BadRequestError(`the note is at most ${MAX_NOTE} characters`, 'bad_promo_code');
    const startsAt = input.startsAt ?? input.now;
    if (input.expiresAt !== null && input.expiresAt.getTime() <= input.now.getTime()) throw new BadRequestError('the end of a promo code must be in the future', 'bad_promo_code');
    if (input.expiresAt !== null && input.expiresAt.getTime() <= startsAt.getTime()) throw new BadRequestError('a promo code must end after it starts', 'bad_promo_code');
    const { now, startsAt: _requested, ...rest } = input;
    return new PromoCode({ ...rest, code, description, note, startsAt, redeemed: 0, disabledAt: null, createdAt: now });
  }

  static restore(props: PromoCodeProps): PromoCode {
    return new PromoCode({ ...props });
  }

  get code(): string { return this.p.code; }
  get effect(): PromoEffect { return this.p.effect; }
  get description(): string | null { return this.p.description; }
  get perWallet(): number { return this.p.perWallet; }

  stateAt(now: Date): PromoState {
    if (this.p.disabledAt) return 'disabled';
    if (this.p.expiresAt && this.p.expiresAt.getTime() <= now.getTime()) return 'ended';
    if (this.p.startsAt.getTime() > now.getTime()) return 'scheduled';
    if (this.p.maxRedemptions !== null && this.p.redeemed >= this.p.maxRedemptions) return 'exhausted';
    return 'active';
  }

  /** null = `walletRedemptions` (how often this wallet already used the code) may redeem it now; otherwise why not. */
  whyNotRedeemable(now: Date, walletRedemptions: number): string | null {
    switch (this.stateAt(now)) {
      case 'disabled': return 'this promo code is no longer valid';
      case 'ended': return 'this promo code has expired';
      case 'scheduled': return 'this promo code is not active yet';
      case 'exhausted': return 'this promo code has been fully redeemed';
      default: return walletRedemptions >= this.p.perWallet ? 'you have already redeemed this promo code' : null;
    }
  }

  snapshot(): PromoCodeProps {
    return { ...this.p, effect: { ...this.p.effect } };
  }
}
