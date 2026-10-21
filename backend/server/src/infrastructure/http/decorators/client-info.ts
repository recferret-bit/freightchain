import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { USER_AGENT_MAX_LENGTH, type ClientInfo } from '../../../domain/auth/sign-in.js';
import { HOST_PAIR_COOKIE, HOST_SESSION_COOKIE, PAIR_COOKIE, readCookie, SESSION_COOKIE } from '../session-cookie.js';
import { getRequestId } from '../types/http-request.js';

/** Where the request came from: the client IP (as Express resolves it with TRUST_PROXY) and the browser's User-Agent, trimmed. */
export const clientInfoOf = (req: Request): ClientInfo => {
  const ua = req.header('user-agent');
  return { ip: req.ip ?? null, userAgent: ua ? ua.slice(0, USER_AGENT_MAX_LENGTH) : null };
};
export const CurrentClient = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientInfo => clientInfoOf(ctx.switchToHttp().getRequest<Request>()));

/** Stable browser id for admin sign-in challenges (`x-fc-client`). Missing or blank becomes `default`. */
export const CurrentClientId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const raw = ctx.switchToHttp().getRequest<Request>().header('x-fc-client')?.trim().slice(0, 64);
  return raw ? raw : 'default';
});

/** The browser's Origin header (null when absent) – which of the app's own pages a sign-in comes from. Only ever compared with configured origins. */
export const CurrentOrigin = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => ctx.switchToHttp().getRequest<Request>().header('origin') ?? null);

/** The request's id (X-Request-Id) – for audit rows that must be findable in the log. */
export const CurrentRequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => getRequestId(ctx.switchToHttp().getRequest<Request>()));

/** The desktop pairing secret cookie (__Host-fc_pair in production, fc_pair in dev/test). */
export const CurrentPairSecret = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  const c = ctx.switchToHttp().getRequest<Request>().headers?.cookie;
  return readCookie(c, HOST_PAIR_COOKIE) ?? readCookie(c, PAIR_COOKIE) ?? null;
});

/** The player session token cookie (__Host-fc_session in production, fc_session in dev/test). */
export const CurrentSessionToken = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  const c = ctx.switchToHttp().getRequest<Request>().headers?.cookie;
  return readCookie(c, HOST_SESSION_COOKIE) ?? readCookie(c, SESSION_COOKIE) ?? null;
});

