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
import { TelemetryHttpController } from './telemetry/telemetry.http.controller.js';

import { PoolsHttpController } from './economy/pools.http.controller.js';
import { TicketsHttpController } from './economy/tickets.http.controller.js';
import { ChainWebhookHttpController } from './chain/chain-webhook.http.controller.js';
import { AdminPromosHttpController } from './admin/admin-promos.http.controller.js';
import { GarageHttpController } from './economy/garage.http.controller.js';
import { PromosHttpController } from './economy/promos.http.controller.js';
import { LiveHttpController } from './live/live.http.controller.js';
import { AdminSettingsHttpController } from './admin/admin-settings.http.controller.js';
import { AdminPoolsHttpController } from './admin/admin-pools.http.controller.js';
import { OfflineRidesHttpController } from './offline/offline-rides.http.controller.js';
@Module({
  imports: [ApplicationModule],
  controllers: [HealthHttpController, AuthHttpController, RidesHttpController, EconomyHttpController, PoolsHttpController, TicketsHttpController, LobbyHttpController, StatsHttpController, ChainHttpController, ChainWebhookHttpController, AdminHttpController, AdminPromosHttpController, AdminSettingsHttpController, AdminPoolsHttpController, PromosHttpController, GarageHttpController, LiveHttpController, TelemetryHttpController, OfflineRidesHttpController],
})
export class PresentationModule {}
