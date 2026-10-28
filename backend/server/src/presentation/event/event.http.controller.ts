import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { PublicEventBoardDto } from '../../domain/prize/event-dto.js';
import { GetEventBoardQuery } from '../../application/use-cases/event/get-event-board/get-event-board.query.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { publicEventResponse } from './dto/event.dto.js';

/** The public Pre-season table: empty before the review end, preliminary after it, final once locked. Read-only, shortened wallets. */
@Controller('api/event')
export class EventHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('board')
  @ZodResponse(publicEventResponse)
  board(): Promise<PublicEventBoardDto> {
    return this.queryBus.execute<GetEventBoardQuery, PublicEventBoardDto>(new GetEventBoardQuery());
  }
}
