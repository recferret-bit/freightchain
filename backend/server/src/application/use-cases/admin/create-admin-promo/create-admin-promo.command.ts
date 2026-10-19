import type { PromoCreateInput } from '../../../../domain/economy/promo.types.js';

/** The admin page's new promo code: the wallet signed the text for exactly this code (`AdminIntent` promo_create). */
export class CreateAdminPromoCommand {
  constructor(
    public readonly admin: string,
    public readonly input: PromoCreateInput,
    public readonly requestId: string | null,
    public readonly signature: string,
  ) {}
}
