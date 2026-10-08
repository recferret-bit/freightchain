import { AnalyticsPort, type AnalyticsEvent } from '../../src/application/ports/analytics/analytics.port.js';

/** Records what a handler enqueued. `capture` can be told to throw, the way a broken adapter must not. */
export class RecordingAnalytics extends AnalyticsPort {
  readonly events: AnalyticsEvent[] = [];
  on = true;
  throwOnCapture = false;

  capture(event: AnalyticsEvent): void {
    if (this.throwOnCapture) throw new Error('analytics capture failed');
    if (!this.on) return;
    this.events.push(event);
  }

  enabled(): boolean { return this.on; }

  named(event: string): AnalyticsEvent[] { return this.events.filter((e) => e.event === event); }
}
