import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { ClientInfo } from '../../domain/auth/sign-in.js';
import { LogoutCommand, type LogoutResultDto } from '../../application/use-cases/auth/logout/logout.command.js';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { RequestEditorChallengeCommand } from '../../application/use-cases/editor/request-editor-challenge/request-editor-challenge.command.js';
import { VerifyEditorSignInCommand, type EditorSignInResultDto } from '../../application/use-cases/editor/verify-editor-signin/verify-editor-signin.command.js';
import { GetEditorMeQuery, type EditorMeDto } from '../../application/use-cases/editor/get-editor-me/get-editor-me.query.js';
import { CurrentClient, CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { EditorGuard, EditorPublic } from '../../infrastructure/http/guards/editor.guard.js';
import { ClearEditorCookieInterceptor, SetEditorCookieInterceptor } from '../../infrastructure/http/interceptors/editor-cookie.interceptor.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { requestChallengeBodySchema, verifyBodySchema, type RequestChallengeBody, type VerifyBody } from '../auth/dto/auth.dto.js';

/** The 3D model editor's sign-in (storybook.<apex>): a wallet in EDITOR_WALLETS signs a message → the fc_editor cookie. To anybody else every route is a 404. */
@Controller('api/editor')
@UseGuards(EditorGuard)
export class EditorAuthHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('auth/nonce') @HttpCode(200) @EditorPublic()
  nonce(@ZodBody(requestChallengeBodySchema) body: RequestChallengeBody): Promise<ChallengeDto> {
    return this.commandBus.execute<RequestEditorChallengeCommand, ChallengeDto>(new RequestEditorChallengeCommand(body.wallet ?? null));
  }

  @Post('auth/verify') @HttpCode(200) @EditorPublic() @UseInterceptors(SetEditorCookieInterceptor)
  verify(@ZodBody(verifyBodySchema) body: VerifyBody, @CurrentClient() client: ClientInfo, @CurrentRequestId() requestId: string): Promise<EditorSignInResultDto> {
    return this.commandBus.execute<VerifyEditorSignInCommand, EditorSignInResultDto>(new VerifyEditorSignInCommand(body.wallet, body.signature, client, requestId, body.message ?? null, body.nonce ?? null));
  }

  @Post('auth/logout') @HttpCode(200) @EditorPublic() @UseInterceptors(ClearEditorCookieInterceptor)
  logout(): Promise<LogoutResultDto> {
    return this.commandBus.execute<LogoutCommand, LogoutResultDto>(new LogoutCommand());
  }

  @Get('me')
  me(@CurrentPlayer() editor: PlayerIdentity): Promise<EditorMeDto> {
    return this.queryBus.execute<GetEditorMeQuery, EditorMeDto>(new GetEditorMeQuery(editor.wallet));
  }
}
