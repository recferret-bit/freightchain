import { Injectable, Optional, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { concatMap, map, type Observable } from 'rxjs';
import type { LogoutResultDto } from '../../../application/use-cases/auth/logout/logout.command.js';
import type { EditorSessionDto, EditorSignInResultDto } from '../../../application/use-cases/editor/verify-editor-signin/verify-editor-signin.command.js';
import { EditorTokenPort } from '../../../application/ports/editor/editor-token.port.js';
import { CachePort } from '../../../application/ports/shared/cache.port.js';
import { ClockPort } from '../../../application/ports/shared/clock.port.js';
import { EnvService } from '../../config/env.service.js';
import { EDITOR_COOKIE, EDITOR_COOKIE_PATH, HOST_EDITOR_COOKIE, HOST_EDITOR_COOKIE_PATH, cookieValues } from '../session-cookie.js';
import type { RequestWithPlayer } from '../types/http-request.js';

const cookieName = (env: EnvService): string => env.editorCookie ?? (env.isProduction ? HOST_EDITOR_COOKIE : EDITOR_COOKIE);
const cookiePath = (env: EnvService): string => env.editorCookiePath ?? (env.isProduction ? HOST_EDITOR_COOKIE_PATH : EDITOR_COOKIE_PATH);

/** Editor sign-in: the token becomes the editor cookie – httpOnly, no Domain, SameSite=Strict. Production uses `__Host-fc_editor` (Path=/, Secure). */
@Injectable()
export class SetEditorCookieInterceptor implements NestInterceptor<EditorSignInResultDto, EditorSessionDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<EditorSignInResultDto>): Observable<EditorSessionDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map(({ editor, session }) => {
        response.cookie(cookieName(this.env), session.token, { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, expires: session.expiresAt, path: cookiePath(this.env) });
        return editor;
      }),
    );
  }
}

/** Editor sign-out: clears the cookie with the attributes it was set with. */
@Injectable()
export class ClearEditorCookieInterceptor implements NestInterceptor<LogoutResultDto, LogoutResultDto> {
  constructor(
    private readonly env: EnvService,
    @Optional() private readonly tokens?: EditorTokenPort,
    @Optional() private readonly cache?: CachePort,
    @Optional() private readonly clock?: ClockPort,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<LogoutResultDto>): Observable<LogoutResultDto> {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    return next.handle().pipe(
      concatMap(async (result) => {
        await this.revoke(request);
        response.clearCookie(cookieName(this.env), { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, path: cookiePath(this.env) });
        return result;
      }),
    );
  }

  private async revoke(request: RequestWithPlayer): Promise<void> {
    if (!this.tokens || !this.cache || !this.clock) return;
    for (const token of cookieValues(request.headers.cookie, cookieName(this.env))) {
      const claims = await this.tokens.verifyClaims(token);
      if (!claims) continue;
      const left = claims.exp - Math.floor(this.clock.now().getTime() / 1000);
      if (left > 0) await this.cache.set(`revoked:jti:${claims.jti}`, 1, left);
      return;
    }
  }
}
