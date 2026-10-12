import type { NextFunction, Request, Response } from 'express';
import { DEVNET_BLOCKCHAIN_ID } from '../../../../../src/domain/actions/action-card.js';
import { actionHeadersMiddleware, isActionRequest } from '../../../../../src/infrastructure/http/middleware/action-headers.middleware.js';

const resOf = () => {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; }, status: (n: number) => ({ end: () => n }), headers } as unknown as Response;
  return { res, headers };
};

describe('action headers', () => {
  it('matches discovery and the action API, not the rest of the site', () => {
    expect(isActionRequest({ url: '/actions.json' })).toBe(true);
    expect(isActionRequest({ url: '/.well-known/actions.json?x=1' })).toBe(true);
    expect(isActionRequest({ url: '/api/actions/shift/1h' })).toBe(true);
    expect(isActionRequest({ url: '/api/health/live' })).toBe(false);
    expect(isActionRequest({ url: '/r/abc' })).toBe(false);
  });

  it('sets the devnet chain id and ends OPTIONS before the allowlist', () => {
    const { res, headers } = resOf();
    const next = vi.fn();
    actionHeadersMiddleware({ method: 'OPTIONS', url: '/api/actions/shift' } as Request, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['X-Blockchain-Ids']).toBe(DEVNET_BLOCKCHAIN_ID);
    expect(headers['X-Action-Version']).toBe('2.4');
    expect(headers['Access-Control-Allow-Headers']).toMatch(/X-Accept-Action-Version, X-Accept-Blockchain-Ids/);
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    const aliased = { method: 'GET', url: '/.well-known/actions.json', originalUrl: '/.well-known/actions.json' } as Request;
    actionHeadersMiddleware(aliased, resOf().res, next as NextFunction);
    expect(aliased.url).toBe('/actions.json');
    const pass = resOf();
    actionHeadersMiddleware({ method: 'GET', url: '/api/me' } as Request, pass.res, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(2); // the well-known alias, then a non-action path
    expect(pass.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
