import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { chooseProvider } from '../../../../domain/editor/llm-providers.js';
import { BadRequestError, ConflictError, ServiceUnavailableError, TooManyRequestsError, UnprocessableEntityError } from '../../../../domain/shared/errors.js';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { LlmProviderPort } from '../../../ports/editor/llm-provider.port.js';
import { McpClientPort } from '../../../ports/editor/mcp-client.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { EditorJobRunnerService } from '../../../services/editor-job-runner.service.js';
import { EntityCatalogService } from '../../../services/entity-catalog.service.js';
import { GameSettingsService } from '../../../services/game-settings.service.js';
import { CreateEditorJobCommand, type JobCreatedDto } from './create-editor-job.command.js';

/**
 * The bridge's gate, in order (the guard and the Zod body ran before): the AI editor is on and the provider / model is offered → the entity and its base
 * (a base that is not the head is a 409 stale_base) → the wallet's daily cap (`editor_jobs_per_day`, 429) → one open job per wallet and per entity (409
 * job_running – also two requests at once, `admitting`) → the 3d-assets skill's spec gate on the words (the MCP's /spec: an impossible car / tree / building is a 422 spec_invalid with the
 * validator's errors, and NO model is called, no job is stored) → a queued job for the runner (202).
 */
@CommandHandler(CreateEditorJobCommand)
export class CreateEditorJobHandler implements ICommandHandler<CreateEditorJobCommand, JobCreatedDto> {
  /** wallets / entities between the job_running check and their job row: two requests at once must not both pass (the runner lives in this one app process) */
  private readonly admitting = new Set<string>();

  constructor(
    private readonly jobs: EditorJobRepositoryPort,
    private readonly runner: EditorJobRunnerService,
    private readonly llm: LlmProviderPort,
    private readonly mcp: McpClientPort,
    private readonly catalog: EntityCatalogService,
    private readonly settings: GameSettingsService,
    private readonly entropy: EntropyPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(c: CreateEditorJobCommand): Promise<JobCreatedDto> {
    if (!this.mcp.configured) throw new ServiceUnavailableError('the AI editor is off on this server (no EDITOR_MCP_TOKEN)');
    const pick = chooseProvider(this.llm.enabled(), this.llm.preferred(), c.provider, c.model);
    if ('error' in pick) throw new BadRequestError(pick.error, 'bad_provider');
    if (c.entityId && c.baseRevisionId !== undefined) {
      const head = (await this.catalog.heads()).get(c.entityId)?.revision?.id ?? null;
      if (c.baseRevisionId !== head) throw new ConflictError('the model changed since you opened it – reload it and ask again', 'stale_base');
    }
    const now = this.clock.now(), knobs = await this.settings.current();
    const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
    if ((await this.jobs.countSince(c.wallet, dayStart)) >= knobs.editorJobsPerDay) throw new TooManyRequestsError(`the daily limit of ${knobs.editorJobsPerDay} AI requests is used up`, 'job_cap', (dayStart.getTime() + DAY_MS - now.getTime()) / 1000);
    const keys = [`w:${c.wallet}`, ...(c.entityId ? [`e:${c.entityId}`] : [])];
    if (keys.some((k) => this.admitting.has(k))) throw new ConflictError('a request is already running for you or for this model – wait for it or cancel it', 'job_running');
    for (const k of keys) this.admitting.add(k);   // synchronous with the check above: no await between them
    try {
      const open = await this.jobs.open();
      if (open.some((j) => j.wallet === c.wallet || (c.entityId && j.entityId === c.entityId))) throw new ConflictError('a request is already running for you or for this model – wait for it or cancel it', 'job_running');
      const spec = await this.mcp.spec(c.prompt);
      if (spec.verdict === 'rejected') throw new UnprocessableEntityError('the request describes something the game cannot build', 'spec_invalid', spec.errors);
      const job = {
        id: this.entropy.uuid(), wallet: c.wallet, prompt: c.prompt, provider: pick.info.id, model: pick.model, entityId: c.entityId, baseRevisionId: c.baseRevisionId ?? null,
        resultRevisionId: null, status: 'queued' as const, error: null, tokensIn: 0, tokensOut: 0, createdAt: now, startedAt: null, finishedAt: null,
      };
      await this.jobs.insert(job);
      await this.jobs.appendEvent(job.id, 'status', { status: 'queued', provider: job.provider, model: job.model }, now);
      this.runner.enqueue(job);
      return { jobId: job.id };
    } finally {
      for (const k of keys) this.admitting.delete(k);   // the job row (queued) now answers the open() check
    }
  }
}
