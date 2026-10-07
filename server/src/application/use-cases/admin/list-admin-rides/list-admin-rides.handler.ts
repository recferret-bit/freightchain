import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminListDto, AdminRideRowDto } from '../../../../domain/admin/admin.dto.js';
import { AdminQueryPort, type AdminRideRow } from '../../../ports/admin/admin-query.port.js';
import { ListAdminRidesQuery } from './list-admin-rides.query.js';

export const toAdminRideRow = (r: AdminRideRow): AdminRideRowDto => ({
  id: r.id, wallet: r.wallet, tier: r.tier, status: r.status, reason: r.reason, route: r.route, distance: Math.round(r.lastS), driveSeconds: Math.round(r.driveSeconds * 10) / 10,
  timeScale: r.timeScale, createdAt: r.createdAt.getTime(), startedAt: r.startedAt?.getTime() ?? null, endedAt: r.endedAt?.getTime() ?? null, verdict: r.verdict, overridden: r.overridden,
});

/** Rides, newest first, filtered by wallet / status / verdict ('flagged' = the review queue, 'none' = never judged). */
@QueryHandler(ListAdminRidesQuery)
export class ListAdminRidesHandler implements IQueryHandler<ListAdminRidesQuery, AdminListDto<AdminRideRowDto>> {
  constructor(private readonly admin: AdminQueryPort) {}

  async execute({ filter }: ListAdminRidesQuery): Promise<AdminListDto<AdminRideRowDto>> {
    return { rows: (await this.admin.rides(filter)).map(toAdminRideRow) };
  }
}
