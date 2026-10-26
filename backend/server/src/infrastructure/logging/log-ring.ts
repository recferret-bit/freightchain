import type { ClockPort } from '../../application/ports/shared/clock.port.js';
import { atLeast, type LogEntry, type LogFilter } from '../../domain/ops/log-entry.js';

export const LOG_RING_SIZE = 5000;
export const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const LOG_SWEEP_MS = 60_000;

export function retainedLog(entry: LogEntry, now: number): boolean {
  const at = Date.parse(entry.time);
  return Number.isFinite(at) && at > now - LOG_RETENTION_MS && at <= now;
}

export function matchesLogFilter(entry: LogEntry, { minLevel, text }: LogFilter, needle = text?.toLowerCase()): boolean {
  if (minLevel && !atLeast(entry.level, minLevel)) return false;
  if (needle && !JSON.stringify(entry).toLowerCase().includes(needle)) return false;
  return true;
}

/** A fixed-size ring of the newest log entries (one per process; mirrored to Redis when configured so the admin page reads all replicas). */
export class LogRing {
  private readonly items: (LogEntry | undefined)[];
  private next = 0;
  private count = 0;
  private listener: ((entry: LogEntry) => void) | null = null;

  constructor(private readonly clock: ClockPort, private readonly capacity = LOG_RING_SIZE) {
    this.items = Array.from<LogEntry | undefined>({ length: capacity });
  }

  onPush(fn: ((entry: LogEntry) => void) | null): void {
    this.listener = fn;
  }

  push(entry: LogEntry): void {
    this.prune();
    if (!retainedLog(entry, this.clock.now().getTime())) return;
    this.items[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.listener?.(entry);
  }

  /** Clear references as well as hiding expired entries from readers. */
  prune(): void {
    const now = this.clock.now().getTime();
    for (let i = 0; i < this.items.length; i++) {
      const entry = this.items[i];
      if (entry && !retainedLog(entry, now)) this.items[i] = undefined;
    }
  }

  /** newest first, filtered, at most `limit` */
  recent(filter: LogFilter): LogEntry[] {
    this.prune();
    const out: LogEntry[] = [];
    const needle = filter.text?.toLowerCase();
    for (let i = 1; i <= this.count && out.length < filter.limit; i++) {
      const entry = this.items[(this.next - i + this.capacity) % this.capacity];
      if (!entry || !matchesLogFilter(entry, filter, needle)) continue;
      out.push(entry);
    }
    return out;
  }
}
