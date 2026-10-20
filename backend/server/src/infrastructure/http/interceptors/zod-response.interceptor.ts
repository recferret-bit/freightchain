import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import type { ZodTypeAny } from 'zod';
import { ResponseSchemaViolationError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';
import { ZOD_RESPONSE, ZOD_RESPONSE_RAW, type ZodResponseMeta } from '../decorators/zod-response.js';

/** JSON the client will see. Dates become ISO strings; `undefined` fields drop, matching Express. */
export function wireJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function responseIssues(schema: ZodTypeAny, body: unknown): string | null {
  let wire: unknown;
  try { wire = wireJson(body); } catch { return 'response is not JSON'; }
  const parsed = schema.safeParse(wire);
  if (parsed.success) return null;
  return parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(body)'}: ${issue.message}`).join('; ');
}

/** Checks every JSON route against its `@ZodResponse` schema. `strict` → 500 `response_schema_violation`; `warn` logs and still returns the body; `off` does nothing. The original body is returned on success so the wire shape is unchanged. */
@Injectable()
export class ZodResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ZodResponseInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly env: EnvService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mode = this.env.responseSchemaCheck;
    if (mode === 'off') return next.handle();
    const handler = context.getHandler();
    if (this.reflector.get<boolean>(ZOD_RESPONSE_RAW, handler)) return next.handle();
    const meta = this.reflector.get<ZodResponseMeta | undefined>(ZOD_RESPONSE, handler);
    const http = context.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const where = `${http.method ?? '?'} ${http.originalUrl ?? http.url ?? '?'}`;
    return next.handle().pipe(map((body) => {
      if (!meta) {
        this.fail(mode, where, 'no @ZodResponse');
        return body;
      }
      const issues = responseIssues(meta.schema, body);
      if (issues) this.fail(mode, where, issues);
      return body;
    }));
  }

  private fail(mode: 'warn' | 'strict', where: string, issues: string): void {
    const event = { event: 'response_schema_violation', where, issues };
    if (mode === 'warn') {
      this.logger.warn(JSON.stringify(event));
      return;
    }
    throw new ResponseSchemaViolationError(`${where}: ${issues}`);
  }
}
