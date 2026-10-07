import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toPrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { ListPoolsQuery, type PoolListDto } from './list-pools.query.js';

/** The pools on sale or running – public (the landing and the lobby show "7 / 10 committed" before sign-in). */
@QueryHandler(ListPoolsQuery)
export class ListPoolsHandler implements IQueryHandler<ListPoolsQuery, PoolListDto> {
  constructor(private readonly pools: PoolRepositoryPort) {}

  async execute(): Promise<PoolListDto> {
    return { pools: (await this.pools.listLive()).map(toPrizePoolDto) };
  }
}
