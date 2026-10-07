import type { NextFunction, Request, Response } from 'express';
import { requestIdMiddleware } from '../../../../src/infrastructure/http/middleware/request-id.middleware.js';

const run = (header?: string) => {
  const headers: Record<string, string> = {};
  const req = { header: () => header } as unknown as Request & { requestId?: string };
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  requestIdMiddleware(req, res, next);
  return { id: req.requestId, headers, next };
};

describe('requestIdMiddleware', () => {
  it('keeps a well-formed caller id and always answers with X-Request-Id', () => {
    const { id, headers, next } = run('client-req-0001');
    expect(id).toBe('client-req-0001');
    expect(headers['x-request-id']).toBe('client-req-0001');
    expect(next).toHaveBeenCalledOnce();
  });
  it('replaces a missing or malformed id with a fresh UUID', () => {
    for (const bad of [undefined, 'short', 'has spaces in it!!', 'x'.repeat(200)]) expect(run(bad).id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
