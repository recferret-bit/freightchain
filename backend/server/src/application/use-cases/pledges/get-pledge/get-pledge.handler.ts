import { Injectable } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { GetPledgeQuery } from './get-pledge.query.js';
import { toPledgeDto, type PledgeDto } from '../../../../domain/economy/pledge.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { PledgeRepositoryPort } from '../../../ports/economy/pledge.repository.port.js';

@Injectable()
@QueryHandler(GetPledgeQuery)
export class GetPledgeHandler implements IQueryHandler<GetPledgeQuery, PledgeDto> {
  constructor(private readonly pledges: PledgeRepositoryPort) {}

  async execute(q: GetPledgeQuery): Promise<PledgeDto> {
    const pledge = (await this.pledges.findById(q.id)) ?? (await this.pledges.findByPdaAddress(q.id));
    if (!pledge) throw new NotFoundError('pledge not found');
    return toPledgeDto(pledge);
  }
}
