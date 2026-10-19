import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminSessionsDto } from '../../../../domain/admin/admin.dto.js';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { AdminDirectoryPort } from '../../../ports/admin/admin-directory.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { ListAdminSessionsQuery } from './list-admin-sessions.query.js';

/** the most wallets one answer lists */
export const SESSIONS_LIMIT = 500;

/** Sessions are signed cookies, there is no session table: the wallets that signed in within the last `days` days are the ones whose cookie may still be alive. Newest first, one row per wallet. */
@QueryHandler(ListAdminSessionsQuery)
export class ListAdminSessionsHandler implements IQueryHandler<ListAdminSessionsQuery, AdminSessionsDto> {
  constructor(
    private readonly directory: AdminDirectoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ days }: ListAdminSessionsQuery): Promise<AdminSessionsDto> {
    return this.directory.sessions(new Date(this.clock.now().getTime() - days * DAY_MS), SESSIONS_LIMIT);
  }
}
