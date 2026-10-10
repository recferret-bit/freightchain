import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AdminQueryPort } from '../../../ports/admin/admin-query.port.js';
import { GetAdminQueueCountQuery } from './get-admin-queue-count.query.js';

/** The REVIEW QUEUE badge, asked on every tab change, so counts and not the list: `underReview` = the queue (every paid ride under review + the flagged free ones), `flagged` = flagged verdicts. */
@QueryHandler(GetAdminQueueCountQuery)
export class GetAdminQueueCountHandler implements IQueryHandler<GetAdminQueueCountQuery, { flagged: number; underReview: number }> {
  constructor(private readonly admin: AdminQueryPort) {}

  async execute(): Promise<{ flagged: number; underReview: number }> {
    const [flagged, underReview] = await Promise.all([this.admin.flaggedCount(), this.admin.queueCount()]);
    return { flagged, underReview };
  }
}
