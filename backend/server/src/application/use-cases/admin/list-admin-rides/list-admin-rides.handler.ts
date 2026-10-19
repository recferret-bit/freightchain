import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminListDto, AdminRideRowDto } from '../../../../domain/admin/admin.dto.js';
import { AdminQueryPort } from '../../../ports/admin/admin-query.port.js';
import { toAdminRideRow } from '../admin-ride-row.js';
import { ListAdminRidesQuery } from './list-admin-rides.query.js';


/** Rides, newest first, filtered by wallet / status / verdict ('none' = never judged) / pool; `review: 'under_review'` = the review queue (paid rides under
    review first – ride-review.ts –, then the flagged free rides). */
@QueryHandler(ListAdminRidesQuery)
export class ListAdminRidesHandler implements IQueryHandler<ListAdminRidesQuery, AdminListDto<AdminRideRowDto>> {
  constructor(private readonly admin: AdminQueryPort) {}

  async execute({ filter }: ListAdminRidesQuery): Promise<AdminListDto<AdminRideRowDto>> {
    return { rows: (await this.admin.rides(filter)).map(toAdminRideRow) };
  }
}
