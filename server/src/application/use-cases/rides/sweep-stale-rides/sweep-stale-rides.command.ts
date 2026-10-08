/** End every running ride whose tab vanished (no heartbeat for HB_TIMEOUT_MS) – run by StaleRideScheduler. */
export class SweepStaleRidesCommand {}

export interface SweepStaleRidesResultDto {
  /** rides this sweep ended (failed · heartbeat lost) */
  ended: number;
  /** stale when listed, but fine (a late heartbeat) or already ended by the time the sweep held their lock */
  skipped: number;
}
