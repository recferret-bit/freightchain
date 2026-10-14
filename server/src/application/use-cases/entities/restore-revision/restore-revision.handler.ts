import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { RevisionDto } from '../../../../domain/entities/entity.dto.js';
import { EntityWriteService } from '../../../services/entity-write.service.js';
import { RestoreRevisionCommand } from './restore-revision.command.js';

@CommandHandler(RestoreRevisionCommand)
export class RestoreRevisionHandler implements ICommandHandler<RestoreRevisionCommand, RevisionDto> {
  constructor(private readonly write: EntityWriteService) {}

  execute({ wallet, entityId, revisionId, baseRevisionId }: RestoreRevisionCommand): Promise<RevisionDto> {
    return this.write.restore(entityId, revisionId, baseRevisionId, wallet);
  }
}
