import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AdminQueryPort } from '../../../ports/admin/admin-query.port.js';
import { GetAdminQueueCountQuery } from './get-admin-queue-count.query.js';

/** How many flagged rides wait for a decision – the REVIEW QUEUE badge, asked on every tab change, so it is a count and not the list. */
@QueryHandler(GetAdminQueueCountQuery)
export class GetAdminQueueCountHandler implements IQueryHandler<GetAdminQueueCountQuery, { flagged: number }> {
  constructor(private readonly admin: AdminQueryPort) {}

  async execute(): Promise<{ flagged: number }> {
    return { flagged: await this.admin.flaggedCount() };
  }
}
