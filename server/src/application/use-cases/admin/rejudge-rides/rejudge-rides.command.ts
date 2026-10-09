import type { RejudgeFilter } from '../../../ports/rides/ride-query.port.js';

/** Bulk re-judge (CLI `verdict:rejudge`): every completed shift the filter selects is judged again at the CURRENT rules. `dryRun` only lists them. */
export class RejudgeRidesCommand {
  constructor(
    public readonly filter: RejudgeFilter,
    public readonly dryRun: boolean,
    /** who ran it – goes into the audit row */
    public readonly by: string,
  ) {}
}

export interface RejudgeRidesResultDto {
  dryRun: boolean;
  scanned: number;
  judged: number;
  /** rides whose status changed: from the verdict before (null = none) to the one now */
  changed: { id: string; from: string | null; to: string }[];
  /** admin-decided verdicts (kept) and rides whose recording the retention sweep deleted */
  skipped: number;
  rulesVersion: number;
}
