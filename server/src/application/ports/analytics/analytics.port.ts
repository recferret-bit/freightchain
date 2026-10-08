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

export abstract class AnalyticsPort {
  /** Enqueue. Never throws. Never returns a promise to the caller. */
  abstract capture(event: AnalyticsEvent): void;
  /** False when POSTHOG_ENABLED is unset, `0`, or `false`, the key is missing or not a `phc_` token, or the kill switch is on. The relay answers `{ enabled: false }` without queueing. */
  abstract enabled(): boolean;
}
