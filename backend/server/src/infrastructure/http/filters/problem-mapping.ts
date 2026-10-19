import { HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodError } from 'zod';
import { DomainError, ServiceUnavailableError, UnprocessableEntityError } from '../../../domain/shared/errors.js';
import { problemTypeFor, titleForCode, type ProblemDetails, type ProblemFieldError } from '../../../domain/shared/problem-details.js';

export interface ProblemContext {
  requestId: string;
  instance: string;
}

const STATUS_CODES: Record<number, string> = { 422: 'unprocessable', 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'payload_too_large', 429: 'rate_limited' };

function problem(ctx: ProblemContext, status: number, code: string, extra: Partial<ProblemDetails> = {}): ProblemDetails {
  return { type: problemTypeFor(code), title: titleForCode(code), status, code, requestId: ctx.requestId, instance: ctx.instance, ...extra };
}

function detailOf(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  return Array.isArray(message) ? message.filter((m): m is string => typeof m === 'string').join('; ') : exception.message;
}

const isBodyParserSyntaxError = (e: unknown): boolean => e instanceof SyntaxError && (e as { type?: unknown }).type === 'entity.parse.failed';
const isTooLarge = (e: unknown): boolean => e instanceof Error && (e as { type?: unknown }).type === 'entity.too.large';

/** Any thrown value → an RFC 9457 problem. Our own code throws DomainError and ZodError only; the rest is framework noise (unknown route, bad JSON, rate limit). */
export function toProblem(exception: unknown, ctx: ProblemContext): ProblemDetails {
  if (exception instanceof ZodError) {
    const errors: ProblemFieldError[] = exception.issues.map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message }));
    // `detail` carries the actual reasons (the clients show detail): one issue → its message, several → "path: message; …"
    const detail = errors.length === 1 ? (errors[0]?.message ?? 'Request validation failed') : errors.map((e) => `${e.path || '(body)'}: ${e.message}`).join('; ');
    return problem(ctx, 400, 'validation_error', { detail, errors });
  }
  if (exception instanceof UnprocessableEntityError) return problem(ctx, 422, exception.errorCode, { detail: exception.message, errors: exception.errors, warnings: exception.warnings });
  if (exception instanceof DomainError) {
    return problem(ctx, exception.statusCode, exception.errorCode, {
      detail: exception.message, ...(exception instanceof ServiceUnavailableError && exception.checks ? { checks: exception.checks } : {}),
    });
  }
  if (exception instanceof ThrottlerException) return problem(ctx, 429, 'rate_limited');
  if (isBodyParserSyntaxError(exception)) return problem(ctx, 400, 'malformed_json', { detail: 'Request body is not valid JSON' });
  if (isTooLarge(exception)) return problem(ctx, 413, 'payload_too_large');
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return problem(ctx, 500, 'internal_error');
    // Nest wraps Express's body-parser SyntaxError into a plain 400 whose message mentions JSON
    if (status === 400 && /JSON/i.test(detailOf(exception) ?? '')) return problem(ctx, 400, 'malformed_json', { detail: 'Request body is not valid JSON' });
    return problem(ctx, status, STATUS_CODES[status] ?? 'bad_request', { detail: detailOf(exception) });
  }
  return problem(ctx, 500, 'internal_error');
}
