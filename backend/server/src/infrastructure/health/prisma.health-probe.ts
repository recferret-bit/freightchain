import { Injectable } from '@nestjs/common';
import { HealthProbePort } from '../../application/ports/health/health-probe.port.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PrismaHealthProbe extends HealthProbePort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async pingDatabase(): Promise<number> {
    const start = performance.now(); // a duration, not a timestamp – the monotonic timer
    await this.prisma.$queryRaw`SELECT 1`;
    return Math.round(performance.now() - start);
  }
}
