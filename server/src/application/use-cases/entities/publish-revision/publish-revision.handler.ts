import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { PublishedDto } from '../../../../domain/entities/entity.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { EntityRepositoryPort } from '../../../ports/entities/entity.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { PublishRevisionCommand } from './publish-revision.command.js';

/**
 * The only thing that changes what players draw. The wallet must still be in EDITOR_WALLETS and must have signed the text naming exactly this entity and
 * revision (AdminProofService, surface 'editor'), and the published set must stay buildable (`assertPublishable`); the pointer moves under the entity row lock together with the audit row (`entity.publish`, the signed
 * text kept), then this process's bundle is rebuilt (other processes see it within BUNDLE_RECHECK_MS).
 */
@CommandHandler(PublishRevisionCommand)
export class PublishRevisionHandler implements ICommandHandler<PublishRevisionCommand, PublishedDto> {
  constructor(
    private readonly entities: EntityRepositoryPort,
    private readonly catalog: EntityCatalogService,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, entityId, revisionId, signature, requestId }: PublishRevisionCommand): Promise<PublishedDto> {
    if (!this.rules.get().editorWallets.has(wallet)) throw new NotFoundError('not found');
    const r = await this.entities.revision(revisionId);
    if (!r || r.entityId !== entityId) throw new NotFoundError('no such revision of this entity', 'revision_not_found');
    await this.catalog.assertPublishable(r.config);
    const proof = await this.proofs.prove(wallet, { action: 'entity_publish', entityId, revisionId, seq: r.seq }, signature, 'editor');
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      const row = await this.entities.lock(entityId, tx);
      if (!row) throw new NotFoundError('no such entity', 'entity_not_found');
      await this.entities.setPointers(entityId, { publishedRevisionId: revisionId }, now, tx);
      await this.audit.insert({ wallet, action: 'entity.publish', target: entityId, detail: { revisionId, seq: r.seq, hash: r.hash, previous: row.publishedRevisionId, signed: proof }, requestId, at: now }, tx);
    });
    this.catalog.invalidate();
    return { rev: (await this.catalog.bundle()).rev };
  }
}
