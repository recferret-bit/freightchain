import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { EntityBundleDto } from '../../../../domain/entities/entity.dto.js';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { GetEntityBundleQuery } from './get-entity-bundle.query.js';

/** Served from memory (EntityCatalogService): the game's boot never waits on the database. */
@QueryHandler(GetEntityBundleQuery)
export class GetEntityBundleHandler implements IQueryHandler<GetEntityBundleQuery, EntityBundleDto> {
  constructor(private readonly catalog: EntityCatalogService) {}

  execute(_query: GetEntityBundleQuery): Promise<EntityBundleDto> {
    return this.catalog.bundle();
  }
}
