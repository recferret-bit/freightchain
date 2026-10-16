import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { McpConfigsQuery, type McpConfigsDto } from './mcp-configs.query.js';

@QueryHandler(McpConfigsQuery)
export class McpConfigsHandler implements IQueryHandler<McpConfigsQuery, McpConfigsDto> {
  constructor(private readonly catalog: EntityCatalogService) {}

  async execute(_query: McpConfigsQuery): Promise<McpConfigsDto> {
    return Object.fromEntries([...(await this.catalog.heads())].map(([id, h]) => [id, h.config]));
  }
}
