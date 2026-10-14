import type { NextFunction, Request, Response } from 'express';
import { jsonOnlyMiddleware } from '../../../../src/infrastructure/http/middleware/json-only.middleware.js';

/* Pentest H7: the API takes JSON – a form post or text/plain (no CORS preflight) is a 415 before any parser, but for the /end beacon. */
const run = (method: string, path: string, type?: string): unknown => {
  const req = { method, path, headers: type ? { 'content-type': type } : {}, is: (t: string | string[]) => [t].flat().some((x) => (type ?? '').startsWith(x)) } as unknown as Request;
  let passed: unknown = 'not called';
  jsonOnlyMiddleware(req, {} as Response, ((e?: unknown) => { passed = e ?? 'next'; }) as NextFunction);
  return passed;
};

describe('jsonOnlyMiddleware', () => {
  it('a form post, a multipart body or text/plain to a state-changing API route is 415 json_only', () => {
    for (const t of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain;charset=UTF-8']) {
      expect(run('POST', '/api/auth/verify', t)).toMatchObject({ statusCode: 415, errorCode: 'json_only' });
    }
    expect(run('PUT', '/API/PROFILE/agreements', 'application/x-www-form-urlencoded')).toMatchObject({ statusCode: 415 });   // any casing (Express routes are case-insensitive)
  });

  it('JSON, no body, a read, a non-API path and the /end beacon pass', () => {
    expect(run('POST', '/api/rides', 'application/json')).toBe('next');
    expect(run('POST', '/api/rides/abc/start')).toBe('next');
    expect(run('GET', '/api/me', 'text/plain')).toBe('next');
    expect(run('POST', '/r/abc', 'application/x-www-form-urlencoded')).toBe('next');
    expect(run('POST', '/api/rides/abc/end', 'text/plain;charset=UTF-8')).toBe('next');
  });
});
