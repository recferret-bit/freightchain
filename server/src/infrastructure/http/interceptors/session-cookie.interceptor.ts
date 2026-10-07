import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { SignInResultDto } from '../../../application/use-cases/auth/verify-signin/verify-signin.command.js';
import type { LogoutResultDto } from '../../../application/use-cases/auth/logout/logout.command.js';
import type { MeDto } from '../../../domain/players/player.dto.js';
import { EnvService } from '../../config/env.service.js';
import { SESSION_COOKIE } from '../session-cookie.js';

/** Sign-in: the handler's session token becomes the httpOnly cookie, the body is just the profile (the token never reaches page JavaScript). */
@Injectable()
export class SetSessionCookieInterceptor implements NestInterceptor<SignInResultDto, MeDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<SignInResultDto>): Observable<MeDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map(({ profile, session }) => {
        // same-origin (the server also serves the site), so SameSite=Lax is enough
        response.cookie(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: 'lax', secure: this.env.isProduction, expires: session.expiresAt, path: '/' });
        return profile;
      }),
    );
  }
}

/** Sign-out: clears the cookie, the body is the handler's result. */
@Injectable()
export class ClearSessionCookieInterceptor implements NestInterceptor<LogoutResultDto, LogoutResultDto> {
  intercept(context: ExecutionContext, next: CallHandler<LogoutResultDto>): Observable<LogoutResultDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((result) => {
        response.clearCookie(SESSION_COOKIE, { path: '/' });
        return result;
      }),
    );
  }
}
