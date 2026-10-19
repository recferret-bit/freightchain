import { Global, Module } from '@nestjs/common';
import { EnvService } from './env.service.js';

/** The environment, validated once per app instance and available everywhere. */
@Global()
@Module({ providers: [EnvService], exports: [EnvService] })
export class EnvModule {}
