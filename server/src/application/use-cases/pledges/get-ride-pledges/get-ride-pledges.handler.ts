import { Injectable } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { GetRidePledgesQuery } from './get-ride-pledges.query.js';
import { toPledgeDto, type PledgeDto } from '../../../../domain/economy/pledge.dto.js';
import { PledgeRepositoryPort } from '../../../ports/economy/pledge.repository.port.js';

@Injectable()
@QueryHandler(GetRidePledgesQuery)
export class GetRidePledgesHandler implements IQueryHandler<GetRidePledgesQuery, PledgeDto[]> {
  constructor(private readonly pledges: PledgeRepositoryPort) {}

  async execute(q: GetRidePledgesQuery): Promise<PledgeDto[]> {
    const list = await this.pledges.findByRideId(q.rideId);
    return list.map(toPledgeDto);
  }
}
