import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { ChainFeesDto } from '../../domain/economy/chain.dto.js';
import { GetChainFeesQuery } from '../../application/use-cases/chain/get-chain-fees/get-chain-fees.query.js';
import { ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { chainFeesQuerySchema, type ChainFeesQuery } from './dto/chain.dto.js';

/** Public: the network's side of a purchase (docs/paid-tickets-plan.md §2.4). */
@Controller('api/chain')
export class ChainHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('fees')
  fees(@ZodQuery(chainFeesQuerySchema) query: ChainFeesQuery): Promise<ChainFeesDto> {
    return this.queryBus.execute<GetChainFeesQuery, ChainFeesDto>(new GetChainFeesQuery(query.poolId ?? null));
  }
}
