import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { BLOCKHASH_TTL_SECONDS, type ChainFeesDto } from '../../../../domain/economy/chain.dto.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { GetChainFeesQuery } from './get-chain-fees.query.js';

/** The fee line next to BUY: the live priority price of a purchase (the adapter caches it briefly), and whether the gas sponsor pays it. An RPC outage is a 503. */
@QueryHandler(GetChainFeesQuery)
export class GetChainFeesHandler implements IQueryHandler<GetChainFeesQuery, ChainFeesDto> {
  constructor(
    private readonly chain: PoolChainPort,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute(query: GetChainFeesQuery): Promise<ChainFeesDto> {
    const quote = await this.chain.feeQuote({ poolId: query.poolId, kind: 'buy' });
    return { ...quote, sponsored: this.rules.get().sponsorEnabled, blockhashTtlSeconds: BLOCKHASH_TTL_SECONDS };
  }
}
