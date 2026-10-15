import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { MAX_NEW_ENTITIES_PER_JOB, mayWrite } from '../../../../domain/editor/editor-job.js';
import type { RevisionDto } from '../../../../domain/entities/entity.dto.js';
import { parseSource } from '../../../../domain/shared/entity.js';
import { ForbiddenError, NotFoundError } from '../../../../domain/shared/errors.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { EntityWriteService } from '../../../services/entity-write.service.js';
import { McpSaveDraftCommand } from './mcp-save-draft.command.js';

/**
 * What a job may write (`mayWrite`): the entity it was opened on or a NEW `part`; a job without an entity only NEW entities and its own; at most
 * MAX_NEW_ENTITIES_PER_JOB new ones (403 job_scope otherwise). The draft goes through EntityWriteService like
 * every write (parsed without running, validated, row lock, append-only) on the head as it is now; then the job gets a `draft` event and its result.
 */
@CommandHandler(McpSaveDraftCommand)
export class McpSaveDraftHandler implements ICommandHandler<McpSaveDraftCommand, RevisionDto> {
  constructor(
    private readonly jobs: EditorJobRepositoryPort,
    private readonly write: EntityWriteService,
    private readonly catalog: EntityCatalogService,
    private readonly clock: ClockPort,
  ) {}

  async execute({ jobId, entityId, source, message }: McpSaveDraftCommand): Promise<RevisionDto> {
    const job = await this.jobs.find(jobId);
    if (!job) throw new NotFoundError('no such job', 'job_not_found');
    const head = (await this.catalog.heads()).get(entityId);
    let kind: string | null = null;
    try { const k = (parseSource(source) as { kind?: unknown }).kind; kind = typeof k === 'string' ? k : null; } catch { /* the write service refuses it with the reasons */ }
    const created = [...new Set((await this.jobs.events(job.id, 0, 500)).filter((e) => e.type === 'draft' && e.payload['entityId'] !== job.entityId).map((e) => String(e.payload['entityId'])))];
    if (!mayWrite(job, entityId, { exists: !!head, kind, headJobId: head?.revision?.jobId ?? null }, created)) {
      throw new ForbiddenError(job.entityId ? `this request may change '${job.entityId}' (or add up to ${MAX_NEW_ENTITIES_PER_JOB} new parts), not '${entityId}'` : `this request may only create new entities (up to ${MAX_NEW_ENTITIES_PER_JOB}), not change '${entityId}'`, 'job_scope');
    }
    const rev = await this.write.saveDraft({ entityId, source, message: message || `AI: ${job.prompt.slice(0, 60)}`, baseRevisionId: head?.revision?.id ?? null, author: job.wallet, jobId: job.id });
    await this.jobs.update(job.id, { resultRevisionId: rev.id });
    await this.jobs.appendEvent(job.id, 'draft', { revisionId: rev.id, entityId: rev.entityId, seq: rev.seq }, this.clock.now());
    return rev;
  }
}
