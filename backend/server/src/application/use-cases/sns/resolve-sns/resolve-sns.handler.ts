import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { parseDomainName } from '../../../../domain/sns/sns-name.js';
import type { SnsResolutionDto } from '../../../../domain/sns/sns.dto.js';
import { NameServicePort } from '../../../ports/sns/name-service.port.js';
import { ResolveSnsQuery } from './resolve-sns.query.js';

@QueryHandler(ResolveSnsQuery)
export class ResolveSnsHandler implements IQueryHandler<ResolveSnsQuery, SnsResolutionDto> {
  constructor(private readonly nameService: NameServicePort) {}

  async execute(query: ResolveSnsQuery): Promise<SnsResolutionDto> {
    const domain = parseDomainName(query.domain);
    const wallet = await this.nameService.resolve(domain);
    return { domain, wallet };
  }
}
