import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule, type ServeStaticModuleOptions } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EnvModule } from '../infrastructure/config/env.module.js';
import { EnvService } from '../infrastructure/config/env.service.js';
import { staticHeaders } from '../infrastructure/http/static-cache.js';
import { throttlerOptions } from '../infrastructure/http/throttling.js';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { DailyFreeRideScheduler } from '../infrastructure/scheduling/daily-free-ride.scheduler.js';
import { ProgramWatcher } from '../infrastructure/scheduling/program-watcher.js';
import { ApplicationModule } from '../application/application.module.js';
import { TokenSignerPort } from '../application/ports/auth/token-signer.port.js';
import { PresentationModule } from '../presentation/presentation.module.js';

/** The site roots, first match wins: the landing's Vite build (answers `/` and its own fingerprinted /assets, /media) in front of client/ (lobby, game, viewer). Without a landing build, `/` is client/index.html. */
export function siteRoots(env: EnvService): ServeStaticModuleOptions[] {
  const exclude = ['/api/{*path}'], serveStaticOptions = { setHeaders: staticHeaders };
  const landing = existsSync(join(env.landingDir, 'index.html'));
  if (!landing) new Logger('AppModule').warn(`no landing build at ${env.landingDir} – / is the placeholder client/index.html (run: npm run landing:build)`);
  return [...(landing ? [{ rootPath: env.landingDir, renderPath: '/', exclude, serveStaticOptions }] : []), { rootPath: env.clientDir, exclude, serveStaticOptions }];
}

/** The composition root: environment, rate limiting, the midnight free-ride job, the program watcher (WATCH_INTERVAL_MS), the site served from the same origin as the API, and the presentation layer. */
@Module({
  imports: [
    EnvModule,
    ThrottlerModule.forRootAsync({ imports: [InfrastructureModule], inject: [EnvService, TokenSignerPort], useFactory: throttlerOptions }),
    ServeStaticModule.forRootAsync({
      inject: [EnvService],
      useFactory: siteRoots,
    }),
    ApplicationModule, // the scheduler dispatches on its bus
    PresentationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, DailyFreeRideScheduler, ProgramWatcher],
})
export class AppModule {}
