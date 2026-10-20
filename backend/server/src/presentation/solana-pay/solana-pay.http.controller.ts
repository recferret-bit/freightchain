import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { solanaPayLinkResponse, solanaPayTxResponse } from '../common/response/rest.response.js';
import { QueryBus } from '@nestjs/cqrs';
import { GetSolanaPayLinkQuery, GetSolanaPayTransactionQuery, type SolanaPayLinkDto, type SolanaPayTransactionDto } from '../../application/use-cases/solana-pay/solana-pay.query.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { solanaPayAccountSchema, solanaPayIdParamsSchema, type SolanaPayAccount, type SolanaPayIdParams } from './solana-pay.dto.js';
import { CrossOriginPublic } from '../../infrastructure/http/guards/origin.guard.js';

/** Public Solana Pay transaction requests. No session: the phone wallet GETs the label, then POSTs the account that will sign. */
@CrossOriginPublic()   // any site may POST here without a session (audit H7: the Origin guard skips it)
@Controller('api/solana-pay')
export class SolanaPayHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('rides/:id')
  @ZodResponse(solanaPayLinkResponse)
  rideLink(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams): Promise<SolanaPayLinkDto> {
    return this.queryBus.execute<GetSolanaPayLinkQuery, SolanaPayLinkDto>(new GetSolanaPayLinkQuery(params.id));
  }

  @Post('rides/:id') @HttpCode(200)
  @ZodResponse(solanaPayTxResponse)
  ride(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams, @ZodBody(solanaPayAccountSchema) body: SolanaPayAccount): Promise<SolanaPayTransactionDto> {
    return this.queryBus.execute<GetSolanaPayTransactionQuery, SolanaPayTransactionDto>(new GetSolanaPayTransactionQuery('ride', params.id, body.account));
  }

  @Get('orders/:id')
  @ZodResponse(solanaPayLinkResponse)
  orderLink(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams): Promise<SolanaPayLinkDto> {
    return this.queryBus.execute<GetSolanaPayLinkQuery, SolanaPayLinkDto>(new GetSolanaPayLinkQuery(params.id));
  }

  @Post('orders/:id') @HttpCode(200)
  @ZodResponse(solanaPayTxResponse)
  order(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams, @ZodBody(solanaPayAccountSchema) body: SolanaPayAccount): Promise<SolanaPayTransactionDto> {
    return this.queryBus.execute<GetSolanaPayTransactionQuery, SolanaPayTransactionDto>(new GetSolanaPayTransactionQuery('order', params.id, body.account));
  }

  @Get('donations/:id')
  @ZodResponse(solanaPayLinkResponse)
  donationLink(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams): Promise<SolanaPayLinkDto> {
    return this.queryBus.execute<GetSolanaPayLinkQuery, SolanaPayLinkDto>(new GetSolanaPayLinkQuery(params.id));
  }

  @Post('donations/:id') @HttpCode(200)
  @ZodResponse(solanaPayTxResponse)
  donation(@ZodParams(solanaPayIdParamsSchema) params: SolanaPayIdParams, @ZodBody(solanaPayAccountSchema) body: SolanaPayAccount): Promise<SolanaPayTransactionDto> {
    return this.queryBus.execute<GetSolanaPayTransactionQuery, SolanaPayTransactionDto>(new GetSolanaPayTransactionQuery('donation', params.id, body.account));
  }
}
