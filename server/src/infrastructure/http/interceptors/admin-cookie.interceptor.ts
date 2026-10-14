import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { LogoutResultDto } from '../../../application/use-cases/auth/logout/logout.command.js';
import type { AdminSessionDto, AdminSignInResultDto } from '../../../application/use-cases/admin/verify-admin-signin/verify-admin-signin.command.js';
import { EnvService } from '../../config/env.service.js';
import { ADMIN_COOKIE, ADMIN_COOKIE_PATH } from '../session-cookie.js';

/**
 * Admin sign-in: the admin token becomes the fc_admin cookie – httpOnly, no Domain (only admin.<apex> ever gets it, unlike the player session shared by
 * every subdomain), Path /api/admin (no page request carries it), SameSite=Strict (no cross-site request carries it), expiring with the token.
 */
@Injectable()
export class SetAdminCookieInterceptor implements NestInterceptor<AdminSignInResultDto, AdminSessionDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<AdminSignInResultDto>): Observable<AdminSessionDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map(({ admin, session }) => {
        response.cookie(ADMIN_COOKIE, session.token, { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, expires: session.expiresAt, path: ADMIN_COOKIE_PATH });
        return admin;
      }),
    );
  }
}

/** Admin sign-out: clears the cookie (same path, or the browser keeps it). */
@Injectable()
export class ClearAdminCookieInterceptor implements NestInterceptor<LogoutResultDto, LogoutResultDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<LogoutResultDto>): Observable<LogoutResultDto> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((result) => {
        response.clearCookie(ADMIN_COOKIE, { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, path: ADMIN_COOKIE_PATH });   // the attributes it was set with (M3)
        return result;
      }),
    );
  }
}
