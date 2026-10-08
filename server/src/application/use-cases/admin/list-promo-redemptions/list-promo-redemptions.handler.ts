import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { PromoCode } from '../../../../domain/economy/promo-code.entity.js';
import { describeEffect } from '../../../../domain/economy/promo.dto.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { ListPromoRedemptionsQuery, type PromoRedemptionListDto } from './list-promo-redemptions.query.js';

@QueryHandler(ListPromoRedemptionsQuery)
export class ListPromoRedemptionsHandler implements IQueryHandler<ListPromoRedemptionsQuery, PromoRedemptionListDto> {
  constructor(private readonly promos: PromoRepositoryPort) {}

  async execute({ limit, code, wallet }: ListPromoRedemptionsQuery): Promise<PromoRedemptionListDto> {
    const [records, promos] = await Promise.all([
      this.promos.listRedemptions({ ...(code ? { code: PromoCode.normalize(code) } : {}), ...(wallet ? { wallet } : {}), limit }),
      this.promos.list(),
    ]);
    const label = new Map(promos.map((p) => [p.code, describeEffect(p.effect)]));
    return { rows: records.map((r) => ({ code: r.code, wallet: r.wallet, n: r.n, at: r.at.getTime(), label: label.get(r.code) ?? '' })) };
  }
}
