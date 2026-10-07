import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminLogsDto } from '../../../../domain/admin/admin.dto.js';
import { LogBufferPort } from '../../../ports/ops/log-buffer.port.js';
import { GetAdminLogsQuery } from './get-admin-logs.query.js';

/** The newest log lines of THIS server process (in-memory ring, lost on restart), filtered by level and text (a request id, a wallet, a ride id…). */
@QueryHandler(GetAdminLogsQuery)
export class GetAdminLogsHandler implements IQueryHandler<GetAdminLogsQuery, AdminLogsDto> {
  constructor(private readonly logs: LogBufferPort) {}

  async execute({ filter }: GetAdminLogsQuery): Promise<AdminLogsDto> {
    return { entries: this.logs.recent(filter) };
  }
}
