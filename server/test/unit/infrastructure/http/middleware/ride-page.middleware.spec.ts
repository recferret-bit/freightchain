import { ridePageMiddleware } from '../../../../../src/infrastructure/http/middleware/ride-page.middleware.js';
import type { PrismaService } from '../../../../../src/infrastructure/prisma/prisma.service.js';
import type { EnvService } from '../../../../../src/infrastructure/config/env.service.js';
import type { Request, Response, NextFunction } from 'express';

describe('ridePageMiddleware', () => {
  const env = {
    clientDir: '/tmp',
    appOrigin: 'https://freightchain.fun',
    deployDomain: 'freightchain.fun',
  } as unknown as EnvService;

  it('calls next() for non-GET requests', () => {
    const middleware = ridePageMiddleware(null, env);
    const req = { method: 'POST', path: '/r/test-ride' } as unknown as Request;
    let nextCalled = false;
    middleware(req, {} as Response, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('calls next() for non-matching paths', () => {
    const middleware = ridePageMiddleware(null, env);
    const req = { method: 'GET', path: '/api/rides/test-ride' } as unknown as Request;
    let nextCalled = false;
    middleware(req, {} as Response, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('serves template when prisma is null', () => {
    const middleware = ridePageMiddleware(null, env);
    const req = { method: 'GET', path: '/r/test-ride' } as unknown as Request;
    let sentBody = '';
    const res = {
      setHeader: () => undefined,
      send: (body: string) => { sentBody = body; },
    } as unknown as Response;
    middleware(req, res, () => undefined);
    expect(sentBody).toContain('<!doctype html>');
  });

  it('serves dynamic tags for a running ride', async () => {
    const prisma = {
      ride: {
        findUnique: async () => ({
          id: 'test-uuid',
          wallet: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn',
          tier: '1h',
          status: 'running',
          route: 'route66',
          lastS: 25400,
          payment: null,
          verdict: null,
        }),
      },
    } as unknown as PrismaService;

    const middleware = ridePageMiddleware(prisma, env);
    const req = { method: 'GET', path: '/r/test-uuid' } as unknown as Request;
    let sentBody = '';
    const res = {
      setHeader: () => undefined,
      send: (body: string) => { sentBody = body; },
    } as unknown as Response;

    middleware(req, res, () => undefined);
    await new Promise((r) => setTimeout(r, 10));

    expect(sentBody).toContain('LIVE · 25.4 km');
    expect(sentBody).toContain('Gsea…Cqbn');
  });

  it('serves dynamic tags for a completed verified ride', async () => {
    const prisma = {
      ride: {
        findUnique: async () => ({
          id: 'test-uuid-2',
          wallet: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn',
          tier: '1h',
          status: 'completed',
          route: 'siberia',
          lastS: 94200,
          payment: { signature: '5KtPn...' },
          verdict: { status: 'verified' },
        }),
      },
    } as unknown as PrismaService;

    const middleware = ridePageMiddleware(prisma, env);
    const req = { method: 'GET', path: '/r/test-uuid-2' } as unknown as Request;
    let sentBody = '';
    const res = {
      setHeader: () => undefined,
      send: (body: string) => { sentBody = body; },
    } as unknown as Response;

    middleware(req, res, () => undefined);
    await new Promise((r) => setTimeout(r, 10));

    expect(sentBody).toContain('94.2 km on SIBERIA · COMPLETED (VERIFIED)');
  });
});
