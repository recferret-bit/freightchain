import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { MAX_NEW_ENTITIES_PER_JOB, mayWrite } from '../../../../domain/editor/editor-job.js';
import type { RevisionDto } from '../../../../domain/entities/entity.dto.js';
import { parseSource } from '../../../../domain/shared/entity.js';
import { ForbiddenError, NotFoundError } from '../../../../domain/shared/errors.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { EntityWriteService } from '../../../services/entity-write.service.js';
import { McpSaveDraftCommand } from './mcp-save-draft.command.js';

/**
 * What a job may write (`mayWrite`): the entity it was opened on or a NEW `part`; a job without an entity only NEW entities and its own; at most
 * MAX_NEW_ENTITIES_PER_JOB new ones (403 job_scope otherwise). The count of new ids is taken under the job row lock, in the same transaction as the
 * draft and its event (lock order: job, then the entity row), so a second save cannot slip past the cap. The draft goes through EntityWriteService.
 */
@CommandHandler(McpSaveDraftCommand)
export class McpSaveDraftHandler implements ICommandHandler<McpSaveDraftCommand, RevisionDto> {
  constructor(
    private readonly jobs: EditorJobRepositoryPort,
    private readonly write: EntityWriteService,
    private readonly catalog: EntityCatalogService,
    private readonly clock: ClockPort,
    private readonly transactions: TransactionPort,
  ) {}

  async execute({ jobId, entityId, source, message }: McpSaveDraftCommand): Promise<RevisionDto> {
    let kind: string | null = null;
    try { const k = (parseSource(source) as { kind?: unknown }).kind; kind = typeof k === 'string' ? k : null; } catch { /* the write service refuses it with the reasons */ }
    return this.transactions.run(async (tx) => {
      await this.jobs.lock(jobId, tx);
      const job = await this.jobs.find(jobId, tx);
      if (!job) throw new NotFoundError('no such job', 'job_not_found');
      if (job.status !== 'running') throw new ForbiddenError('this job is no longer running', 'job_closed');
      const head = (await this.catalog.heads()).get(entityId);
      const created = (await this.jobs.createdIds(job.id, tx)).filter((id) => id !== job.entityId);
      if (!mayWrite(job, entityId, { exists: !!head, kind, headJobId: head?.revision?.jobId ?? null }, created)) {
        throw new ForbiddenError(job.entityId ? `this request may change '${job.entityId}' (or add up to ${MAX_NEW_ENTITIES_PER_JOB} new parts), not '${entityId}'` : `this request may only create new entities (up to ${MAX_NEW_ENTITIES_PER_JOB}), not change '${entityId}'`, 'job_scope');
      }
      const rev = await this.write.saveDraft({ entityId, source, message: message || `AI: ${job.prompt.slice(0, 60)}`, baseRevisionId: head?.revision?.id ?? null, author: job.wallet, jobId: job.id }, tx);
      await this.jobs.update(job.id, { resultRevisionId: rev.id }, undefined, tx);
      await this.jobs.appendEvent(job.id, 'draft', { revisionId: rev.id, entityId: rev.entityId, seq: rev.seq }, this.clock.now(), tx);
      return rev;
    });
  }
}
