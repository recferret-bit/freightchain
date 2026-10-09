import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { TiersDto } from '../../../../domain/economy/economy.dto.js';
import { lamportsFor } from '../../../../domain/economy/prize-split.js';
import { completeDist, completeDistK } from '../../../../domain/rides/ride-rules.js';
import { isPaidTier, rideTiers } from '../../../../domain/rides/ride-tier.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PriceQuotePort } from '../../../ports/economy/price-quote.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import type { Pool } from '../../../../domain/economy/pool.entity.js';
import { toPrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import { GetTiersQuery } from './get-tiers.query.js';

/** The ride list with live lamport prices – public (the landing page and the lobby show it before / without a wallet). */
@QueryHandler(GetTiersQuery)
export class GetTiersHandler implements IQueryHandler<GetTiersQuery, TiersDto> {
  constructor(
    private readonly rules: RulesConfigPort,
    private readonly price: PriceQuotePort,
    private readonly pools: PoolRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<TiersDto> {
    const rules = this.rules.get();
    const quote = await this.price.solUsd().catch(() => null);
    const now = this.clock.now();
    const live = await this.pools.listLive();
    // per tier: the pool still selling that ends soonest, else the first live one (shown, not buyable)
    const poolOf = (tier: string): Pool | null => live.find((p) => p.tier === tier && p.whyNotSellable(now, 1, 0) === null) ?? live.find((p) => p.tier === tier) ?? null;
    return {
      solUsd: quote?.usd ?? null,
      treasury: rules.treasury || null,
      paymentMode: rules.paymentMode,
      tiers: rideTiers(rules.freeRideSeconds).map((t) => {
        const pool = isPaidTier(t.id) ? poolOf(t.id) : null;
        const row = { id: t.id, usd: t.usd, seconds: t.seconds, completeDist: completeDist(t.seconds, completeDistK(t.id)), onSale: t.onSale };
        if (pool) return { ...row, lamports: pool.priceLamports, available: pool.whyNotSellable(now, 1, 0) === null, pool: toPrizePoolDto(pool) };
        // program mode is ticket-only. An off-sale tier with no live pool has no price (the lobby says SOON). An on-sale tier with no pool keeps the legacy quote in transfer mode.
        const legacy = t.onSale && isPaidTier(t.id) && rules.paymentMode !== 'program';
        return {
          ...row,
          lamports: legacy && quote ? lamportsFor(t.usd, quote.usd) : null,
          available: !isPaidTier(t.id) || (legacy && !!rules.treasury && !!quote),
          pool: null,
        };
      }),
    };
  }
}
