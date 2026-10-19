import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { SignInResultDto } from '../../../application/use-cases/auth/verify-signin/verify-signin.command.js';
import type { LogoutResultDto } from '../../../application/use-cases/auth/logout/logout.command.js';
import type { MeDto } from '../../../domain/players/player.dto.js';
import { EnvService } from '../../config/env.service.js';
import { SESSION_COOKIE } from '../session-cookie.js';
import type { CookieOptions } from 'express';

/** The browser drops a cookie whose Domain is not this host. `freightchain.localhost` is shared across that name; `localhost:5173` is not. */
function sharesCookieDomain(host: string | undefined, domain: string): boolean {
  if (!host) return true;
  const name = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  const apex = domain.toLowerCase();
  return name === apex || name.endsWith(`.${apex}`);
}

/** One set of options for setting AND clearing the session cookie (audit M3: a clear that differs – no Secure – is ignored by the browser). In production
    the cookie is host-only (`__Host-`: no Domain); outside it COOKIE_DOMAIN may still share it with the sibling hosts of a test deployment.
    `host` is the request hostname. A local page that is not that domain (Vite on localhost) gets a host-only cookie, or the browser throws it away. */
export function sessionCookieOptions(env: EnvService, host?: string): CookieOptions {
  const share = !env.isProduction && !!env.cookieDomain && sharesCookieDomain(host, env.cookieDomain);
  return { httpOnly: true, sameSite: 'lax', secure: env.isProduction, path: '/', ...(share ? { domain: env.cookieDomain } : {}) };
}

/** Sign-in: the handler's session token becomes the httpOnly cookie, the body is just the profile (the token never reaches page JavaScript). */
@Injectable()
export class SetSessionCookieInterceptor implements NestInterceptor<SignInResultDto, MeDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<SignInResultDto>): Observable<MeDto> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const host = http.getRequest?.<{ hostname?: string }>()?.hostname;
    return next.handle().pipe(
      map(({ profile, session }) => {
        // production: host-only on the API host (__Host-, audit H7-B) – the landing, the lobby and the game all call the API there (hosts.js API_BASE)
        response.cookie(this.env.sessionCookie, session.token, { ...sessionCookieOptions(this.env, host), expires: session.expiresAt });
        return profile;
      }),
    );
  }
}

/** Sign-out: clears the cookie, the body is the handler's result. */
@Injectable()
export class ClearSessionCookieInterceptor implements NestInterceptor<LogoutResultDto, LogoutResultDto> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<LogoutResultDto>): Observable<LogoutResultDto> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const host = http.getRequest?.<{ hostname?: string }>()?.hostname;
    return next.handle().pipe(
      map((result) => {
        response.clearCookie(this.env.sessionCookie, sessionCookieOptions(this.env, host));   // the same attributes it was set with, or the browser keeps it (M3)
        if (this.env.isProduction && this.env.cookieDomain) response.clearCookie(SESSION_COOKIE, legacyCookieOptions(this.env.cookieDomain));   // the apex-wide cookie of before H7-B
        return result;
      }),
    );
  }
}

/** the apex-wide `fc_session` every browser held before H7-B: cleared with the attributes it was set with */
export const legacyCookieOptions = (domain: string): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure: true, path: '/', domain });
