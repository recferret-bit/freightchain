import type { INestApplication } from '@nestjs/common';
import compression from 'compression';
import type { Express } from 'express';
import { EnvService } from '../infrastructure/config/env.service.js';
import { ProblemDetailsFilter } from '../infrastructure/http/filters/problem-details.filter.js';
import { requestIdMiddleware } from '../infrastructure/http/middleware/request-id.middleware.js';
import { requestLogMiddleware } from '../infrastructure/http/middleware/request-log.middleware.js';
import { beaconBodyMiddleware } from '../infrastructure/http/middleware/beacon-body.middleware.js';
import { JsonLogger } from '../infrastructure/logging/json-logger.js';

/** What every running app needs besides its modules – shared by main.ts and the tests so they boot identically. */
export function configureApp(app: INestApplication): void {
  const env = app.get(EnvService, { strict: false });
  const logger = app.get(JsonLogger, { strict: false });
  app.useLogger(logger);   // JSON lines in production (`npm run ops -- logs`), and the in-memory ring the admin page reads
  // behind a reverse proxy (Railway / Fly) req.ip would be the proxy's: tell Express how many hops to trust, or every rider shares one rate-limit bucket
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', env.trustProxy);
  // the game and the lobby call the API from sibling origins (ride.* / the apex): exact-origin allowlist + credentials (the session cookie); no wildcard
  if (env.corsOrigins.length > 0) app.enableCors({ origin: env.corsOrigins, credentials: true, exposedHeaders: ['X-Request-Id'], maxAge: 600 });
  app.use(compression());   // text (HTML, JS, CSS, JSON) over 1 kB is gzipped; images are already compressed and pass through untouched
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware(logger));   // after the request id: every API line carries it
  app.use(beaconBodyMiddleware);   // a closing game tab's /end beacon (text/plain JSON) – before Nest's own JSON parser
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
}
