import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { DailyStatsDto } from '../../../../domain/stats/stats.js';
import { StatsService } from '../../../services/stats.service.js';
import { GetDailyStatsQuery } from './get-daily-stats.query.js';

/** Rides, driven time and distance, crashes and donations per UTC day – read through the cache like the totals. */
@QueryHandler(GetDailyStatsQuery)
export class GetDailyStatsHandler implements IQueryHandler<GetDailyStatsQuery, DailyStatsDto[]> {
  constructor(private readonly stats: StatsService) {}

  execute(): Promise<DailyStatsDto[]> {
    return this.stats.daily();
  }
}
