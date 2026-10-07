export abstract class HealthProbePort {
  /** Round-trip to the database in ms; rejects when it is unreachable. */
  abstract pingDatabase(): Promise<number>;
}
