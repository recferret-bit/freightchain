import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { DailyStatsDto, GlobalStatsDto } from '../../domain/stats/stats.js';
import { GetDailyStatsQuery } from '../../application/use-cases/stats/get-daily-stats/get-daily-stats.query.js';
import { GetStatsQuery } from '../../application/use-cases/stats/get-stats/get-stats.query.js';

@Controller('api')
export class StatsHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  /** Public – the whole game's running totals: rides, driven time and distance, crashes (car ⇄ car, car ⇄ building), donations during streams. Cached. */
  @Get('stats')
  stats(): Promise<GlobalStatsDto> {
    return this.queryBus.execute<GetStatsQuery, GlobalStatsDto>(new GetStatsQuery());
  }

  /** Public – the history: one row per UTC day with any activity (the newest 90), oldest first. Cached. */
  @Get('stats/daily')
  daily(): Promise<DailyStatsDto[]> {
    return this.queryBus.execute<GetDailyStatsQuery, DailyStatsDto[]>(new GetDailyStatsQuery());
  }
}
