import type { ChainEventDto } from '../../../../domain/economy/chain.dto.js';
import type { PrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';

export class GetPrizePoolQuery {
  constructor(public readonly id: number) {}
}

export const RECENT_EVENTS = 20;

/** The pool page: the pool + its newest on-chain events (GET /api/pools/:id; the list routes keep the plain PrizePoolDto). */
export interface PrizePoolDetailDto extends PrizePoolDto {
  /** the last RECENT_EVENTS events the server saw for this pool, newest first */
  recent: ChainEventDto[];
}
