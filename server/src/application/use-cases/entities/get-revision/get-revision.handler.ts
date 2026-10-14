import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { revisionDto, type RevisionDto } from '../../../../domain/entities/entity.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { EntityRepositoryPort } from '../../../ports/entities/entity.repository.port.js';
import { GetRevisionQuery } from './get-revision.query.js';

@QueryHandler(GetRevisionQuery)
export class GetRevisionHandler implements IQueryHandler<GetRevisionQuery, RevisionDto> {
  constructor(private readonly entities: EntityRepositoryPort) {}

  async execute({ revisionId }: GetRevisionQuery): Promise<RevisionDto> {
    const r = await this.entities.revision(revisionId);
    if (!r) throw new NotFoundError('no such revision', 'revision_not_found');
    const row = await this.entities.find(r.entityId);
    const prompt = r.jobId ? (await this.entities.revisions(r.entityId)).find((x) => x.id === r.id)?.prompt ?? null : null;
    return revisionDto(r, row, prompt, true);
  }
}
