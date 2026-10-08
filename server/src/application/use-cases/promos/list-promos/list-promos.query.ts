import type { PromoDto } from '../../../../domain/economy/promo.dto.js';
import type { PromoState } from '../../../../domain/economy/promo.types.js';

/** Admin: every code with its usage; `state` narrows it ('active' = the codes players can redeem right now). */
export class ListPromosQuery {
  constructor(public readonly state: PromoState | null = null) {}
}

export interface PromoListDto {
  /** newest first */
  promos: PromoDto[];
}
