import { CONTROLLER_WATERMARK, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import request from 'supertest';
import { z } from 'zod';
import { ResponseSchemaViolationError } from '../../src/domain/shared/errors.js';
import { EnvService } from '../../src/infrastructure/config/env.service.js';
import { ZOD_RESPONSE, ZOD_RESPONSE_RAW, ZodResponse } from '../../src/infrastructure/http/decorators/zod-response.js';
import { toProblem } from '../../src/infrastructure/http/filters/problem-mapping.js';
import { ZodResponseInterceptor } from '../../src/infrastructure/http/interceptors/zod-response.interceptor.js';
import { createHarness, type Harness } from '../support/harness.js';
import { discoverRoutes } from './discover-routes.js';
import { routeKey, type RouteMethod } from './routes.manifest.js';

const METHOD_BY_CODE: Record<number, RouteMethod> = {
  [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.DELETE]: 'DELETE',
};

/** JSON controller routes on the booted graph that declare neither `@ZodResponse` nor `@ZodResponseRaw`. */
function jsonResponseGaps(app: Harness['app']): string[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer));
  const gaps: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as { prototype: object } | undefined;
    if (!metatype || Reflect.getMetadata(CONTROLLER_WATERMARK, metatype) !== true) continue;
    for (const prefix of pathsOf(Reflect.getMetadata(PATH_METADATA, metatype))) {
      let proto: object | null = metatype.prototype;
      const seen = new Set<string>();
      while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor' || seen.has(name)) continue;
          const fn = (proto as Record<string, unknown>)[name];
          if (typeof fn !== 'function' || Reflect.getMetadata(METHOD_METADATA, fn) === undefined) continue;
          seen.add(name);
          const method = METHOD_BY_CODE[Reflect.getMetadata(METHOD_METADATA, fn) as number];
          if (!method) continue;
          const raw = Reflect.getMetadata(ZOD_RESPONSE_RAW, fn) === true;
          const schema = Reflect.getMetadata(ZOD_RESPONSE, fn);
          if (raw || schema) continue;
          for (const path of pathsOf(Reflect.getMetadata(PATH_METADATA, fn))) gaps.push(routeKey({ method, path: joinPath(prefix, path) }));
        }
        proto = Object.getPrototypeOf(proto);
      }
    }
  }
  return gaps.sort();
}

const pathsOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.length ? value.map(String) : [''];
  if (value === undefined || value === null || value === '') return [''];
  return [String(value)];
};

const joinPath = (prefix: string, path: string): string => {
  const parts = [prefix, path].flatMap((part) => part.split('/').filter((segment) => segment.length > 0 && segment !== '/'));
  return `/${parts.join('/')}`;
};

const mismatch = z.object({ ok: z.literal(true) }).strict();
class Fixture {
  @ZodResponse(mismatch)
  json(): { ok: true } { return { ok: true }; }
}
const httpCtx = (handler: (...args: unknown[]) => unknown) => ({
  getHandler: () => handler,
  switchToHttp: () => ({ getRequest: () => ({ method: 'GET', originalUrl: '/api/contract-fixture' }) }),
}) as never;
const meta = (key: string, fn: unknown) => Reflect.getMetadata(key, fn as object);

describe('@ZodResponse', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness('memory', { RESPONSE_SCHEMA_CHECK: 'strict' });
  }, 60_000);

  afterAll(() => harness?.close());

  it('every JSON controller route on the booted app declares @ZodResponse (raw routes are the only exemption)', () => {
    const live = discoverRoutes(harness.app);
    expect(jsonResponseGaps(harness.app)).toEqual([]);
    expect(live.length).toBeGreaterThanOrEqual(151);
    expect(harness.app.get(EnvService).responseSchemaCheck).toBe('strict');
  });

  it('a real JSON route still answers under strict mode (the schema matches the body)', async () => {
    await request(harness.server()).get('/api/health/live').expect(200);
  });

  it('strict: a mismatched handler fixture is 500 response_schema_violation', async () => {
    const interceptor = new ZodResponseInterceptor({ get: meta } as never, { responseSchemaCheck: 'strict' } as never);
    const run = (body: unknown) => lastValueFrom(interceptor.intercept(httpCtx(Fixture.prototype.json), { handle: () => of(body) }));
    expect(await run({ ok: true })).toEqual({ ok: true });
    const error = await run({ ok: false, extra: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResponseSchemaViolationError);
    expect(toProblem(error, { requestId: 'r', instance: '/api/contract-fixture' })).toMatchObject({ status: 500, code: 'response_schema_violation', title: 'Response schema violation' });
  });

  it('warn: the same mismatch is logged and the body is still returned', async () => {
    const interceptor = new ZodResponseInterceptor({ get: meta } as never, { responseSchemaCheck: 'warn' } as never);
    const warns: string[] = [];
    (interceptor as unknown as { logger: { warn: (message: string) => void } }).logger = { warn: (message) => warns.push(message) };
    const bad = { ok: false };
    expect(await lastValueFrom(interceptor.intercept(httpCtx(Fixture.prototype.json), { handle: () => of(bad) }))).toBe(bad);
    expect(warns[0]).toContain('response_schema_violation');
    expect(JSON.parse(warns[0]!)).toMatchObject({ event: 'response_schema_violation', where: 'GET /api/contract-fixture' });
  });
});
