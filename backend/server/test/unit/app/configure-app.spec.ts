import type { INestApplication } from '@nestjs/common';
import { configureApp } from '../../../src/app/configure-app.js';
import { EnvService } from '../../../src/infrastructure/config/env.service.js';

/** configureApp is the one place every app (main.ts and the HTTP harness) gets its middleware and logger: compression in front of the request id,
    the request log after it (so every line carries the id), and the JSON logger installed as the app's logger. */
describe('configureApp', () => {
  it('installs the JSON logger, gzip compression, the request id, the request log, then the beacon body parser', () => {
    const used: string[] = [];
    const logger = { log: () => undefined };
    let installed: unknown = null;
    const app = {
      get: (token: unknown) => (token === EnvService ? ({ trustProxy: 0, corsOrigins: [], isProduction: false } as unknown as EnvService) : logger),
      useLogger: (l: unknown) => { installed = l; },
      getHttpAdapter: () => ({ getInstance: () => ({ set: () => undefined }) }),
      use: (...args: unknown[]) => { used.push(typeof args[0] === 'string' ? `${args[0]} ${(args[1] as { name: string }).name}` : (args[0] as { name: string }).name); },
      useGlobalFilters: () => undefined,
      enableCors: () => undefined,
      enableShutdownHooks: () => undefined,
    } as unknown as INestApplication;
    configureApp(app);
    expect(used).toEqual(['solanaPayCors', 'actionHeadersMiddleware', 'compression', 'requestIdMiddleware', 'requestLog', 'legacySession', 'jsonOnlyMiddleware', 'beaconBodyMiddleware', '/api/editor editorBodyParser', 'ridePageMiddleware']);
    expect(installed).toBe(logger);
  });
});
