import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { PromoCode } from '../../../../domain/economy/promo-code.entity.js';
import { toPromoDto, type PromoDto } from '../../../../domain/economy/promo.dto.js';
import { BadRequestError, ConflictError } from '../../../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { CreatePromoCommand } from './create-promo.command.js';

/** Admin (CLI): a new promo code. A pinned pool must exist and be of the code's tier – the entity cannot check that, it has no pool. */
@CommandHandler(CreatePromoCommand)
export class CreatePromoHandler implements ICommandHandler<CreatePromoCommand, PromoDto> {
  constructor(
    private readonly promos: PromoRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ input }: CreatePromoCommand): Promise<PromoDto> {
    const promo = PromoCode.create({ ...input, now: this.clock.now() });
    if (input.poolId !== null) {
      const pool = await this.pools.findById(input.poolId);
      if (!pool) throw new BadRequestError(`no pool ${input.poolId}`, 'bad_promo_code');
      if (pool.tier !== input.tier) throw new BadRequestError(`pool ${input.poolId} is a ${pool.tier} pool, not ${input.tier}`, 'bad_promo_code');
    }
    if (!(await this.promos.insert(promo))) throw new ConflictError(`promo code ${promo.code} already exists`, 'promo_exists');
    return toPromoDto(promo);
  }
}
