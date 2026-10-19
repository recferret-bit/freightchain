import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { SnsResolutionDto, SnsReverseDto } from '../../domain/sns/sns.dto.js';
import { GetSnsReverseQuery } from '../../application/use-cases/sns/get-sns-reverse/get-sns-reverse.query.js';
import { ResolveSnsQuery } from '../../application/use-cases/sns/resolve-sns/resolve-sns.query.js';
import { ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import {
  snsReverseQuerySchema,
  snsResolveQuerySchema,
  type SnsReverseQuery,
  type SnsResolveQuery,
} from './dto/sns.dto.js';

/** Solana Name Service (SNS / .sol) forward and reverse resolution. */
@Controller('api/sns')
export class SnsHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  /** Reverse lookup: driver wallet public key -> primary .sol domain name (or null). */
  @Get('reverse')
  reverse(@ZodQuery(snsReverseQuerySchema) query: SnsReverseQuery): Promise<SnsReverseDto> {
    return this.queryBus.execute<GetSnsReverseQuery, SnsReverseDto>(new GetSnsReverseQuery(query.wallet));
  }

  /** Forward lookup: .sol domain name -> driver wallet public key (or null). */
  @Get('resolve')
  resolve(@ZodQuery(snsResolveQuerySchema) query: SnsResolveQuery): Promise<SnsResolutionDto> {
    return this.queryBus.execute<ResolveSnsQuery, SnsResolutionDto>(new ResolveSnsQuery(query.domain));
  }
}
