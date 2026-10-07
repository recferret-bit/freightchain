import { Global, Module } from '@nestjs/common';
import { PoolService } from './pool.service.js';
import { PublicController } from './public.controller.js';

@Global()
@Module({ controllers: [PublicController], providers: [PoolService], exports: [PoolService] })
export class PoolModule {}
