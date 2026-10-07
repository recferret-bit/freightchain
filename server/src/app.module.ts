import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { config } from './config.js';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RidesModule } from './rides/rides.module.js';

/* The game / pages live in ../client and are served by this process, so the session cookie is same-origin (no CORS). */
@Module({
  imports: [
    DbModule, AuthModule, RidesModule,
    ServeStaticModule.forRoot({ rootPath: config.clientDir, exclude: ['/api/{*path}'] }),
  ],
})
export class AppModule {}
