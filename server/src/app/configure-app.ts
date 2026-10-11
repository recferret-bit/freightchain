import type { INestApplication } from '@nestjs/common';
import compression from 'compression';
import type { Express, NextFunction, Request, Response } from 'express';
import { EnvService } from '../infrastructure/config/env.service.js';
import { ProblemDetailsFilter } from '../infrastructure/http/filters/problem-details.filter.js';
import { requestIdMiddleware } from '../infrastructure/http/middleware/request-id.middleware.js';
import { requestLogMiddleware } from '../infrastructure/http/middleware/request-log.middleware.js';
import { beaconBodyMiddleware } from '../infrastructure/http/middleware/beacon-body.middleware.js';
import { actionHeadersMiddleware, isActionRequest } from '../infrastructure/http/middleware/action-headers.middleware.js';
import { ridePageMiddleware } from '../infrastructure/http/middleware/ride-page.middleware.js';
import { PrismaService } from '../infrastructure/prisma/prisma.service.js';
import { JsonLogger } from '../infrastructure/logging/json-logger.js';

/** What every running app needs besides its modules – shared by main.ts and the tests so they boot identically. */
export function configureApp(app: INestApplication): void {
  const env = app.get(EnvService, { strict: false });
  const logger = app.get(JsonLogger, { strict: false });
  const prisma = app.get(PrismaService, { strict: false });
  app.useLogger(logger);   // JSON lines in production (`npm run ops -- logs`), and the in-memory ring the admin page reads
  // behind a reverse proxy (Railway / Fly) req.ip would be the proxy's: tell Express how many hops to trust, or every rider shares one rate-limit bucket
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', env.trustProxy);
  // blinks are fetched from arbitrary origins: those paths set `*` themselves and must not also get credentialed CORS
  app.use(actionHeadersMiddleware);
  // the game and the lobby call the API from sibling origins (ride.* / the apex): exact-origin allowlist + credentials (the session cookie); no wildcard
  if (env.corsOrigins.length > 0) app.use(browserCors(env));
  app.use(compression());   // text (HTML, JS, CSS, JSON) over 1 kB is gzipped; images are already compressed and pass through untouched
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware(logger));   // after the request id: every API line carries it
  app.use(beaconBodyMiddleware);   // a closing game tab's /end beacon (text/plain JSON) – before Nest's own JSON parser
  app.use(ridePageMiddleware(prisma, env));   // public ride page (/r/:id) with dynamic Twitter Cards & OpenGraph tags
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
}

/** The credentialed allowlist, same answers the `cors` package gave Nest's enableCors. Action paths skip it: `*` plus credentials is illegal. */
export function browserCors(env: EnvService) {
  const allowed = new Set(env.corsOrigins);
  return function browserCors(req: Request, res: Response, next: NextFunction): void {
    if (isActionRequest(req)) { next(); return; }
    const origin = req.header('origin');
    if (!origin || !allowed.has(origin)) { next(); return; }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    if (req.method !== 'OPTIONS') { next(); return; }
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    const requested = req.header('access-control-request-headers');
    if (requested) res.setHeader('Access-Control-Allow-Headers', requested);
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  };
}
