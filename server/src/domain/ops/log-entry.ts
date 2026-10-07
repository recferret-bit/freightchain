export type LogLevel = 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';

/** One log line, as the server writes it to stdout (JSON in production) and keeps in its in-memory ring for the admin page. */
export interface LogEntry {
  /** ISO time from ClockPort */
  time: string;
  level: LogLevel;
  context: string;
  msg: string;
  /** structured fields: event, requestId, wallet, rideId, status, ms, … */
  [field: string]: unknown;
}

export interface LogFilter {
  limit: number;
  /** only this level and worse (error < warn < log …) */
  minLevel?: LogLevel;
  /** substring match on the whole line (request id, wallet, ride id, words) */
  text?: string;
}

/** Most severe first: a filter for `warn` keeps fatal, error and warn. */
export const LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
export const atLeast = (level: LogLevel, min: LogLevel): boolean => LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(min);
