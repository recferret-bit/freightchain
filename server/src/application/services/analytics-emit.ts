import type { AnalyticsEvent, AnalyticsPort } from '../ports/analytics/analytics.port.js';

/** Call only after the commit await. The factory and capture share one try/catch, so a throw cannot change the command result. */
export function emitAnalytics(port: AnalyticsPort, build: () => AnalyticsEvent): void {
  try { port.capture(build()); } catch { /* the command result is already decided */ }
}
