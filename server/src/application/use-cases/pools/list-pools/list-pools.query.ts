import type { PrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';

export class ListPoolsQuery {}

export interface PoolListDto {
  /** every open / active pool, soonest play deadline first */
  pools: PrizePoolDto[];
}
