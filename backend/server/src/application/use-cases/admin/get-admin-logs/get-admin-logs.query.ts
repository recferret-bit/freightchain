import type { LogFilter } from '../../../../domain/ops/log-entry.js';

export class GetAdminLogsQuery {
  constructor(public readonly filter: LogFilter) {}
}
