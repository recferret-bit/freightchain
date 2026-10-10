import { QueryBus, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toPrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import type { PoolStandingsDto } from '../../../../domain/economy/pool-standings.dto.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { GetPoolStandingsQuery } from '../../pools/get-pool-standings/get-pool-standings.query.js';
import { ListAdminPoolsQuery, type AdminPoolsDto } from './list-admin-pools.query.js';

const SETTLED = 5;

/** Live pools (soonest play deadline first) then the newest settled ones, each with the same winners list the public sees. */
@QueryHandler(ListAdminPoolsQuery)
export class ListAdminPoolsHandler implements IQueryHandler<ListAdminPoolsQuery, AdminPoolsDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly queries: QueryBus,
  ) {}

  async execute(): Promise<AdminPoolsDto> {
    const all = [...(await this.pools.listLive()), ...(await this.pools.listSettled(SETTLED))];
    const out = [];
    for (const p of all) {
      const standings = await this.queries.execute<GetPoolStandingsQuery, PoolStandingsDto>(new GetPoolStandingsQuery(p.id));
      const h = p.hold;
      out.push({ pool: toPrizePoolDto(p), standings, hold: h ? { by: h.by, at: h.at.getTime(), note: h.note } : null });
    }
    return { pools: out };
  }
}
