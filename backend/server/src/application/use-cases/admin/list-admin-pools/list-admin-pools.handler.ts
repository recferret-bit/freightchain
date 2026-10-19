import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminListDto, AdminPoolRowDto } from '../../../../domain/admin/admin.dto.js';
import { AdminDirectoryPort } from '../../../ports/admin/admin-directory.port.js';
import { ListAdminPoolsQuery } from './list-admin-pools.query.js';

/** The server's mirror of the on-chain pools, newest first. Read-only: the money is in the program, every wallet signs its own transaction. */
@QueryHandler(ListAdminPoolsQuery)
export class ListAdminPoolsHandler implements IQueryHandler<ListAdminPoolsQuery, AdminListDto<AdminPoolRowDto>> {
  constructor(private readonly directory: AdminDirectoryPort) {}

  async execute({ limit }: ListAdminPoolsQuery): Promise<AdminListDto<AdminPoolRowDto>> {
    return { rows: await this.directory.pools(limit) };
  }
}
