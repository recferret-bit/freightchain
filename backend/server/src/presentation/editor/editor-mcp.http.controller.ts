import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { entityRowsResponse, entityHeadResponse, mcpConfigsResponse, revisionResponse } from '../common/response/editor.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { EntityHeadDto, EntityRowDto, RevisionDto } from '../../domain/entities/entity.dto.js';
import type { JobClaims } from '../../application/ports/editor/job-token.port.js';
import { ListEntitiesQuery } from '../../application/use-cases/entities/list-entities/list-entities.query.js';
import { GetEntityQuery } from '../../application/use-cases/entities/get-entity/get-entity.query.js';
import { McpConfigsQuery, type McpConfigsDto } from '../../application/use-cases/editor/mcp-configs/mcp-configs.query.js';
import { McpSaveDraftCommand } from '../../application/use-cases/editor/mcp-save-draft/mcp-save-draft.command.js';
import { CurrentJob } from '../../infrastructure/http/decorators/current-job.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { McpJobGuard } from '../../infrastructure/http/guards/mcp-job.guard.js';
import { entityIdParamsSchema, mcpDraftBodySchema, type EntityIdParams, type McpDraftBody } from './dto/editor.dto.js';

/** The entity MCP's callbacks for one running job (x-fc-job, internal network only – McpJobGuard): read the catalogue, save a draft as the job. */
@Controller('api/editor/mcp')
@UseGuards(McpJobGuard)
export class EditorMcpHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('entities')
  @ZodResponse(entityRowsResponse)
  list(): Promise<EntityRowDto[]> {
    return this.queryBus.execute<ListEntitiesQuery, EntityRowDto[]>(new ListEntitiesQuery());
  }

  @Get('entities/:id')
  @ZodResponse(entityHeadResponse)
  head(@ZodParams(entityIdParamsSchema) params: EntityIdParams): Promise<EntityHeadDto> {
    return this.queryBus.execute<GetEntityQuery, EntityHeadDto>(new GetEntityQuery(params.id));
  }

  @Get('configs')
  @ZodResponse(mcpConfigsResponse)
  configs(): Promise<McpConfigsDto> {
    return this.queryBus.execute<McpConfigsQuery, McpConfigsDto>(new McpConfigsQuery());
  }

  @Post('entities/:id/drafts') @HttpCode(200)
  @ZodResponse(revisionResponse)
  draft(@CurrentJob() job: JobClaims, @ZodParams(entityIdParamsSchema) params: EntityIdParams, @ZodBody(mcpDraftBodySchema) body: McpDraftBody): Promise<RevisionDto> {
    return this.commandBus.execute<McpSaveDraftCommand, RevisionDto>(new McpSaveDraftCommand(job.jobId, params.id, body.source, body.message));
  }
}
