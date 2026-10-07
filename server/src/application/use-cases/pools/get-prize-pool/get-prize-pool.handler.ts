import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toPrizePoolDto, type PrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { GetPrizePoolQuery } from './get-prize-pool.query.js';

/** One pool in any status – public (a refunding or settled pool stays readable: its page is the receipt). */
@QueryHandler(GetPrizePoolQuery)
export class GetPrizePoolHandler implements IQueryHandler<GetPrizePoolQuery, PrizePoolDto> {
  constructor(private readonly pools: PoolRepositoryPort) {}

  async execute({ id }: GetPrizePoolQuery): Promise<PrizePoolDto> {
    const pool = await this.pools.findById(id);
    if (!pool) throw new NotFoundError('no such pool');
    return toPrizePoolDto(pool);
  }
}
