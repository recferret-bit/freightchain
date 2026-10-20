import { UnprocessableEntityError } from '../../../../src/domain/shared/errors.js';
import type { ProblemFieldError } from '../../../../src/domain/shared/problem-details.js';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { z } from 'zod';
import { BadRequestError, ConflictError, NotFoundError, ResponseSchemaViolationError, ServiceUnavailableError, UnauthorizedError, VersionConflictError } from '../../../../src/domain/shared/errors.js';
import { toProblem } from '../../../../src/infrastructure/http/filters/problem-mapping.js';

const ctx = { requestId: 'req-12345678', instance: '/api/x' };

describe('toProblem (RFC 9457)', () => {
  it('renders a domain error with its status, code and message', () => {
    expect(toProblem(new ConflictError('a ride is already in progress'), ctx)).toEqual({
      type: '/problems/conflict', title: 'Conflict', status: 409, code: 'conflict', detail: 'a ride is already in progress', requestId: 'req-12345678', instance: '/api/x',
    });
    expect(toProblem(new NotFoundError('ride not found'), ctx)).toMatchObject({ status: 404, code: 'not_found' });
    expect(toProblem(new UnauthorizedError('bad signature'), ctx)).toMatchObject({ status: 401, code: 'unauthorized', detail: 'bad signature' });
    expect(toProblem(new VersionConflictError(), ctx)).toMatchObject({ status: 409, code: 'version_conflict' });
    expect(toProblem(new BadRequestError('x', 'custom_code'), ctx)).toMatchObject({ status: 400, code: 'custom_code' });
    expect(toProblem(new ResponseSchemaViolationError('GET /api/x: ok: bad'), ctx)).toMatchObject({ status: 500, code: 'response_schema_violation', title: 'Response schema violation', detail: 'GET /api/x: ok: bad' });
  });

  it('carries the failing checks of a 503', () => {
    expect(toProblem(new ServiceUnavailableError('Readiness degraded', { database: { status: 'down' } }), ctx)).toMatchObject({ status: 503, checks: { database: { status: 'down' } } });
  });

  it('turns a ZodError into a 400 with one entry per failing field', () => {
    const result = z.object({ wallet: z.string(), n: z.number().int() }).safeParse({ n: 1.5 });
    const problem = toProblem((result as { error: unknown }).error, ctx);
    expect(problem).toMatchObject({ status: 400, code: 'validation_error' });
    expect((problem.errors as ProblemFieldError[] | undefined)?.map((e) => e.path).sort()).toEqual(['n', 'wallet']);
    expect(problem.detail).toMatch(/^(wallet|n): .+; (wallet|n): .+$/); // several issues: "path: message; …"
  });

  it('a single validation issue puts its own message in `detail` (what the clients show)', () => {
    const result = z.object({ signature: z.string().refine(() => false, 'signature must be a base58 transaction signature') }).safeParse({ signature: 'x' });
    expect(toProblem((result as { error: unknown }).error, ctx)).toMatchObject({ code: 'validation_error', detail: 'signature must be a base58 transaction signature' });
  });

  it('maps framework exceptions (unknown route, rate limit, bad JSON, too large)', () => {
    expect(toProblem(new NotFoundException('Cannot GET /api/nope'), ctx)).toMatchObject({ status: 404, code: 'not_found', detail: 'Cannot GET /api/nope' });
    expect(toProblem(new ThrottlerException(), ctx)).toMatchObject({ status: 429, code: 'rate_limited' });
    expect(toProblem(new BadRequestException('Unexpected token } in JSON at position 3'), ctx)).toMatchObject({ status: 400, code: 'malformed_json' });
    expect(toProblem(Object.assign(new SyntaxError('bad'), { type: 'entity.parse.failed' }), ctx)).toMatchObject({ status: 400, code: 'malformed_json' });
    expect(toProblem(Object.assign(new Error('big'), { type: 'entity.too.large' }), ctx)).toMatchObject({ status: 413, code: 'payload_too_large' });
  });

  it('hides everything about an unexpected error', () => {
    const p = toProblem(new TypeError('secret detail: password=hunter2'), ctx);
    expect(p).toMatchObject({ status: 500, code: 'internal_error' });
    expect(JSON.stringify(p)).not.toContain('hunter2');
    expect(toProblem(new HttpException('boom', 503), ctx)).toMatchObject({ status: 500, code: 'internal_error' });
  });

  it('an entity refused (422) carries every reason and the warnings', () => {
    const problem = toProblem(new UnprocessableEntityError('no', 'entity_invalid', ['parts[0]: bad'], ['floats']), ctx);
    expect(problem).toMatchObject({ status: 422, code: 'entity_invalid', title: 'Entity refused', errors: ['parts[0]: bad'], warnings: ['floats'] });
  });
});
