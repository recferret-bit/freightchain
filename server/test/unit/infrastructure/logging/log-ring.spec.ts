import { LogRing } from '../../../../src/infrastructure/logging/log-ring.js';
import type { LogEntry, LogLevel } from '../../../../src/domain/ops/log-entry.js';

const entry = (i: number, level: LogLevel = 'log', extra: Record<string, unknown> = {}): LogEntry => ({ time: `t${i}`, level, context: 'X', msg: `m${i}`, ...extra });

describe('LogRing', () => {
  it('keeps the newest `capacity` entries, newest first, and honours the limit', () => {
    const ring = new LogRing(3);
    for (let i = 1; i <= 5; i++) ring.push(entry(i));
    expect(ring.recent({ limit: 10 }).map((e) => e.msg)).toEqual(['m5', 'm4', 'm3']);
    expect(ring.recent({ limit: 2 }).map((e) => e.msg)).toEqual(['m5', 'm4']);
    expect(new LogRing(3).recent({ limit: 5 })).toEqual([]);
  });

  it('filters by minimum level and by text anywhere in the entry (case-insensitive)', () => {
    const ring = new LogRing(10);
    ring.push(entry(1, 'log', { wallet: 'AbcWallet' }));
    ring.push(entry(2, 'warn'));
    ring.push(entry(3, 'error', { requestId: 'req-123' }));
    ring.push(entry(4, 'debug'));
    expect(ring.recent({ limit: 10, minLevel: 'warn' }).map((e) => e.msg)).toEqual(['m3', 'm2']);
    expect(ring.recent({ limit: 10, text: 'abcwallet' }).map((e) => e.msg)).toEqual(['m1']);
    expect(ring.recent({ limit: 10, text: 'REQ-123', minLevel: 'error' }).map((e) => e.msg)).toEqual(['m3']);
  });
});
