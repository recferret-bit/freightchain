import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { HealthProbePort } from '../../../ports/health/health-probe.port.js';
import { GetReadinessQuery, type ReadinessDto } from './get-readiness.query.js';

@QueryHandler(GetReadinessQuery)
export class GetReadinessHandler implements IQueryHandler<GetReadinessQuery, ReadinessDto> {
  constructor(private readonly probe: HealthProbePort) {}

  async execute(): Promise<ReadinessDto> {
    try {
      const latencyMs = await this.probe.pingDatabase();
      return { status: 'ok', checks: { database: { status: 'up', latencyMs } } };
    } catch {
      return { status: 'degraded', checks: { database: { status: 'down' } } };
    }
  }
}
