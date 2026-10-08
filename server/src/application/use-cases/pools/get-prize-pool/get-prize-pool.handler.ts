import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toChainEventDto } from '../../../../domain/economy/chain.dto.js';
import { toPrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { ChainEventRepositoryPort } from '../../../ports/economy/chain-event.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { GetPrizePoolQuery, RECENT_EVENTS, type PrizePoolDetailDto } from './get-prize-pool.query.js';

/** One pool in any status – public (a refunding or settled pool stays readable: its page is the receipt). */
@QueryHandler(GetPrizePoolQuery)
export class GetPrizePoolHandler implements IQueryHandler<GetPrizePoolQuery, PrizePoolDetailDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly events: ChainEventRepositoryPort,
  ) {}

  async execute({ id }: GetPrizePoolQuery): Promise<PrizePoolDetailDto> {
    const pool = await this.pools.findById(id);
    if (!pool) throw new NotFoundError('no such pool');
    const recent = await this.events.recentOfPool(id, RECENT_EVENTS);
    return { ...toPrizePoolDto(pool), recent: recent.map(toChainEventDto) };
  }
}
