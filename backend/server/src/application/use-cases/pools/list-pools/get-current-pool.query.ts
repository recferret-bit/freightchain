import type { PrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';

export class GetCurrentPoolQuery {}

export interface CurrentPoolDto {
  pool: PrizePoolDto | null;
}
