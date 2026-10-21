import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminActionDto, AdminListDto } from '../../../../domain/admin/admin.dto.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { ListAdminActionsQuery } from './list-admin-actions.query.js';

/** The admin audit log, newest first. A read of it is itself an audit row, written after the snapshot. */
@QueryHandler(ListAdminActionsQuery)
export class ListAdminActionsHandler implements IQueryHandler<ListAdminActionsQuery, AdminListDto<AdminActionDto>> {
  constructor(
    private readonly audit: AdminActionRepositoryPort,
    @Optional() private readonly clock?: ClockPort,
  ) {}

  async execute({ limit, actor }: ListAdminActionsQuery): Promise<AdminListDto<AdminActionDto>> {
    const rows = await this.audit.recent(limit);
    if (actor && this.clock) {
      await this.audit.insert({
        wallet: actor, action: 'read.audit', target: 'actions', role: 'admin', requestId: null, at: this.clock.now(),
        beforeState: null, afterState: { limit, rows: rows.length }, detail: {},
      });
    }
    return { rows: rows.map((a) => ({ ...a, at: a.at.getTime() })) };
  }
}
