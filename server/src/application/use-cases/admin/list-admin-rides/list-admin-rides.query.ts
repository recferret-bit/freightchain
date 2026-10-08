import type { AdminRideFilter } from '../../../../domain/admin/admin.dto.js';

export class ListAdminRidesQuery {
  constructor(public readonly filter: AdminRideFilter) {}
}
