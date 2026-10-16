import type { LogEntry, LogFilter } from '../../../domain/ops/log-entry.js';

/** The server's own recent log lines (shared Redis ring when configured, in-memory ring otherwise – the durable copy is the container log, `npm run ops -- logs`). */
export abstract class LogBufferPort {
  /** newest first */
  abstract recent(filter: LogFilter): LogEntry[] | Promise<LogEntry[]>;
}
