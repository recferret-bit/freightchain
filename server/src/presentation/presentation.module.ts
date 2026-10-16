import { Module } from '@nestjs/common';
import { ApplicationModule } from '../application/application.module.js';
import { AdminHttpController } from './admin/admin.http.controller.js';
import { AuthHttpController } from './auth/auth.http.controller.js';
import { ChainHttpController } from './chain/chain.http.controller.js';
import { EconomyHttpController } from './economy/economy.http.controller.js';
import { HealthHttpController } from './health/health.http.controller.js';
import { LobbyHttpController } from './lobby/lobby.http.controller.js';
import { StatsHttpController } from './stats/stats.http.controller.js';
import { RidesHttpController } from './rides/rides.http.controller.js';
import { PublicRidesHttpController } from './rides/public-rides.http.controller.js';
import { TelemetryHttpController } from './telemetry/telemetry.http.controller.js';

import { PoolsHttpController } from './economy/pools.http.controller.js';
import { TicketsHttpController } from './economy/tickets.http.controller.js';
import { ChainWebhookHttpController } from './chain/chain-webhook.http.controller.js';
import { AdminPromosHttpController } from './admin/admin-promos.http.controller.js';
import { GarageHttpController } from './economy/garage.http.controller.js';
import { PromosHttpController } from './economy/promos.http.controller.js';
import { LiveHttpController } from './live/live.http.controller.js';
import { AdminDirectoryHttpController } from './admin/admin-directory.http.controller.js';
import { AdminSettingsHttpController } from './admin/admin-settings.http.controller.js';
import { AdminPoolsHttpController } from './admin/admin-pools.http.controller.js';
import { SnsHttpController } from './sns/sns.http.controller.js';
import { SolanaPayHttpController } from './solana-pay/solana-pay.http.controller.js';
import { ActionsHttpController } from './actions/actions.http.controller.js';
import { PledgesHttpController } from './economy/pledges.http.controller.js';
import { HonkHttpController } from './honk/honk.http.controller.js';
import { EntitiesHttpController } from './entities/entities.http.controller.js';
import { EditorAuthHttpController } from './editor/editor-auth.http.controller.js';
import { EditorEntitiesHttpController } from './editor/editor-entities.http.controller.js';
import { EditorJobsHttpController } from './editor/editor-jobs.http.controller.js';
import { EditorMcpHttpController } from './editor/editor-mcp.http.controller.js';
@Module({
  imports: [ApplicationModule],
  controllers: [HealthHttpController, AuthHttpController, RidesHttpController, PublicRidesHttpController, EconomyHttpController, PoolsHttpController, TicketsHttpController, LobbyHttpController, StatsHttpController, ChainHttpController, ChainWebhookHttpController, AdminHttpController, AdminPromosHttpController, AdminSettingsHttpController, AdminDirectoryHttpController, PromosHttpController, GarageHttpController, LiveHttpController, TelemetryHttpController, AdminPoolsHttpController, SolanaPayHttpController, ActionsHttpController, PledgesHttpController, SnsHttpController, HonkHttpController, EntitiesHttpController, EditorAuthHttpController, EditorEntitiesHttpController, EditorJobsHttpController, EditorMcpHttpController],
})
export class PresentationModule {}
