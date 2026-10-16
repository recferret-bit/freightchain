import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { revisionDto, type RevisionDto } from '../../../../domain/entities/entity.dto.js';
import { EntityRepositoryPort } from '../../../ports/entities/entity.repository.port.js';
import { ListRevisionsQuery } from './list-revisions.query.js';

/** An entity never edited has no history yet ([]): its seed becomes revision #1 on the first save. */
@QueryHandler(ListRevisionsQuery)
export class ListRevisionsHandler implements IQueryHandler<ListRevisionsQuery, RevisionDto[]> {
  constructor(private readonly entities: EntityRepositoryPort) {}

  async execute({ entityId }: ListRevisionsQuery): Promise<RevisionDto[]> {
    const row = await this.entities.find(entityId);
    if (!row) return [];
    return (await this.entities.revisions(entityId)).map((r) => revisionDto(r, row));
  }
}
