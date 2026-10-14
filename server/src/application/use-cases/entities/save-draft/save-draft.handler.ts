import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { RevisionDto } from '../../../../domain/entities/entity.dto.js';
import { EntityWriteService } from '../../../services/entity-write.service.js';
import { SaveDraftCommand } from './save-draft.command.js';

@CommandHandler(SaveDraftCommand)
export class SaveDraftHandler implements ICommandHandler<SaveDraftCommand, RevisionDto> {
  constructor(private readonly write: EntityWriteService) {}

  execute({ wallet, entityId, source, message, baseRevisionId }: SaveDraftCommand): Promise<RevisionDto> {
    return this.write.saveDraft({ entityId, source, message, baseRevisionId, author: wallet });
  }
}
