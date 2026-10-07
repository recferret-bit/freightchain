import { Module, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ServeStaticModule } from '@nestjs/serve-static';
import { config } from './config.js';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SolanaModule } from './solana/solana.module.js';
import { PoolModule } from './pool/pool.module.js';
import { AchievementsModule } from './achievements/achievements.service.js';
import { LobbyModule } from './lobby/lobby.module.js';
import { RidesModule } from './rides/rides.module.js';

/* The game / pages live in ../client and the landing's Vite build in ../landing/dist; both are served by this process, so the session cookie is same-origin (no CORS).
   The landing root comes first and only answers `/` + its own hashed assets (renderPath '/'); everything else falls through to client/. Without a build, / is a 404 – say so. */
const landingBuilt = existsSync(join(config.landingDir, 'index.html'));
if (!landingBuilt) new Logger('AppModule').warn(`no landing build at ${config.landingDir} – / will 404 (run: npm run landing:build)`);
@Module({
  imports: [
    DbModule, SolanaModule, PoolModule, AchievementsModule, AuthModule, RidesModule, LobbyModule,
    ...(landingBuilt ? [ServeStaticModule.forRoot({ rootPath: config.landingDir, renderPath: '/', exclude: ['/api/{*path}'] })] : []),
    ServeStaticModule.forRoot({ rootPath: config.clientDir, exclude: ['/api/{*path}'] }),
  ],
})
export class AppModule {}
