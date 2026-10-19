import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { EntityHeadDto } from '../../../../domain/entities/entity.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { GetEntityQuery } from './get-entity.query.js';

@QueryHandler(GetEntityQuery)
export class GetEntityHandler implements IQueryHandler<GetEntityQuery, EntityHeadDto> {
  constructor(private readonly catalog: EntityCatalogService) {}

  async execute({ id }: GetEntityQuery): Promise<EntityHeadDto> {
    const head = (await this.catalog.heads()).get(id);
    const row = (await this.catalog.rows()).find((r) => r.id === id);
    if (!head || !row) throw new NotFoundError('no such entity', 'entity_not_found');
    return { row, source: head.source, config: head.config };
  }
}
