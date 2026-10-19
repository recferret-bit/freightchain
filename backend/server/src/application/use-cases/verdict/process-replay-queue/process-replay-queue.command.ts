import type { ReplayQueueProcessResult } from '../../../services/verdict.service.js';

export type { ReplayQueueProcessResult };

export class ProcessReplayQueueCommand {
  constructor(
    readonly limit = 10,
    readonly concurrency = 4,
    readonly rideId: string | null = null,
  ) {}
}
