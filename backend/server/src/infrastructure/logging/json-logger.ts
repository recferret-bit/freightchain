import { Inject, Injectable, Optional, type LoggerService } from '@nestjs/common';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import type { LogEntry, LogLevel } from '../../domain/ops/log-entry.js';
import { EnvService } from '../config/env.service.js';
import { LogRing } from './log-ring.js';

/** What a line is written to – stdout by default; a test passes its own. */
export type LogSink = (line: string) => void;
export const LOG_SINK = Symbol('LOG_SINK');

/**
 * The app's logger (installed by configureApp): ONE JSON object per line in production – `{time, level, context, msg, …fields}` – so the container log
 * can be grepped and parsed (`npm run ops -- logs`, the prod-logs skill); a readable one-liner elsewhere. Every entry also goes into the in-memory
 * ring the admin page reads. Time comes from ClockPort (the only clock). A message that is an object is merged in as structured fields.
 */
@Injectable()
export class JsonLogger implements LoggerService {
  private readonly json: boolean;

  private readonly sink: LogSink;

  constructor(
    private readonly clock: ClockPort,
    private readonly ring: LogRing,
    env: EnvService,
    @Optional() @Inject(LOG_SINK) sink?: LogSink,
  ) {
    this.json = env.isProduction;
    this.sink = sink ?? ((line) => { process.stdout.write(`${line}\n`); });
  }

  log(message: unknown, ...params: unknown[]): void { this.write('log', message, params); }
  warn(message: unknown, ...params: unknown[]): void { this.write('warn', message, params); }
  debug(message: unknown, ...params: unknown[]): void { this.write('debug', message, params); }
  verbose(message: unknown, ...params: unknown[]): void { this.write('verbose', message, params); }
  fatal(message: unknown, ...params: unknown[]): void { this.write('fatal', message, params); }
  /** Nest calls error(message, stack?, context?) */
  error(message: unknown, ...params: unknown[]): void { this.write('error', message, params); }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    const rest = [...params];
    const context = rest.length > 0 && typeof rest.at(-1) === 'string' ? String(rest.pop()) : 'App';
    const stack = level === 'error' || level === 'fatal' ? rest.find((p): p is string => typeof p === 'string' && p.includes('\n')) : undefined;
    const entry: LogEntry = { time: this.clock.now().toISOString(), level, context, msg: '' };
    if (message instanceof Error) Object.assign(entry, { msg: message.message, stack: message.stack });
    else if (message !== null && typeof message === 'object') {
      const { msg, ...fields } = message as Record<string, unknown>;
      Object.assign(entry, fields, { msg: typeof msg === 'string' ? msg : '' });
    } else entry.msg = String(message);
    entry.time = this.clock.now().toISOString(); // Structured fields cannot bypass log retention.
    if (stack) entry['stack'] = stack;
    this.ring.push(entry);
    this.sink(this.json ? JSON.stringify(entry) : this.pretty(entry));
  }

  private pretty(e: LogEntry): string {
    const { time, level, context, msg, ...fields } = e;
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
    return `${time} ${level.toUpperCase().padEnd(5)} [${context}] ${msg}${extra}`;
  }
}
