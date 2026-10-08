import type { PromoDto } from '../../../../domain/economy/promo.dto.js';

export class ListPromosQuery {}

export interface PromoListDto {
  /** newest first */
  promos: PromoDto[];
}
