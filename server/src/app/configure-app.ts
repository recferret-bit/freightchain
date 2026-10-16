import type { INestApplication } from '@nestjs/common';
import compression from 'compression';
import { json, type Express, type NextFunction, type Request, type Response } from 'express';
import { EnvService } from '../infrastructure/config/env.service.js';
import { ProblemDetailsFilter } from '../infrastructure/http/filters/problem-details.filter.js';
import { requestIdMiddleware } from '../infrastructure/http/middleware/request-id.middleware.js';
import { requestLogMiddleware } from '../infrastructure/http/middleware/request-log.middleware.js';
import { beaconBodyMiddleware } from '../infrastructure/http/middleware/beacon-body.middleware.js';
import { jsonOnlyMiddleware } from '../infrastructure/http/middleware/json-only.middleware.js';
import { legacySessionMiddleware } from '../infrastructure/http/middleware/legacy-session.middleware.js';
import { solanaPayCors } from '../infrastructure/http/middleware/solana-pay-cors.middleware.js';
import { actionHeadersMiddleware, isActionRequest } from '../infrastructure/http/middleware/action-headers.middleware.js';
import { ridePageMiddleware } from '../infrastructure/http/middleware/ride-page.middleware.js';
import { PrismaService } from '../infrastructure/prisma/prisma.service.js';
import { JsonLogger } from '../infrastructure/logging/json-logger.js';

export const EDITOR_BODY_LIMIT = '256kb';

/** What every running app needs besides its modules – shared by main.ts and the tests so they boot identically. */
export function configureApp(app: INestApplication): void {
  const env = app.get(EnvService, { strict: false });
  const logger = app.get(JsonLogger, { strict: false });
  const prisma = app.get(PrismaService, { strict: false });
  app.useLogger(logger);   // JSON lines in production (`npm run ops -- logs`), and the in-memory ring the admin page reads
  // behind a reverse proxy (Railway / Fly) req.ip would be the proxy's: tell Express how many hops to trust, or every rider shares one rate-limit bucket
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', env.trustProxy);
  // before the allowlist: a phone wallet's Solana Pay POST, and a blink, are not one of our origins. Each path sets `*` itself and answers OPTIONS here.
  app.use(solanaPayCors);
  app.use(actionHeadersMiddleware);
  // the game and the lobby call the API from sibling origins (ride.* / the apex): exact-origin allowlist + credentials (the session cookie); no wildcard
  if (env.corsOrigins.length > 0) app.use(browserCors(env));
  app.use(compression());   // text (HTML, JS, CSS, JSON) over 1 kB is gzipped; images are already compressed and pass through untouched
  app.use(requestIdMiddleware);
  app.use(requestLogMiddleware(logger));   // after the request id: every API line carries it
  app.use(legacySessionMiddleware(env));   // production: expire the apex-wide session cookie of before H7-B
  app.use(jsonOnlyMiddleware);   // a form / text/plain POST is a 415 (no CORS preflight – the login-CSRF shape), but for the beacon routes
  app.use(beaconBodyMiddleware);   // a closing game tab's /end beacon (text/plain JSON) – before Nest's own JSON parser
  // the model editor sends whole entity files (≤ 64 KB of source, JSON-escaped, plus the message): 256 KB there only – Nest's own parser keeps its 100 KB default elsewhere
  // (wrapped: Nest skips its own global JSON parser when it finds a middleware NAMED jsonParser – the bare body-parser function would switch it off everywhere)
  const editorJson = json({ limit: EDITOR_BODY_LIMIT });
  app.use('/api/editor', function editorBodyParser(req: Request, res: Response, next: NextFunction) { editorJson(req, res, next); });
  app.use(ridePageMiddleware(prisma, env));   // public ride page (/r/:id) with dynamic Twitter Cards & OpenGraph tags
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
}

/** The credentialed allowlist, same answers the `cors` package gave Nest's enableCors. Action paths skip it: `*` plus credentials is illegal. */
export function browserCors(env: EnvService) {
  const allowed = new Set(env.corsOrigins), ownOrigin = new Set([env.adminHost, env.editorHost].filter((h): h is string => !!h));
  return function browserCors(req: Request, res: Response, next: NextFunction): void {
    if (isActionRequest(req)) { next(); return; }
    // the admin page and the model editor (storybook) are same-origin with their API: no other origin may READ an answer with their cookie (audit M4 – sign-ins with IPs)
    if (ownOrigin.has(String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase())) { next(); return; }
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
