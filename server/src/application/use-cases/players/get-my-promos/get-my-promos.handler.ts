import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { describeEffect } from '../../../../domain/economy/promo.dto.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { GetMyPromosQuery, type MyPromosDto } from './get-my-promos.query.js';

const MAX_ROWS = 100;

@QueryHandler(GetMyPromosQuery)
export class GetMyPromosHandler implements IQueryHandler<GetMyPromosQuery, MyPromosDto> {
  constructor(private readonly promos: PromoRepositoryPort) {}

  async execute({ wallet }: GetMyPromosQuery): Promise<MyPromosDto> {
    const [records, all] = await Promise.all([this.promos.listRedemptions({ wallet, limit: MAX_ROWS }), this.promos.list()]);
    const byCode = new Map(all.map((p) => [p.code, p]));
    return {
      redemptions: records.flatMap((r) => {
        const p = byCode.get(r.code);
        return p ? [{ code: r.code, label: describeEffect(p.effect), description: p.description, kind: p.effect.kind, at: r.at.getTime() }] : [];
      }),
    };
  }
}
