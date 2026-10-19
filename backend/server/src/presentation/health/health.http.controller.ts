import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { GetLivenessQuery, type LivenessDto } from '../../application/use-cases/health/get-liveness/get-liveness.query.js';
import { GetReadinessQuery, type ReadinessDto } from '../../application/use-cases/health/get-readiness/get-readiness.query.js';

@Controller('api/health')
export class HealthHttpController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('live')
  live(): Promise<LivenessDto> {
    return this.queryBus.execute<GetLivenessQuery, LivenessDto>(new GetLivenessQuery());
  }

  /** 200 when the database answers; 503 problem+json (with the failing checks) when it does not. */
  @Get('ready')
  async ready(): Promise<ReadinessDto> {
    const result = await this.queryBus.execute<GetReadinessQuery, ReadinessDto>(new GetReadinessQuery());
    if (result.status === 'degraded') throw new ServiceUnavailableError('Readiness degraded', result.checks);
    return result;
  }
}
