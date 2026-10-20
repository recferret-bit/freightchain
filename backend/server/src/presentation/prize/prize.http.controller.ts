import { Controller, Get } from '@nestjs/common';
import { prizeBoardResponse } from '../common/response/rest.response.js';
import { QueryBus } from '@nestjs/cqrs';
import { GetPrizeBoardQuery } from '../../application/use-cases/prize/get-prize-board/get-prize-board.query.js';
import type { PrizeBoardDto } from '../../application/use-cases/prize/get-prize-board/get-prize-board.handler.js';
import { ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { prizeBoardQuerySchema, type PrizeBoardQuery } from './dto/prize.dto.js';

/** Public weekly skill board. Not the legacy distance leaderboard and not the ticket vault. */
@Controller('api/prize')
export class PrizeHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('board')
  @ZodResponse(prizeBoardResponse)
  board(@ZodQuery(prizeBoardQuerySchema) query: PrizeBoardQuery): Promise<PrizeBoardDto> {
    return this.queryBus.execute<GetPrizeBoardQuery, PrizeBoardDto>(new GetPrizeBoardQuery(query.tier, query.at ? new Date(query.at) : null));
  }
}
