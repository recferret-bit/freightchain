import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { GlobalStatsDto } from '../../domain/stats/stats.js';
import { GetStatsQuery } from '../../application/use-cases/stats/get-stats/get-stats.query.js';

@Controller('api')
export class StatsHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  /** Public – the whole game's running totals: rides, driven time and distance, crashes (car ⇄ car, car ⇄ building), donations during streams. Cached. */
  @Get('stats')
  stats(): Promise<GlobalStatsDto> {
    return this.queryBus.execute<GetStatsQuery, GlobalStatsDto>(new GetStatsQuery());
  }
}
