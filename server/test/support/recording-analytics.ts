import { AnalyticsPort, type AnalyticsEvent, type ExceptionCapture } from '../../src/application/ports/analytics/analytics.port.js';

/** Records what a handler enqueued. `capture` can be told to throw, the way a broken adapter must not. */
export class RecordingAnalytics extends AnalyticsPort {
  readonly events: AnalyticsEvent[] = [];
  readonly exceptions: ExceptionCapture[] = [];
  on = true;
  throwOnCapture = false;
  /** Throws from `capture` only, after `captureException` has already queued. */
  throwOnEvent = false;

  capture(event: AnalyticsEvent): void {
    if (this.throwOnCapture || this.throwOnEvent) throw new Error('analytics capture failed');
    if (!this.on) return;
    this.events.push(event);
  }

  captureException(report: ExceptionCapture): void {
    if (this.throwOnCapture) throw new Error('analytics capture failed');
    if (!this.on) return;
    this.exceptions.push(report);
  }

  enabled(): boolean { return this.on; }

  named(event: string): AnalyticsEvent[] { return this.events.filter((e) => e.event === event); }
}
