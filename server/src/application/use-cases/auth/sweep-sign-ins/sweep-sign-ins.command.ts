/** The daily retention job for the sign-in log (SIGNIN_RETENTION_DAYS): rows older than that are deleted – they hold IP addresses. */
export class SweepSignInsCommand {}

export interface SweepSignInsResultDto {
  /** epoch ms of the cutoff; null = retention is off (0 days) */
  cutoff: number | null;
  deleted: number;
}
