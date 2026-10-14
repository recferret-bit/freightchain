import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { EntityRowDto } from '../../../../domain/entities/entity.dto.js';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { ListEntitiesQuery } from './list-entities.query.js';

@QueryHandler(ListEntitiesQuery)
export class ListEntitiesHandler implements IQueryHandler<ListEntitiesQuery, EntityRowDto[]> {
  constructor(private readonly catalog: EntityCatalogService) {}

  execute(_query: ListEntitiesQuery): Promise<EntityRowDto[]> {
    return this.catalog.rows();
  }
}
