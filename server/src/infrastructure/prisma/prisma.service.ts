import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      // start even if the database is briefly unreachable – /api/health/ready reports it
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
