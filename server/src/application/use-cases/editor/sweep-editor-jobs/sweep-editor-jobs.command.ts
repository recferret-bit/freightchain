/** Expire elapsed claims, propagate cancellation and discover durable queued jobs. */
export class SweepEditorJobsCommand {}

export interface SweepEditorJobsResultDto {
  failed: number;
}
