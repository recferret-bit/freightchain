import type { NextFunction, Request, Response } from 'express';
import { UnsupportedMediaTypeError } from '../../../domain/shared/errors.js';
import { BEACON_ROUTES } from './beacon-body.middleware.js';
import { apiPath } from '../api-path.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The API takes JSON (audit H7): a form post (urlencoded / multipart), text/plain or an `<a ping>` (text/ping) is what another page can send without a CORS
 * preflight, so a body of any type but JSON on a state-changing /api request is a 415 before Nest's parsers run – an allowlist, so no simple type is
 * forgotten – except text/plain on the beacon routes (a closing tab's /end, beacon-body.middleware).
 * A request without a body (no content-type) passes: the Origin guard judges it.
 */
export function jsonOnlyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!UNSAFE.has(req.method) || !apiPath(req.path).startsWith('/api/') || !req.headers['content-type']) { next(); return; }
  const beacon = req.is('text/plain') && BEACON_ROUTES.some((r) => r.test(apiPath(req.path)));
  if (!beacon && !req.is(['application/json', '+json'])) { next(new UnsupportedMediaTypeError('the API takes JSON', 'json_only')); return; }
  next();
}
