import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { GetLivenessQuery, type LivenessDto } from './get-liveness.query.js';

/** The process is up and the CQRS bus dispatches – deliberately no I/O (that is readiness). */
@QueryHandler(GetLivenessQuery)
export class GetLivenessHandler implements IQueryHandler<GetLivenessQuery, LivenessDto> {
  async execute(): Promise<LivenessDto> {
    return { status: 'ok' };
  }
}
