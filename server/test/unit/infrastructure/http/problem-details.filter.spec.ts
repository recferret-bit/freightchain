import type { ArgumentsHost } from '@nestjs/common';
import { ProblemDetailsFilter } from '../../../../src/infrastructure/http/filters/problem-details.filter.js';
import { ConflictError, TooManyRequestsError } from '../../../../src/domain/shared/errors.js';

function hostFor(headersSent = false) {
  const sent: { status?: number; body?: string; headers: Record<string, string>; ended: boolean } = { headers: {}, ended: false };
  const response = {
    headersSent,
    setHeader: (k: string, v: string) => { sent.headers[k] = v; },
    status(code: number) { sent.status = code; return this; },
    send(body: string) { sent.body = body; },
    end() { sent.ended = true; },
  };
  const request = { requestId: 'req-12345678', originalUrl: '/api/rides', method: 'POST' };
  return { sent, host: { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost };
}

describe('ProblemDetailsFilter', () => {
  it('writes application/problem+json with the status and the request id', () => {
    const { sent, host } = hostFor();
    new ProblemDetailsFilter().catch(new ConflictError('a ride is already in progress'), host);
    expect(sent.status).toBe(409);
    expect(sent.headers['Content-Type']).toBe('application/problem+json; charset=utf-8');
    expect(JSON.parse(sent.body ?? '{}')).toMatchObject({ code: 'conflict', detail: 'a ride is already in progress', requestId: 'req-12345678', instance: '/api/rides' });
  });

  it('a 429 that knows its wait sends Retry-After (whole seconds, at least 1); one that does not sends none', () => {
    const a = hostFor();
    new ProblemDetailsFilter().catch(new TooManyRequestsError('wait', 'live_rate_limited', 6.2), a.host);
    expect(a.sent.status).toBe(429); expect(a.sent.headers['Retry-After']).toBe('7');
    const b = hostFor();
    new ProblemDetailsFilter().catch(new TooManyRequestsError('quota'), b.host);
    expect(b.sent.headers['Retry-After']).toBeUndefined();
  });

  it('logs an unexpected error (with its stack) but answers a bare 500', () => {
    const { sent, host } = hostFor();
    const filter = new ProblemDetailsFilter();
    const errors: string[] = [];
    (filter as unknown as { logger: { error: (m: string) => void } }).logger = { error: (m: string) => { errors.push(m); } };
    filter.catch(new TypeError('db password=hunter2'), host);
    expect(sent.status).toBe(500);
    expect(sent.body).not.toContain('hunter2');
    expect(errors[0]).toMatch(/internal_error requestId=req-12345678 method=POST path=\/api\/rides[\s\S]*hunter2/);
  });

  it('if the response already started, it only ends it', () => {
    const { sent, host } = hostFor(true);
    new ProblemDetailsFilter().catch(new ConflictError('x'), host);
    expect(sent.ended).toBe(true);
    expect(sent.status).toBeUndefined();
  });
});
