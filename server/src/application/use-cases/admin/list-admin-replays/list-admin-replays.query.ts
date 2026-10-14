import type { AdminReplayFilter } from '../../../../domain/admin/admin.dto.js';

export class ListAdminReplaysQuery {
  constructor(public readonly filter: AdminReplayFilter) {}
}
