import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { GetSolanaPayLinkQuery, GetSolanaPayTransactionQuery, type SolanaPayLinkDto, type SolanaPayTransactionDto } from '../../application/use-cases/solana-pay/solana-pay.query.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { solanaPayAccountSchema, solanaPayIdParamsSchema, type SolanaPayAccount, type SolanaPayIdParams } from './solana-pay.dto.js';

/** Public Solana Pay transaction requests. No session: the phone wallet GETs the label, then POSTs the account that will sign. */
@Controller('api/solana-pay')
export class SolanaPayHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('rides/:id')
  rideLink(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams): Promise<SolanaPayLinkDto> {
    return this.queryBus.execute<GetSolanaPayLinkQuery, SolanaPayLinkDto>(new GetSolanaPayLinkQuery(params.id));
  }

  @Post('rides/:id') @HttpCode(200)
  ride(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams, @ZodBody(solanaPayAccountSchema) body: SolanaPayAccount): Promise<SolanaPayTransactionDto> {
    return this.queryBus.execute<GetSolanaPayTransactionQuery, SolanaPayTransactionDto>(new GetSolanaPayTransactionQuery('ride', params.id, body.account));
  }

  @Get('orders/:id')
  orderLink(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams): Promise<SolanaPayLinkDto> {
    return this.queryBus.execute<GetSolanaPayLinkQuery, SolanaPayLinkDto>(new GetSolanaPayLinkQuery(params.id));
  }

  @Post('orders/:id') @HttpCode(200)
  order(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams, @ZodBody(solanaPayAccountSchema) body: SolanaPayAccount): Promise<SolanaPayTransactionDto> {
    return this.queryBus.execute<GetSolanaPayTransactionQuery, SolanaPayTransactionDto>(new GetSolanaPayTransactionQuery('order', params.id, body.account));
  }

  @Get('donations/:id')
  donationLink(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams): Promise<SolanaPayLinkDto> {
    return this.queryBus.execute<GetSolanaPayLinkQuery, SolanaPayLinkDto>(new GetSolanaPayLinkQuery(params.id));
  }

  @Post('donations/:id') @HttpCode(200)
  donation(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams, @ZodBody(solanaPayAccountSchema) body: SolanaPayAccount): Promise<SolanaPayTransactionDto> {
    return this.queryBus.execute<GetSolanaPayTransactionQuery, SolanaPayTransactionDto>(new GetSolanaPayTransactionQuery('donation', params.id, body.account));
  }
}
