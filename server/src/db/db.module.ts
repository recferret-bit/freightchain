import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service.js';
import { ClockService } from '../clock.service.js';

@Global()
@Module({ providers: [DbService, ClockService], exports: [DbService, ClockService] })
export class DbModule {}
