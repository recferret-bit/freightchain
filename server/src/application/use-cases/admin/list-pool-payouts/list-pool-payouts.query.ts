import type { PoolStandingsDto } from '../../../../domain/economy/pool-standings.dto.js';
import type { PrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';

/** The admin page's PAYOUTS tab: every live pool and the last settled ones, each with its winners list and who holds it. */
export class ListPoolPayoutsQuery {}

export interface PoolPayoutRowDto {
  pool: PrizePoolDto;
  standings: PoolStandingsDto;
  hold: { by: string; at: number; note: string | null } | null;
}

export interface PoolPayoutsDto {
  pools: PoolPayoutRowDto[];
}
