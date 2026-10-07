import type { INestApplication } from '@nestjs/common';
import { configureApp } from '../../../src/app/configure-app.js';
import { EnvService } from '../../../src/infrastructure/config/env.service.js';

/** configureApp is the one place every app (main.ts and the HTTP harness) gets its middleware: compression sits in front of the request-id middleware. */
describe('configureApp', () => {
  it('installs gzip compression before the request-id middleware', () => {
    const used: string[] = [];
    const app = {
      get: () => ({ trustProxy: 0, corsOrigins: [] }) as unknown as EnvService,
      getHttpAdapter: () => ({ getInstance: () => ({ set: () => undefined }) }),
      use: (fn: { name: string }) => { used.push(fn.name); },
      useGlobalFilters: () => undefined,
      enableCors: () => undefined,
      enableShutdownHooks: () => undefined,
    } as unknown as INestApplication;
    configureApp(app);
    expect(used).toEqual(['compression', 'requestIdMiddleware']);
  });
});
