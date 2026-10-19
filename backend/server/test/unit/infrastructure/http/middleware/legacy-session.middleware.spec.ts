import type { NextFunction, Request, Response } from 'express';
import { legacySessionMiddleware } from '../../../../../src/infrastructure/http/middleware/legacy-session.middleware.js';
import type { EnvService } from '../../../../../src/infrastructure/config/env.service.js';

/* Audit H7-B: the apex-wide fc_session of before is expired wherever it still comes in – production only. */
const run = (env: Partial<EnvService>, cookie?: string) => {
  const cleared: unknown[][] = [];
  let next = false;
  legacySessionMiddleware(env as EnvService)({ headers: cookie ? { cookie } : {} } as Request, { clearCookie: (...a: unknown[]) => cleared.push(a) } as unknown as Response, (() => { next = true; }) as NextFunction);
  return { cleared, next };
};

describe('legacySessionMiddleware', () => {
  it('production: a request still carrying fc_session gets it expired on the apex (Secure, Lax, httpOnly); __Host-fc_session is left alone', () => {
    expect(run({ isProduction: true, cookieDomain: 'freightchain.fun' }, 'fc_session=old; __Host-fc_session=new')).toEqual({ next: true, cleared: [['fc_session', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', domain: 'freightchain.fun' }]] });
    expect(run({ isProduction: true, cookieDomain: 'freightchain.fun' }, '__Host-fc_session=new').cleared).toEqual([]);
  });
  it('outside production (where fc_session IS the session) nothing is touched', () => {
    expect(run({ isProduction: false, cookieDomain: 'example.test' }, 'fc_session=s').cleared).toEqual([]);
  });
});
