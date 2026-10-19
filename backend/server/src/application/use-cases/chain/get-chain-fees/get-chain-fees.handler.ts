import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { BLOCKHASH_TTL_SECONDS, type ChainFeesDto } from '../../../../domain/economy/chain.dto.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { GetChainFeesQuery } from './get-chain-fees.query.js';

/** The fee line next to BUY: the live priority price of a purchase (the adapter caches it briefly), the wallet pays it itself. An RPC outage is a 503. */
@QueryHandler(GetChainFeesQuery)
export class GetChainFeesHandler implements IQueryHandler<GetChainFeesQuery, ChainFeesDto> {
  constructor(private readonly chain: PoolChainPort) {}

  async execute(query: GetChainFeesQuery): Promise<ChainFeesDto> {
    const quote = await this.chain.feeQuote({ poolId: query.poolId, kind: 'buy' });
    return { ...quote, blockhashTtlSeconds: BLOCKHASH_TTL_SECONDS };
  }
}
