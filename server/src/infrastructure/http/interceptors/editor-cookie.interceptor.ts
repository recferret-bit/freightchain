import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { LogoutResultDto } from '../../../application/use-cases/auth/logout/logout.command.js';
import type { EditorSessionDto, EditorSignInResultDto } from '../../../application/use-cases/editor/verify-editor-signin/verify-editor-signin.command.js';
import { EnvService } from '../../config/env.service.js';
import { EDITOR_COOKIE, EDITOR_COOKIE_PATH } from '../session-cookie.js';

/** Editor sign-in: the editor token becomes the fc_editor cookie – httpOnly, no Domain (storybook.<apex> only), Path /api/editor, SameSite=Strict, expiring with the token. */
@Injectable()
export class SetEditorCookieInterceptor implements NestInterceptor<EditorSignInResultDto, EditorSessionDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<EditorSignInResultDto>): Observable<EditorSessionDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map(({ editor, session }) => {
        response.cookie(EDITOR_COOKIE, session.token, { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, expires: session.expiresAt, path: EDITOR_COOKIE_PATH });
        return editor;
      }),
    );
  }
}

/** Editor sign-out: clears the cookie with the attributes it was set with. */
@Injectable()
export class ClearEditorCookieInterceptor implements NestInterceptor<LogoutResultDto, LogoutResultDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<LogoutResultDto>): Observable<LogoutResultDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((result) => {
        response.clearCookie(EDITOR_COOKIE, { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, path: EDITOR_COOKIE_PATH });
        return result;
      }),
    );
  }
}
