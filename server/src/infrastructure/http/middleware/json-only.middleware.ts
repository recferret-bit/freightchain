import type { NextFunction, Request, Response } from 'express';
import { UnsupportedMediaTypeError } from '../../../domain/shared/errors.js';
import { BEACON_ROUTES } from './beacon-body.middleware.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The API takes JSON (pentest H7): a form post (urlencoded / multipart) or text/plain is what another page can send without a CORS preflight, so on a
 * state-changing /api request it is a 415 before Nest's parsers run – except text/plain on the beacon routes (a closing tab's /end, beacon-body.middleware).
 * A request without a body (no content-type) passes: the Origin guard judges it.
 */
export function jsonOnlyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!UNSAFE.has(req.method) || !req.path.toLowerCase().startsWith('/api/') || !req.headers['content-type']) { next(); return; }
  const beacon = req.is('text/plain') && BEACON_ROUTES.some((r) => r.test(req.path));
  if (!beacon && req.is(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'])) { next(new UnsupportedMediaTypeError('the API takes JSON', 'json_only')); return; }
  next();
}
