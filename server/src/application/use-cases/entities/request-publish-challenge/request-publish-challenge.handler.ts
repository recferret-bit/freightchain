import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { EntityRepositoryPort } from '../../../ports/entities/entity.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import type { ChallengeDto } from '../../auth/request-challenge/request-challenge.command.js';
import { RequestPublishChallengeCommand } from './request-publish-challenge.command.js';

@CommandHandler(RequestPublishChallengeCommand)
export class RequestPublishChallengeHandler implements ICommandHandler<RequestPublishChallengeCommand, ChallengeDto> {
  constructor(
    private readonly entities: EntityRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute({ wallet, entityId, revisionId }: RequestPublishChallengeCommand): Promise<ChallengeDto> {
    if (!this.rules.get().editorWallets.has(wallet)) throw new NotFoundError('not found');
    const r = await this.entities.revision(revisionId);
    if (!r || r.entityId !== entityId) throw new NotFoundError('no such revision of this entity', 'revision_not_found');
    return { message: await this.proofs.issue(wallet, { action: 'entity_publish', entityId, revisionId, seq: r.seq }, 'editor') };
  }
}
