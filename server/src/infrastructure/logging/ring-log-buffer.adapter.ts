import { Injectable } from '@nestjs/common';
import { LogBufferPort } from '../../application/ports/ops/log-buffer.port.js';
import type { LogEntry, LogFilter } from '../../domain/ops/log-entry.js';
import { LogRing } from './log-ring.js';

@Injectable()
export class RingLogBufferAdapter extends LogBufferPort {
  constructor(private readonly ring: LogRing) {
    super();
  }

  recent(filter: LogFilter): LogEntry[] {
    return this.ring.recent(filter);
  }
}
