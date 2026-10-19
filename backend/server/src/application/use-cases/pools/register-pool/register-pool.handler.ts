import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { Pool } from '../../../../domain/economy/pool.entity.js';
import { toPrizePoolDto, type PrizePoolDto } from '../../../../domain/economy/prize-pool.dto.js';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { RegisterPoolCommand } from './register-pool.command.js';

/** Admin (CLI): a pool enters the mirror. Its rules are checked like create_pool checks them; the address is unique (one PDA, one pool id). A new pool draws its
    ride seed (the one road all its riders drive); a pool registered again keeps the one it has, so rides already driven in it stay on the same road. */
@CommandHandler(RegisterPoolCommand)
export class RegisterPoolHandler implements ICommandHandler<RegisterPoolCommand, PrizePoolDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute({ pool: props }: RegisterPoolCommand): Promise<PrizePoolDto> {
    const existing = await this.pools.findById(props.id);
    const pool = Pool.register({ ...props, rideSeed: existing?.rideSeed ?? this.entropy.seed31() });
    const clash = await this.pools.findByAddress(pool.address);
    if (clash && clash.id !== pool.id) throw new ConflictError(`address ${pool.address} already belongs to pool ${clash.id}`, 'pool_exists');
    await this.pools.upsert(pool);
    return toPrizePoolDto(pool);
  }
}
