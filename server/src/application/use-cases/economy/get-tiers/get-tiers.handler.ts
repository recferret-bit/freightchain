import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { TiersDto } from '../../../../domain/economy/economy.dto.js';
import { lamportsFor } from '../../../../domain/economy/prize-split.js';
import { completeDist } from '../../../../domain/rides/ride-rules.js';
import { isPaidTier, rideTiers } from '../../../../domain/rides/ride-tier.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PriceQuotePort } from '../../../ports/economy/price-quote.port.js';
import { GetTiersQuery } from './get-tiers.query.js';

/** The ride list with live lamport prices – public (the landing page and the lobby show it before / without a wallet). */
@QueryHandler(GetTiersQuery)
export class GetTiersHandler implements IQueryHandler<GetTiersQuery, TiersDto> {
  constructor(
    private readonly rules: RulesConfigPort,
    private readonly price: PriceQuotePort,
  ) {}

  async execute(): Promise<TiersDto> {
    const rules = this.rules.get();
    const quote = await this.price.solUsd().catch(() => null);
    return {
      solUsd: quote?.usd ?? null,
      treasury: rules.treasury || null,
      tiers: rideTiers(rules.freeRideSeconds).map((t) => ({
        id: t.id, usd: t.usd, seconds: t.seconds, completeDist: completeDist(t.seconds),
        lamports: isPaidTier(t.id) && quote ? lamportsFor(t.usd, quote.usd) : null,
        available: !isPaidTier(t.id) || (!!rules.treasury && !!quote),
      })),
    };
  }
}
