import { Module } from '@nestjs/common';
import { LobbyController } from './lobby.controller.js';
import { LobbyService } from './lobby.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({ imports: [AuthModule, UsersModule], controllers: [LobbyController], providers: [LobbyService] })
export class LobbyModule {}
