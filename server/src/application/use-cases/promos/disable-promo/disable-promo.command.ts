import type { PromoDto } from '../../../../domain/economy/promo.dto.js';

export class DisablePromoCommand {
  constructor(public readonly code: string) {}
}

export type PromoDisabledDto = PromoDto;
