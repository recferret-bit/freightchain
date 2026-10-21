/** `deferWave5` is set when the daily scheduler itself prunes inp and raises the trace-cluster alert. */
export class SweepTelemetryCommand {
  constructor(readonly deferWave5 = false) {}
}

export interface SweepTelemetryResultDto {
  /** rides that ended before this (epoch ms) lost their recording; null = retention is off (TELEMETRY_RETENTION_DAYS=0) */
  cutoff: number | null;
  /** batches deleted */
  deleted: number;
}
