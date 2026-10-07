import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { EnvService } from '../infrastructure/config/env.service.js';
import { ProblemDetailsFilter } from '../infrastructure/http/filters/problem-details.filter.js';
import { requestIdMiddleware } from '../infrastructure/http/middleware/request-id.middleware.js';

/** What every running app needs besides its modules – shared by main.ts and the tests so they boot identically. */
export function configureApp(app: INestApplication): void {
  const env = app.get(EnvService, { strict: false });
  // behind a reverse proxy (Railway / Fly) req.ip would be the proxy's: tell Express how many hops to trust, or every rider shares one rate-limit bucket
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', env.trustProxy);
  // the game and the lobby call the API from sibling origins (ride.* / the apex): exact-origin allowlist + credentials (the session cookie); no wildcard
  if (env.corsOrigins.length > 0) app.enableCors({ origin: env.corsOrigins, credentials: true, exposedHeaders: ['X-Request-Id'], maxAge: 600 });
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
}
