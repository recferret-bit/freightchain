import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { GetPrizeBoardQuery } from '../../application/use-cases/prize/get-prize-board/get-prize-board.query.js';
import type { PrizeBoardDto } from '../../application/use-cases/prize/get-prize-board/get-prize-board.handler.js';
import { ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { prizeBoardQuerySchema, type PrizeBoardQuery } from './dto/prize.dto.js';

/** Public weekly skill board. Not the legacy distance leaderboard and not the ticket vault. */
@Controller('api/prize')
export class PrizeHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('board')
  board(@ZodQuery(prizeBoardQuerySchema) query: PrizeBoardQuery): Promise<PrizeBoardDto> {
    return this.queryBus.execute<GetPrizeBoardQuery, PrizeBoardDto>(new GetPrizeBoardQuery(query.tier, query.at ? new Date(query.at) : null));
  }
}
