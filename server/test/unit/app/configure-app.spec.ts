import type { INestApplication } from '@nestjs/common';
import { configureApp } from '../../../src/app/configure-app.js';
import { EnvService } from '../../../src/infrastructure/config/env.service.js';

/** configureApp is the one place every app (main.ts and the HTTP harness) gets its middleware and logger: compression in front of the request id,
    the request log after it (so every line carries the id), and the JSON logger installed as the app's logger. */
describe('configureApp', () => {
  it('installs the JSON logger, gzip compression, the request id, then the request log', () => {
    const used: string[] = [];
    const logger = { log: () => undefined };
    let installed: unknown = null;
    const app = {
      get: (token: unknown) => (token === EnvService ? ({ trustProxy: 0, corsOrigins: [] } as unknown as EnvService) : logger),
      useLogger: (l: unknown) => { installed = l; },
      getHttpAdapter: () => ({ getInstance: () => ({ set: () => undefined }) }),
      use: (fn: { name: string }) => { used.push(fn.name); },
      useGlobalFilters: () => undefined,
      enableCors: () => undefined,
      enableShutdownHooks: () => undefined,
    } as unknown as INestApplication;
    configureApp(app);
    expect(used).toEqual(['compression', 'requestIdMiddleware', 'requestLog']);
    expect(installed).toBe(logger);
  });
});
