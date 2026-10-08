import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { USER_AGENT_MAX_LENGTH, type ClientInfo } from '../../../domain/auth/sign-in.js';
import { getRequestId } from '../types/http-request.js';

/** Where the request came from: the client IP (as Express resolves it with TRUST_PROXY) and the browser's User-Agent, trimmed. */
export const clientInfoOf = (req: Request): ClientInfo => {
  const ua = req.header('user-agent');
  return { ip: req.ip ?? null, userAgent: ua ? ua.slice(0, USER_AGENT_MAX_LENGTH) : null };
};
export const CurrentClient = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientInfo => clientInfoOf(ctx.switchToHttp().getRequest<Request>()));

/** The browser's Origin header (null when absent) – which of the app's own pages a sign-in comes from. Only ever compared with configured origins. */
export const CurrentOrigin = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => ctx.switchToHttp().getRequest<Request>().header('origin') ?? null);

/** The request's id (X-Request-Id) – for audit rows that must be findable in the log. */
export const CurrentRequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => getRequestId(ctx.switchToHttp().getRequest<Request>()));
