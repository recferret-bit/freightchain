import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EnvModule } from '../infrastructure/config/env.module.js';
import { EnvService } from '../infrastructure/config/env.service.js';
import { throttlerOptions } from '../infrastructure/http/throttling.js';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { TokenSignerPort } from '../application/ports/auth/token-signer.port.js';
import { PresentationModule } from '../presentation/presentation.module.js';

/** The composition root: environment, rate limiting, the site (client/) served from the same origin as the API, and the presentation layer. */
@Module({
  imports: [
    EnvModule,
    ThrottlerModule.forRootAsync({ imports: [InfrastructureModule], inject: [EnvService, TokenSignerPort], useFactory: throttlerOptions }),
    ServeStaticModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => [{ rootPath: env.clientDir, exclude: ['/api/{*path}'] }],
    }),
    PresentationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
