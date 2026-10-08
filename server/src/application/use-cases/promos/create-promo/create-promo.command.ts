import type { PromoCreateInput } from '../../../../domain/economy/promo.types.js';

export class CreatePromoCommand {
  constructor(public readonly input: PromoCreateInput) {}
}
