import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { z } from 'zod';
import { ResponseSchemaViolationError } from '../../../../src/domain/shared/errors.js';
import { ZodResponse, ZodResponseRaw } from '../../../../src/infrastructure/http/decorators/zod-response.js';
import { responseIssues, wireJson, ZodResponseInterceptor } from '../../../../src/infrastructure/http/interceptors/zod-response.interceptor.js';
import { toProblem } from '../../../../src/infrastructure/http/filters/problem-mapping.js';

const schema = z.object({ ok: z.literal(true) }).passthrough();
class Route {
  @ZodResponse(schema)
  json(): { ok: true } { return { ok: true }; }
  @ZodResponseRaw()
  raw(): Buffer { return Buffer.from('x'); }
  plain(): { ok: true } { return { ok: true }; }
}

const ctx = (handler: (...args: unknown[]) => unknown) => ({
  getHandler: () => handler,
  switchToHttp: () => ({ getRequest: () => ({ method: 'GET', originalUrl: '/api/x' }) }),
}) as never;
const next = (body: unknown) => ({ handle: () => of(body) });
const env = (mode: 'off' | 'warn' | 'strict') => ({ responseSchemaCheck: mode });
const meta = (key: string, fn: unknown) => Reflect.getMetadata(key, fn as object);
const run = (mode: 'off' | 'warn' | 'strict', handler: (...args: unknown[]) => unknown, body: unknown) => lastValueFrom(new ZodResponseInterceptor({ get: meta } as never, env(mode) as never).intercept(ctx(handler), next(body)));

describe('ZodResponseInterceptor', () => {
  it('serialises Dates the way Express will', () => {
    expect(wireJson({ at: new Date('2020-01-01T00:00:00.000Z'), skip: undefined })).toEqual({ at: '2020-01-01T00:00:00.000Z' });
  });

  it('strict: a mismatch is a 500 response_schema_violation and a match returns the original body', async () => {
    const ok = { ok: true as const, extra: 1 };
    expect(await run('strict', Route.prototype.json, ok)).toBe(ok);
    await expect(run('strict', Route.prototype.json, { ok: false })).rejects.toBeInstanceOf(ResponseSchemaViolationError);
    const error = await run('strict', Route.prototype.json, { ok: false }).catch((e: unknown) => e);
    expect(toProblem(error, { requestId: 'r', instance: '/api/x' })).toMatchObject({ status: 500, code: 'response_schema_violation' });
  });

  it('warn logs and still returns the body; off and @ZodResponseRaw do not parse', async () => {
    const warns: string[] = [];
    const interceptor = new ZodResponseInterceptor({ get: meta } as never, env('warn') as never);
    (interceptor as unknown as { logger: { warn: (m: string) => void } }).logger = { warn: (m) => warns.push(m) };
    const bad = { ok: false };
    expect(await lastValueFrom(interceptor.intercept(ctx(Route.prototype.json), next(bad)))).toBe(bad);
    expect(warns[0]).toContain('response_schema_violation');
    expect(await run('off', Route.prototype.json, bad)).toBe(bad);
    expect(await run('strict', Route.prototype.raw, bad)).toBe(bad);
  });

  it('a route with no schema fails closed in strict mode', async () => {
    await expect(run('strict', Route.prototype.plain, { ok: true })).rejects.toThrow(/no @ZodResponse/);
  });

  it('names the failing field', () => {
    expect(responseIssues(schema, { ok: 1 })).toMatch(/ok:/);
  });
});
