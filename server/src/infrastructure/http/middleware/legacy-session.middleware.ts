import type { NextFunction, Request, Response } from 'express';
import type { EnvService } from '../../config/env.service.js';
import { legacyCookieOptions } from '../interceptors/session-cookie.interceptor.js';
import { readCookie, SESSION_COOKIE } from '../session-cookie.js';

/**
 * Production only (pentest H7-B): the session moved from the apex-wide `fc_session` to the API host's own `__Host-fc_session`. A browser that still sends the
 * old cookie gets it expired here – it is never read again, and left alone it would keep reaching every sibling host until it runs out (SESSION_TTL_DAYS).
 */
export function legacySessionMiddleware(env: EnvService) {
  const domain = env.isProduction ? env.cookieDomain : undefined;
  return function legacySession(req: Request, res: Response, next: NextFunction): void {
    if (domain && readCookie(req.headers.cookie, SESSION_COOKIE) !== undefined) res.clearCookie(SESSION_COOKIE, legacyCookieOptions(domain));
    next();
  };
}
