import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { toPromoDto } from '../../../../domain/economy/promo.dto.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { ListPromosQuery, type PromoListDto } from './list-promos.query.js';

/** Admin (CLI): every promo code with its usage. */
@QueryHandler(ListPromosQuery)
export class ListPromosHandler implements IQueryHandler<ListPromosQuery, PromoListDto> {
  constructor(private readonly promos: PromoRepositoryPort) {}

  async execute(): Promise<PromoListDto> {
    return { promos: (await this.promos.list()).map(toPromoDto) };
  }
}
