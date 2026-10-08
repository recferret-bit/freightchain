import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toPromoDto } from '../../../../domain/economy/promo.dto.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { ListPromosQuery, type PromoListDto } from './list-promos.query.js';

/** Admin (page + CLI): every promo code with its usage, optionally only those in one state. */
@QueryHandler(ListPromosQuery)
export class ListPromosHandler implements IQueryHandler<ListPromosQuery, PromoListDto> {
  constructor(
    private readonly promos: PromoRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ state }: ListPromosQuery): Promise<PromoListDto> {
    const now = this.clock.now();
    return { promos: (await this.promos.list()).filter((p) => state === null || p.stateAt(now) === state).map((p) => toPromoDto(p, now)) };
  }
}
