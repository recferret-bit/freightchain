import { Injectable } from '@nestjs/common';
import { PromoCode } from '../../domain/economy/promo-code.entity.js';
import type { PromoCreateInput } from '../../domain/economy/promo.types.js';
import { BadRequestError, ConflictError } from '../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../ports/economy/promo.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** Creates a promo code for the admin CLI and the admin page alike: the entity validates the shape, a pinned pool must exist and be of the code's tier (the entity has no pool to ask). */
@Injectable()
export class PromoCreationService {
  constructor(
    private readonly promos: PromoRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async create(input: PromoCreateInput, tx?: TransactionHandle): Promise<PromoCode> {
    const promo = PromoCode.create({ ...input, now: this.clock.now() });
    const e = promo.effect;
    if (e.kind === 'tickets' && e.poolId !== null) {
      const pool = await this.pools.findById(e.poolId, tx);
      if (!pool) throw new BadRequestError(`no pool ${e.poolId}`, 'bad_promo_code');
      if (pool.tier !== e.tier) throw new BadRequestError(`pool ${e.poolId} is a ${pool.tier} pool, not ${e.tier}`, 'bad_promo_code');
    }
    if (!(await this.promos.insert(promo, tx))) throw new ConflictError(`promo code ${promo.code} already exists`, 'promo_exists');
    return promo;
  }
}
