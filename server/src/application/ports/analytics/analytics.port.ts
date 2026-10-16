/** A property PostHog will store. Integers only – a float is a client-relay drop, never a server property. */
export type AnalyticsValue = string | number | boolean | null;

export interface AnalyticsEvent {
  event: string;
  distinctId: string;
  /** UUID v5 of `dedupeKey`, or null so PostHog assigns one. Never a semantic string. */
  uuid: string | null;
  /** Operator key, sent only as property `dedupe_key`. Not the capture uuid. */
  dedupeKey: string | null;
  /** Row time when the row has one; else the ClockPort instant the caller already holds. */
  timestamp: Date;
  set?: Record<string, AnalyticsValue>;
  setOnce?: Record<string, AnalyticsValue>;
  properties: Record<string, AnalyticsValue>;
}

/** One frame of a browser stack. `inApp` is false for a CDN script. */
export interface ExceptionFrame {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  inApp: boolean;
}

/** An unhandled browser crash. Nested `$exception_list` is built only in the adapter, never on a product event. */
export interface ExceptionCapture {
  distinctId: string;
  timestamp: Date;
  surface: string;
  release: string | null;
  type: string;
  value: string;
  frames: readonly ExceptionFrame[];
}

export abstract class AnalyticsPort {
  /** Enqueue. Never throws. Never returns a promise to the caller. */
  abstract capture(event: AnalyticsEvent): void;
  /** Enqueue one `$exception`. Same flush as `capture`. Never throws into the caller. */
  abstract captureException(report: ExceptionCapture): void;
  /** False when POSTHOG_ENABLED is unset, `0`, or `false`, the key is missing or not a `phc_` token, or the kill switch is on. The relay answers `{ enabled: false }` without queueing. */
  abstract enabled(): boolean;
}
