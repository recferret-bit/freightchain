import type { FinalityPassDto } from '../../../services/finality.service.js';

/** One round of the program-log watcher: settle every new program transaction (oldest first), move the cursor, then the finality pass. */
export class PollProgramCommand {
  constructor(public readonly pageSize = 100) {}
}

export interface PollProgramResultDto {
  /** transactions settled (status done) */
  settled: number;
  /** failed or not pool transactions – the cursor moves past them */
  skipped: number;
  /** the first transaction not visible at the configured commitment yet: the batch stopped there and starts with it next poll (null = none) */
  pendingAt: string | null;
  /** the newest transaction fully handled (null = none yet) */
  cursor: string | null;
  /** transactions a deterministic error stopped (passed over, so one bad transaction cannot block the watcher – the watcher logs them) */
  errors: { signature: string; message: string }[];
  finality: FinalityPassDto;
}
