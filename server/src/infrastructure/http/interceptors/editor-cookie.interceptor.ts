import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { LogoutResultDto } from '../../../application/use-cases/auth/logout/logout.command.js';
import type { EditorSessionDto, EditorSignInResultDto } from '../../../application/use-cases/editor/verify-editor-signin/verify-editor-signin.command.js';
import { EnvService } from '../../config/env.service.js';
import { EDITOR_COOKIE, EDITOR_COOKIE_PATH, HOST_EDITOR_COOKIE, HOST_EDITOR_COOKIE_PATH } from '../session-cookie.js';

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
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<LogoutResultDto>): Observable<LogoutResultDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((result) => {
        response.clearCookie(cookieName(this.env), { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, path: cookiePath(this.env) });
        return result;
      }),
    );
  }
}
