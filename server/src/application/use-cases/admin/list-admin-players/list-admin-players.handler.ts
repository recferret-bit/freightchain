import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminListDto, AdminPlayerRowDto } from '../../../../domain/admin/admin.dto.js';
import { AdminDirectoryPort } from '../../../ports/admin/admin-directory.port.js';
import { ListAdminPlayersQuery } from './list-admin-players.query.js';

/** The riders, newest first (optionally those whose wallet starts with `q`): balances, rides driven, the last sign-in. */
@QueryHandler(ListAdminPlayersQuery)
export class ListAdminPlayersHandler implements IQueryHandler<ListAdminPlayersQuery, AdminListDto<AdminPlayerRowDto>> {
  constructor(private readonly directory: AdminDirectoryPort) {}

  async execute({ limit, q }: ListAdminPlayersQuery): Promise<AdminListDto<AdminPlayerRowDto>> {
    return { rows: await this.directory.players(q, limit) };
  }
}
