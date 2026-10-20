import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { okResponse } from '../common/response/wire.js';
import { jobCreatedResponse, editorJobsResponse, editorJobResponse, jobEventsResponse } from '../common/response/editor.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { EditorJobDto, JobEventsDto } from '../../domain/editor/editor-job.js';
import type { LogoutResultDto } from '../../application/use-cases/auth/logout/logout.command.js';
import { CreateEditorJobCommand, type JobCreatedDto } from '../../application/use-cases/editor/create-editor-job/create-editor-job.command.js';
import { CancelEditorJobCommand } from '../../application/use-cases/editor/cancel-editor-job/cancel-editor-job.command.js';
import { ListEditorJobsQuery } from '../../application/use-cases/editor/list-editor-jobs/list-editor-jobs.query.js';
import { GetEditorJobQuery } from '../../application/use-cases/editor/get-editor-job/get-editor-job.query.js';
import { GetEditorJobEventsQuery } from '../../application/use-cases/editor/get-editor-job-events/get-editor-job-events.query.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { EditorGuard } from '../../infrastructure/http/guards/editor.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import {
  createJobBodySchema, jobEventsQuerySchema, jobIdParamsSchema, jobsQuerySchema,
  type CreateJobBody, type JobEventsQuery, type JobIdParams, type JobsQuery,
} from './dto/editor.dto.js';

/** The AI model editor's chat (docs/spec/platform_services.md "jobs"): ask (202), follow a job's events by polling, cancel. Editor session only. */
@Controller('api/editor')
@UseGuards(EditorGuard)
export class EditorJobsHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('jobs') @HttpCode(202)
  @ZodResponse(jobCreatedResponse)
  create(@CurrentPlayer() editor: PlayerIdentity, @ZodBody(createJobBodySchema) body: CreateJobBody): Promise<JobCreatedDto> {
    return this.commandBus.execute<CreateEditorJobCommand, JobCreatedDto>(new CreateEditorJobCommand(editor.wallet, body.prompt, body.entityId ?? null, body.baseRevisionId, body.provider, body.model));
  }

  @Get('jobs')
  @ZodResponse(editorJobsResponse)
  list(@CurrentPlayer() editor: PlayerIdentity, @ZodQuery(jobsQuerySchema) query: JobsQuery): Promise<EditorJobDto[]> {
    return this.queryBus.execute<ListEditorJobsQuery, EditorJobDto[]>(new ListEditorJobsQuery(editor.wallet, query.entityId ?? null));
  }

  @Get('jobs/:id')
  @ZodResponse(editorJobResponse)
  job(@CurrentPlayer() editor: PlayerIdentity, @ZodParams(jobIdParamsSchema) params: JobIdParams): Promise<EditorJobDto> {
    return this.queryBus.execute<GetEditorJobQuery, EditorJobDto>(new GetEditorJobQuery(editor.wallet, params.id));
  }

  @Get('jobs/:id/events')
  @ZodResponse(jobEventsResponse)
  events(@CurrentPlayer() editor: PlayerIdentity, @ZodParams(jobIdParamsSchema) params: JobIdParams, @ZodQuery(jobEventsQuerySchema) query: JobEventsQuery): Promise<JobEventsDto> {
    return this.queryBus.execute<GetEditorJobEventsQuery, JobEventsDto>(new GetEditorJobEventsQuery(editor.wallet, params.id, query.after));
  }

  @Post('jobs/:id/cancel') @HttpCode(200)
  @ZodResponse(okResponse)
  cancel(@CurrentPlayer() editor: PlayerIdentity, @ZodParams(jobIdParamsSchema) params: JobIdParams): Promise<LogoutResultDto> {
    return this.commandBus.execute<CancelEditorJobCommand, LogoutResultDto>(new CancelEditorJobCommand(editor.wallet, params.id));
  }
}
