import { BadRequestError } from '../shared/errors.js';
import type { PromoCodeProps } from './promo.types.js';

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/** A promo code (docs/paid-tickets-plan.md §3 W2): tickets of a tier, redeemable a limited number of times overall and per wallet, until it expires or is disabled. */
export class PromoCode {
  private constructor(private readonly p: PromoCodeProps) {}

  /** Codes are typed by people: case and surrounding / inner spaces never matter. */
  static normalize(code: string): string {
    return code.replace(/\s+/g, '').toUpperCase();
  }

  static isValidCode(code: string): boolean {
    return CODE_RE.test(PromoCode.normalize(code));
  }

  static create(input: Omit<PromoCodeProps, 'redeemed' | 'disabledAt' | 'createdAt'> & { now: Date }): PromoCode {
    const code = PromoCode.normalize(input.code);
    if (!CODE_RE.test(code)) throw new BadRequestError('a promo code is 3–32 letters, digits, "-" or "_"', 'bad_promo_code');
    if (!Number.isInteger(input.credits) || input.credits < 1) throw new BadRequestError('a promo code must give at least 1 ticket', 'bad_promo_code');
    if (!Number.isInteger(input.perWallet) || input.perWallet < 1) throw new BadRequestError('perWallet must be at least 1', 'bad_promo_code');
    if (input.maxRedemptions !== null && (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1)) throw new BadRequestError('maxRedemptions must be at least 1 (or unlimited)', 'bad_promo_code');
    const { now, ...rest } = input;
    return new PromoCode({ ...rest, code, redeemed: 0, disabledAt: null, createdAt: now });
  }

  static restore(props: PromoCodeProps): PromoCode {
    return new PromoCode({ ...props });
  }

  get code(): string { return this.p.code; }
  get tier(): PromoCodeProps['tier'] { return this.p.tier; }
  get poolId(): number | null { return this.p.poolId; }
  get credits(): number { return this.p.credits; }
  get perWallet(): number { return this.p.perWallet; }

  /** null = `walletRedemptions` (how often this wallet already used the code) may redeem it now; otherwise why not. */
  whyNotRedeemable(now: Date, walletRedemptions: number): string | null {
    if (this.p.disabledAt) return 'this promo code is no longer valid';
    if (this.p.expiresAt && this.p.expiresAt.getTime() <= now.getTime()) return 'this promo code has expired';
    if (this.p.maxRedemptions !== null && this.p.redeemed >= this.p.maxRedemptions) return 'this promo code has been fully redeemed';
    if (walletRedemptions >= this.p.perWallet) return 'you have already redeemed this promo code';
    return null;
  }

  snapshot(): PromoCodeProps {
    return { ...this.p };
  }
}
