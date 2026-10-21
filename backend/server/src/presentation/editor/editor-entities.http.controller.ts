import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { entityRowsResponse, entityHeadResponse, revisionsResponse, revisionResponse, editorChallengeResponse, publishedResponse } from '../common/response/editor.response.js';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { EntityHeadDto, EntityRowDto, PublishedDto, RevisionDto } from '../../domain/entities/entity.dto.js';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { ListEntitiesQuery } from '../../application/use-cases/entities/list-entities/list-entities.query.js';
import { GetEntityQuery } from '../../application/use-cases/entities/get-entity/get-entity.query.js';
import { ListRevisionsQuery } from '../../application/use-cases/entities/list-revisions/list-revisions.query.js';
import { GetRevisionQuery } from '../../application/use-cases/entities/get-revision/get-revision.query.js';
import { SaveDraftCommand } from '../../application/use-cases/entities/save-draft/save-draft.command.js';
import { RestoreRevisionCommand } from '../../application/use-cases/entities/restore-revision/restore-revision.command.js';
import { RequestPublishChallengeCommand } from '../../application/use-cases/entities/request-publish-challenge/request-publish-challenge.command.js';
import { PublishRevisionCommand } from '../../application/use-cases/entities/publish-revision/publish-revision.command.js';
import { CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { EditorGuard } from '../../infrastructure/http/guards/editor.guard.js';
import { Roles } from '../../infrastructure/http/guards/privileged.decorator.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import {
  draftBodySchema, entityIdParamsSchema, publishBodySchema, publishChallengeBodySchema, restoreBodySchema, revisionIdParamsSchema,
  type DraftBody, type EntityIdParams, type PublishBody, type PublishChallengeBody, type RestoreBody, type RevisionIdParams,
} from './dto/editor.dto.js';

/** The 3D model history (docs/spec/platform_services.md): read heads and revisions, save a draft, restore one, publish one (wallet-signed, audited). Editor session only. */
@Controller('api/editor')
@UseGuards(EditorGuard)
@Roles('editor')
export class EditorEntitiesHttpController {
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

  @Get('entities/:id/revisions')
  @ZodResponse(revisionsResponse)
  revisions(@ZodParams(entityIdParamsSchema) params: EntityIdParams): Promise<RevisionDto[]> {
    return this.queryBus.execute<ListRevisionsQuery, RevisionDto[]>(new ListRevisionsQuery(params.id));
  }

  @Get('revisions/:revId')
  @ZodResponse(revisionResponse)
  revision(@ZodParams(revisionIdParamsSchema) params: RevisionIdParams): Promise<RevisionDto> {
    return this.queryBus.execute<GetRevisionQuery, RevisionDto>(new GetRevisionQuery(params.revId));
  }

  @Post('entities/:id/drafts') @HttpCode(200)
  @ZodResponse(revisionResponse)
  draft(@CurrentPlayer() editor: PlayerIdentity, @ZodParams(entityIdParamsSchema) params: EntityIdParams, @ZodBody(draftBodySchema) body: DraftBody): Promise<RevisionDto> {
    return this.commandBus.execute<SaveDraftCommand, RevisionDto>(new SaveDraftCommand(editor.wallet, params.id, body.source, body.message, body.baseRevisionId));
  }

  @Post('entities/:id/restore') @HttpCode(200)
  @ZodResponse(revisionResponse)
  restore(@CurrentPlayer() editor: PlayerIdentity, @ZodParams(entityIdParamsSchema) params: EntityIdParams, @ZodBody(restoreBodySchema) body: RestoreBody): Promise<RevisionDto> {
    return this.commandBus.execute<RestoreRevisionCommand, RevisionDto>(new RestoreRevisionCommand(editor.wallet, params.id, body.revisionId, body.baseRevisionId));
  }

  @Post('entities/:id/publish/challenge') @HttpCode(200)
  @ZodResponse(editorChallengeResponse)
  publishChallenge(@CurrentPlayer() editor: PlayerIdentity, @ZodParams(entityIdParamsSchema) params: EntityIdParams, @ZodBody(publishChallengeBodySchema) body: PublishChallengeBody): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestPublishChallengeCommand, ChallengeDto>(new RequestPublishChallengeCommand(editor.wallet, params.id, body.revisionId));
  }

  @Post('entities/:id/publish') @HttpCode(200)
  @ZodResponse(publishedResponse)
  publish(@CurrentPlayer() editor: PlayerIdentity, @ZodParams(entityIdParamsSchema) params: EntityIdParams, @ZodBody(publishBodySchema) body: PublishBody, @CurrentRequestId() requestId: string): Promise<PublishedDto> {
    return this.commandBus.execute<PublishRevisionCommand, PublishedDto>(new PublishRevisionCommand(editor.wallet, params.id, body.revisionId, body.signature, requestId));
  }
}
