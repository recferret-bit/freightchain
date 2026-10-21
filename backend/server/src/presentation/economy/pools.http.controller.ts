import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { poolListResponse, currentPoolResponse, prizePoolDetailResponse, poolStandingsResponse, poolResultsResponse, promoRedeemedResponse, refundTransactionResponse, payoutTransactionsResponse, settledSignatureResponse } from '../common/response/economy.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { RedeemPromoCommand, type PromoRedeemedDto } from '../../application/use-cases/players/redeem-promo/redeem-promo.command.js';
import { GetPrizePoolQuery, type PrizePoolDetailDto } from '../../application/use-cases/pools/get-prize-pool/get-prize-pool.query.js';
import { ListPoolsQuery, type PoolListDto } from '../../application/use-cases/pools/list-pools/list-pools.query.js';
import { GetCurrentPoolQuery, type CurrentPoolDto } from '../../application/use-cases/pools/list-pools/get-current-pool.query.js';
import { GetPoolStandingsQuery, type PoolStandingsDto } from '../../application/use-cases/pools/get-pool-standings/get-pool-standings.query.js';
import { GetPoolResultsQuery, type PoolResultsDto } from '../../application/rides/get-pool-results.query.js';
import { SettleChainSignatureCommand, type SettledSignatureDto } from '../../application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { GetPayoutTransactionsQuery, type PayoutTransactionsDto } from '../../application/use-cases/pools/get-payout-transactions/get-payout-transactions.query.js';
import { GetRefundTransactionQuery, type RefundTransactionDto } from '../../application/use-cases/pools/get-refund-transaction/get-refund-transaction.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import { TermsGuard } from '../common/guards/terms.guard.js';
import { OptionalSessionGuard } from '../../infrastructure/http/guards/optional-session.guard.js';
import { OptionalSession } from '../../infrastructure/http/decorators/optional-session.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { confirmTicketOrderBodySchema, poolIdParamsSchema, redeemPromoBodySchema, type ConfirmTicketOrderBody, type PoolIdParams, type RedeemPromoBody } from './dto/pools.dto.js';

/** The escrowed prize pools (public: anyone can check a pool's rules and progress) and promo codes (signed-in: free tickets into a pool). */
@Controller('api')
export class PoolsHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('pools')
  @ZodResponse(poolListResponse)
  list(): Promise<PoolListDto> {
    return this.queryBus.execute<ListPoolsQuery, PoolListDto>(new ListPoolsQuery());
  }

  /** The soonest live pool (open or active), with the five schedule timestamps and phase. */
  @Get('pools/current')
  @ZodResponse(currentPoolResponse)
  current(): Promise<CurrentPoolDto> {
    return this.queryBus.execute<GetCurrentPoolQuery, CurrentPoolDto>(new GetCurrentPoolQuery());
  }

  @Get('pools/:id')
  @ZodResponse(prizePoolDetailResponse)
  get(@ZodParams(poolIdParamsSchema) params: PoolIdParams): Promise<PrizePoolDetailDto> {
    return this.queryBus.execute<GetPrizePoolQuery, PrizePoolDetailDto>(new GetPrizePoolQuery(params.id));
  }

  /** The winners list (public): provisional during the review window, fixed once the payout job planned it, with what was paid. */
  @Get('pools/:id/standings')
  @ZodResponse(poolStandingsResponse)
  standings(@ZodParams(poolIdParamsSchema) params: PoolIdParams): Promise<PoolStandingsDto> {
    return this.queryBus.execute<GetPoolStandingsQuery, PoolStandingsDto>(new GetPoolStandingsQuery(params.id));
  }

  /** Before payoutAt: participant count and the caller's own summary. After: the ranked breakdown. humannessScore stays off this route. */
  @Get('pools/:id/results') @UseGuards(OptionalSessionGuard)
  @ZodResponse(poolResultsResponse)
  results(@ZodParams(poolIdParamsSchema) params: PoolIdParams, @OptionalSession() wallet: string | null): Promise<PoolResultsDto> {
    return this.queryBus.execute<GetPoolResultsQuery, PoolResultsDto>(new GetPoolResultsQuery(params.id, wallet));
  }

  /** 200 `{ poolId, added, balance, cap }` · 404 unknown code · 409 used up / expired / already redeemed / at the pool's cap / no open pool. */
  @Post('promo/redeem') @HttpCode(200) @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(promoRedeemedResponse)
  redeem(@CurrentPlayer() player: PlayerIdentity, @ZodBody(redeemPromoBodySchema) body: RedeemPromoBody): Promise<PromoRedeemedDto> {
    return this.commandBus.execute<RedeemPromoCommand, PromoRedeemedDto>(new RedeemPromoCommand(player.wallet, body.code));
  }

  /** CLAIM REFUND: the unsigned (self-paid) refund of everything the caller paid into a failed pool · 409 not refundable / nothing paid. */
  @Get('pools/:id/refund') @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(refundTransactionResponse)
  refund(@CurrentPlayer() player: PlayerIdentity, @ZodParams(poolIdParamsSchema) params: PoolIdParams): Promise<RefundTransactionDto> {
    return this.queryBus.execute<GetRefundTransactionQuery, RefundTransactionDto>(new GetRefundTransactionQuery(player.wallet, params.id));
  }

  /** Admin (the pool authority) only: the ranked payouts as unsigned pay_prize transactions, then close_pool · 403 not the admin · 409 not payable yet. */
  @Get('pools/:id/payout') @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(payoutTransactionsResponse)
  payout(@CurrentPlayer() player: PlayerIdentity, @ZodParams(poolIdParamsSchema) params: PoolIdParams): Promise<PayoutTransactionsDto> {
    return this.queryBus.execute<GetPayoutTransactionsQuery, PayoutTransactionsDto>(new GetPayoutTransactionsQuery(player.wallet, params.id));
  }

  /** "I just sent this transaction" (a refund, a payout, a purchase without an order): settle it now instead of waiting for the watcher. Idempotent. */
  @Post('chain/settle') @HttpCode(200) @UseGuards(PlayerAuthGuard, TermsGuard)
  @ZodResponse(settledSignatureResponse)
  settle(@ZodBody(confirmTicketOrderBodySchema) body: ConfirmTicketOrderBody): Promise<SettledSignatureDto> {
    return this.commandBus.execute<SettleChainSignatureCommand, SettledSignatureDto>(new SettleChainSignatureCommand(body.signature));
  }
}
