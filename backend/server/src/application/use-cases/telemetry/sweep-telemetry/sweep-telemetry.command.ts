export class SweepTelemetryCommand {}

export interface SweepTelemetryResultDto {
  /** rides that ended before this (epoch ms) lost their recording; null = retention is off (TELEMETRY_RETENTION_DAYS=0) */
  cutoff: number | null;
  /** batches deleted */
  deleted: number;
}
