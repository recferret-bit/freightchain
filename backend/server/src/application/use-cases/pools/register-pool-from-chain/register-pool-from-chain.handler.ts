import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toPrizePoolDto, type PrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { PoolRegistryService } from '../../../services/pool-registry.service.js';
import { RegisterPoolFromChainCommand } from './register-pool-from-chain.command.js';

/** `pool:register`: the mirror row from the account (PoolRegistryService.syncFromChain). 404 when the program has no such pool; 503 when the RPC is down. */
@CommandHandler(RegisterPoolFromChainCommand)
export class RegisterPoolFromChainHandler implements ICommandHandler<RegisterPoolFromChainCommand, PrizePoolDto> {
  constructor(private readonly registry: PoolRegistryService) {}

  async execute({ poolId, label }: RegisterPoolFromChainCommand): Promise<PrizePoolDto> {
    const pool = await this.registry.syncFromChain(poolId, label);
    if (!pool) throw new NotFoundError(`no pool ${poolId} on chain`);
    return toPrizePoolDto(pool);
  }
}
