/** TELEMETRY_V21. off keeps the v1 hash chain. shadow issues a session key. enforce adds the named streams and rejects pause abuse. */
export type TelemetryV21Mode = 'off' | 'shadow' | 'enforce';

export abstract class TelemetryConfigPort {
  abstract mode(): TelemetryV21Mode;
}
