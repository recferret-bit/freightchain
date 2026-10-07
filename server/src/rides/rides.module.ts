import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller.js';
import { RidesService } from './rides.service.js';
import { PaymentsService } from './payments.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({ imports: [AuthModule, UsersModule], controllers: [RidesController], providers: [RidesService, PaymentsService] })
export class RidesModule {}
