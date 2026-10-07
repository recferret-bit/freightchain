import { Global, Module } from '@nestjs/common';
import { PriceService } from './price.service.js';
import { ChainService } from './chain.service.js';

@Global()
@Module({ providers: [PriceService, ChainService], exports: [PriceService, ChainService] })
export class SolanaModule {}
