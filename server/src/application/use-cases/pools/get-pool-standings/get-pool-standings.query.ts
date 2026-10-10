import type { PoolStandingsDto } from '../../../../domain/economy/pool-standings.dto.js';

export class GetPoolStandingsQuery {
  constructor(public readonly poolId: number) {}
}

export type { PoolStandingsDto };
