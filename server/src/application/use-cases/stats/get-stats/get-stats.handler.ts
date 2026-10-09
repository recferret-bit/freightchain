import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { GlobalStatsDto } from '../../../../domain/stats/stats.js';
import { StatsService } from '../../../services/stats.service.js';
import { GetStatsQuery } from './get-stats.query.js';

/** Total rides, time, distance, crashes and stream donations of the whole game – read through the cache (Redis in production), the statistics table behind it. */
@QueryHandler(GetStatsQuery)
export class GetStatsHandler implements IQueryHandler<GetStatsQuery, GlobalStatsDto> {
  constructor(private readonly stats: StatsService) {}

  execute(): Promise<GlobalStatsDto> {
    return this.stats.global();
  }
}
