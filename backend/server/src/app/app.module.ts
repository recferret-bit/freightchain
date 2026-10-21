import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { ServeStaticModule, type ServeStaticModuleOptions } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EnvModule } from '../infrastructure/config/env.module.js';
import { EnvService } from '../infrastructure/config/env.service.js';
import { staticHeaders } from '../infrastructure/http/static-cache.js';
import { throttlerOptions } from '../infrastructure/http/throttling.js';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { ProgramWatcher } from '../infrastructure/scheduling/program-watcher.js';
import { PoolCrankScheduler } from '../infrastructure/scheduling/pool-crank.scheduler.js';
import { AchievementMintScheduler } from '../infrastructure/scheduling/achievement-mint.scheduler.js';
import { PoolPayoutScheduler } from '../infrastructure/scheduling/pool-payout.scheduler.js';
import { TelemetryRetentionScheduler } from '../infrastructure/scheduling/telemetry-retention.scheduler.js';
import { StaleRideScheduler } from '../infrastructure/scheduling/stale-ride.scheduler.js';
import { HonkReleaseScheduler } from '../infrastructure/scheduling/honk-release.scheduler.js';
import { ReplayVerificationScheduler } from '../infrastructure/scheduling/replay-verification.scheduler.js';
import { ApplicationModule } from '../application/application.module.js';
import { EditorTokenPort } from '../application/ports/editor/editor-token.port.js';
import { JobTokenPort } from '../application/ports/editor/job-token.port.js';
import { RateLimitStorage } from '../infrastructure/http/redis-throttler.storage.js';
import { TokenSignerPort } from '../application/ports/auth/token-signer.port.js';
import { PresentationModule } from '../presentation/presentation.module.js';
import { OriginGuard } from '../infrastructure/http/guards/origin.guard.js';
import { PrivilegedSurfaceGuard } from '../infrastructure/http/guards/privileged-surface.guard.js';
import { PrivilegedRouteCheck } from '../infrastructure/http/privileged-route-check.js';
import { DualApprovalInterceptor } from '../infrastructure/http/interceptors/dual-approval.interceptor.js';
import { TelegramAlertScheduler } from '../infrastructure/alerts/telegram-alert.scheduler.js';
import { ZodResponseInterceptor } from '../infrastructure/http/interceptors/zod-response.interceptor.js';

/** The site roots, first match wins: the landing's Vite build (answers `/` and its own fingerprinted /assets, /media) in front of client/ (lobby, game, viewer). Without a landing build, `/` is client/index.html. */
export function siteRoots(env: EnvService): ServeStaticModuleOptions[] {
  const exclude = ['/api/{*path}', '/actions.json', '/.well-known/{*path}'], serveStaticOptions = { setHeaders: staticHeaders }; // blink discovery is a route, not a static file
  const landing = existsSync(join(env.landingDir, 'index.html'));
  if (!landing) new Logger('AppModule').warn(`no landing build at ${env.landingDir} – / is the placeholder client/index.html (run: npm run landing:build)`);
  return [...(landing ? [{ rootPath: env.landingDir, renderPath: '/', exclude, serveStaticOptions }] : []), { rootPath: env.clientDir, exclude, serveStaticOptions }];
}

/** The composition root: environment, rate limiting, the 00:30 recording-retention sweep and the program watcher (WATCH_INTERVAL_MS), the site served from the same origin as the API, and the presentation layer. The daily free-ride job is retired. */
@Module({
  imports: [
    EnvModule,
    ThrottlerModule.forRootAsync({ imports: [InfrastructureModule], inject: [EnvService, TokenSignerPort, EditorTokenPort, JobTokenPort, RateLimitStorage], useFactory: throttlerOptions }),
    ServeStaticModule.forRootAsync({
      inject: [EnvService],
      useFactory: siteRoots,
    }),
    ApplicationModule, // the scheduler dispatches on its bus
    PresentationModule,
    DiscoveryModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: OriginGuard }, { provide: APP_GUARD, useClass: PrivilegedSurfaceGuard }, PrivilegedRouteCheck, { provide: APP_INTERCEPTOR, useClass: ZodResponseInterceptor }, { provide: APP_INTERCEPTOR, useClass: DualApprovalInterceptor }, TelegramAlertScheduler,   // OriginGuard: audit H7 (login CSRF, sibling hosts)
    TelemetryRetentionScheduler, StaleRideScheduler, ReplayVerificationScheduler, ProgramWatcher, PoolCrankScheduler, PoolPayoutScheduler, AchievementMintScheduler, HonkReleaseScheduler],
})
export class AppModule {}
