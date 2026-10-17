import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { OpenPhonePairDto, PollPhonePairDto } from '../../../application/use-cases/auth/phone-pair/phone-pair.command.js';
import { ClockPort } from '../../../application/ports/shared/clock.port.js';
import { EnvService } from '../../config/env.service.js';
import { pairCookieName } from '../session-cookie.js';
import { sessionCookieOptions } from './session-cookie.interceptor.js';

const DAY_MS = 86_400_000;

/** The pairing secret becomes the httpOnly cookie. The page only receives the code that goes in the QR. */
@Injectable()
export class SetPairCookieInterceptor implements NestInterceptor<OpenPhonePairDto, { id: string; expiresAt: string }> {
  constructor(private readonly env: EnvService) {}

  intercept(context: ExecutionContext, next: CallHandler<OpenPhonePairDto>): Observable<{ id: string; expiresAt: string }> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const host = http.getRequest?.<{ hostname?: string }>()?.hostname;
    return next.handle().pipe(map(({ id, expiresAt, secret }) => {
      response.cookie(pairCookieName(this.env.isProduction), secret, { ...sessionCookieOptions(this.env, host), maxAge: 180_000 });
      return { id, expiresAt };
    }));
  }
}

/** A ready poll's session token becomes the player session cookie. Pending polls set nothing. */
@Injectable()
export class AdoptPairSessionInterceptor implements NestInterceptor<PollPhonePairDto, { status: string; wallet?: string }> {
  constructor(private readonly env: EnvService, private readonly clock: ClockPort) {}

  intercept(context: ExecutionContext, next: CallHandler<PollPhonePairDto>): Observable<{ status: string; wallet?: string }> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const host = http.getRequest?.<{ hostname?: string }>()?.hostname;
    return next.handle().pipe(map(({ status, wallet, token }) => {
      if (token) response.cookie(this.env.sessionCookie, token, { ...sessionCookieOptions(this.env, host), expires: new Date(this.clock.now().getTime() + this.env.sessionTtlDays * DAY_MS) });
      return wallet ? { status, wallet } : { status };
    }));
  }
}
