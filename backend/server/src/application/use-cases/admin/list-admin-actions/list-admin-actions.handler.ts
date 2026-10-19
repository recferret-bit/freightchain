import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminActionDto, AdminListDto } from '../../../../domain/admin/admin.dto.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { ListAdminActionsQuery } from './list-admin-actions.query.js';

/** The admin audit log, newest first. */
@QueryHandler(ListAdminActionsQuery)
export class ListAdminActionsHandler implements IQueryHandler<ListAdminActionsQuery, AdminListDto<AdminActionDto>> {
  constructor(private readonly audit: AdminActionRepositoryPort) {}

  async execute({ limit }: ListAdminActionsQuery): Promise<AdminListDto<AdminActionDto>> {
    return { rows: (await this.audit.recent(limit)).map((a) => ({ ...a, at: a.at.getTime() })) };
  }
}
