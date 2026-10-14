import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestId, type RequestWithPlayer } from '../types/http-request.js';
import { apiPath } from '../api-path.js';

/** Health probes run every few seconds (Docker, the deploy) – logging them would drown everything else. */
const QUIET = /^\/api\/health\//;

/**
 * One structured line per API call, written when the response has finished (so the auth guard has already put the wallet on the request):
 * `{event:'request', method, path, status, ms, requestId, wallet?, ip}`. 5xx → error, 4xx → warn. Static files and health probes are not logged;
 * the query string is left out (it can carry ids people paste around).
 */
export function requestLogMiddleware(logger: LoggerService) {
  return function requestLog(req: Request, res: Response, next: NextFunction): void {
    const path = apiPath(req.path);   // as Express routes it: /API/… is an API call too (M9)
    if (!path.startsWith('/api/') || QUIET.test(path)) { next(); return; }
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10;
      const status = res.statusCode;
      const line = {
        event: 'request', msg: `${req.method} ${req.path} ${status}`, method: req.method, path: req.path, status, ms,
        requestId: getRequestId(req), wallet: (req as Partial<RequestWithPlayer>).player?.wallet, ip: req.ip,
      };
      if (status >= 500) logger.error(line, 'HTTP');
      else if (status >= 400) logger.warn?.(line, 'HTTP');
      else logger.log(line, 'HTTP');
    });
    next();
  };
}
