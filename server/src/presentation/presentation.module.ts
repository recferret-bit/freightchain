import { Module } from '@nestjs/common';
import { ApplicationModule } from '../application/application.module.js';
import { AuthHttpController } from './auth/auth.http.controller.js';
import { ChainHttpController } from './chain/chain.http.controller.js';
import { EconomyHttpController } from './economy/economy.http.controller.js';
import { HealthHttpController } from './health/health.http.controller.js';
import { LobbyHttpController } from './lobby/lobby.http.controller.js';
import { RidesHttpController } from './rides/rides.http.controller.js';

import { PoolsHttpController } from './economy/pools.http.controller.js';
import { TicketsHttpController } from './economy/tickets.http.controller.js';
@Module({
  imports: [ApplicationModule],
  controllers: [HealthHttpController, AuthHttpController, RidesHttpController, EconomyHttpController, PoolsHttpController, TicketsHttpController, LobbyHttpController, ChainHttpController],
})
export class PresentationModule {}
