import { atLeast, type LogEntry, type LogFilter } from '../../domain/ops/log-entry.js';

export const LOG_RING_SIZE = 5000;

/** A fixed-size ring of the newest log entries (one per process; the admin page reads it). */
export class LogRing {
  private readonly items: (LogEntry | undefined)[];
  private next = 0;
  private count = 0;

  constructor(private readonly capacity = LOG_RING_SIZE) {
    this.items = Array.from<LogEntry | undefined>({ length: capacity });
  }

  push(entry: LogEntry): void {
    this.items[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** newest first, filtered, at most `limit` */
  recent({ limit, minLevel, text }: LogFilter): LogEntry[] {
    const out: LogEntry[] = [];
    const needle = text?.toLowerCase();
    for (let i = 1; i <= this.count && out.length < limit; i++) {
      const entry = this.items[(this.next - i + this.capacity) % this.capacity];
      if (!entry) continue;
      if (minLevel && !atLeast(entry.level, minLevel)) continue;
      if (needle && !JSON.stringify(entry).toLowerCase().includes(needle)) continue;
      out.push(entry);
    }
    return out;
  }
}
