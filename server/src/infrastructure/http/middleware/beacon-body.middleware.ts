import { text, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

/* A page that is CLOSING can only send a beacon (navigator.sendBeacon): it must be a CORS "simple" request, so its body is text/plain – a JSON
   preflight would never finish. Only these routes accept that: the game's /end when its tab closes (the ride can never resume after that, so it ends
   now instead of after HB_TIMEOUT_MS + a sweep). The text is parsed as JSON and validated like any body (ZodBody); anything else is an empty body.
   A sibling subdomain is the SAME site (its beacon carries the cookie): the Origin guard (origin.guard.ts) refuses one that is not ours. */
export const BEACON_ROUTES = [/^\/api\/rides\/[^/]{1,64}\/end$/i];
const textParser = text({ type: 'text/plain', limit: '16kb' });

export function beaconBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST' || !req.is('text/plain') || !BEACON_ROUTES.some((r) => r.test(req.path))) { next(); return; }
  (textParser as RequestHandler)(req, res, (error?: unknown) => {
    if (error) { next(error); return; }
    try { req.body = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); } catch { req.body = {}; }
    next();
  });
}
