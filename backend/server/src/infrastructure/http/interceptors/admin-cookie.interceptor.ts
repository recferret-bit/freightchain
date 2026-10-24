import { Injectable, Optional, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { concatMap, map, type Observable } from 'rxjs';
import type { LogoutResultDto } from '../../../application/use-cases/auth/logout/logout.command.js';
import type { AdminSessionDto, AdminSignInResultDto } from '../../../application/use-cases/admin/verify-admin-signin/verify-admin-signin.command.js';
import { AdminActionRepositoryPort } from '../../../application/ports/admin/admin-action.repository.port.js';
import { AdminTokenPort } from '../../../application/ports/admin/admin-token.port.js';
import { CachePort } from '../../../application/ports/shared/cache.port.js';
import { ClockPort } from '../../../application/ports/shared/clock.port.js';
import { EnvService } from '../../config/env.service.js';
import { ADMIN_COOKIE, ADMIN_COOKIE_PATH, readCookie } from '../session-cookie.js';
import type { RequestWithPlayer } from '../types/http-request.js';

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
  constructor(
    private readonly env: EnvService,
    @Optional() private readonly tokens?: AdminTokenPort,
    @Optional() private readonly cache?: CachePort,
    @Optional() private readonly clock?: ClockPort,
    @Optional() private readonly audit?: AdminActionRepositoryPort,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<LogoutResultDto>): Observable<LogoutResultDto> {
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    return next.handle().pipe(
      concatMap(async (result) => {
        await this.revoke(request);
        response.clearCookie(ADMIN_COOKIE, { httpOnly: true, sameSite: 'strict', secure: this.env.isProduction, path: ADMIN_COOKIE_PATH });   // the attributes it was set with (M3)
        return result;
      }),
    );
  }

  private async revoke(request: RequestWithPlayer): Promise<void> {
    if (!this.tokens || !this.cache || !this.clock) return;
    const token = readCookie(request.headers.cookie, ADMIN_COOKIE);
    if (!token) return;
    const claims = await this.tokens.verifyClaims(token);
    if (!claims) return;
    const now = this.clock.now();
    const left = claims.exp - Math.floor(now.getTime() / 1000);
    if (left > 0) await this.cache.set(`revoked:jti:${claims.jti}`, 1, left);
    if (this.audit) {
      await this.audit.insert({
        wallet: claims.wallet, action: 'auth.logout', target: claims.wallet, role: 'admin', requestId: null, at: now,
        beforeState: { session: 'open' }, afterState: { session: 'revoked' }, detail: {},
      });
    }
  }
}
