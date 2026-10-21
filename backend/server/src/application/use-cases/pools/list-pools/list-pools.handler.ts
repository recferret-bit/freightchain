import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toPrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { ListPoolsQuery, type PoolListDto } from './list-pools.query.js';
import { GetCurrentPoolQuery, type CurrentPoolDto } from './get-current-pool.query.js';

const FINISHED = 3;

/** The pools on sale or running – public (the landing and the lobby show "7 / 10 committed" before sign-in). */
@QueryHandler(ListPoolsQuery)
export class ListPoolsHandler implements IQueryHandler<ListPoolsQuery, PoolListDto> {
  constructor(private readonly pools: PoolRepositoryPort, private readonly clock: ClockPort) {}

  async execute(): Promise<PoolListDto> {
    const now = this.clock.now();
    const [live, finished] = await Promise.all([this.pools.listLive(), this.pools.listSettled(FINISHED)]);
    return { pools: live.map((p) => toPrizePoolDto(p, now)), finished: finished.map((p) => toPrizePoolDto(p, now)) };
  }
}

/** The soonest live pool, or null. Same schedule fields as GET /api/pools/:id. */
@QueryHandler(GetCurrentPoolQuery)
export class GetCurrentPoolHandler implements IQueryHandler<GetCurrentPoolQuery, CurrentPoolDto> {
  constructor(private readonly pools: PoolRepositoryPort, private readonly clock: ClockPort) {}

  async execute(): Promise<CurrentPoolDto> {
    const live = await this.pools.listLive();
    const pool = live[0] ?? null;
    return { pool: pool ? toPrizePoolDto(pool, this.clock.now()) : null };
  }
}
