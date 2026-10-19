import { emitAnalytics } from '../../../../src/application/services/analytics-emit.js';
import { AnalyticsPort, type AnalyticsEvent } from '../../../../src/application/ports/analytics/analytics.port.js';

const event = (): AnalyticsEvent => ({
  event: 'ride_ordered', distinctId: 'w', uuid: null, dedupeKey: null, timestamp: new Date(0), properties: { source: 'server' },
});

/** The decision lives on the port. This fake never reads process.env. */
class FakePort extends AnalyticsPort {
  readonly captured: AnalyticsEvent[] = [];
  on = true;
  throwOnEnabled = false;
  throwOnCapture = false;

  enabled(): boolean {
    if (this.throwOnEnabled) throw new Error('enabled failed');
    return this.on;
  }

  capture(row: AnalyticsEvent): void {
    if (this.throwOnCapture) throw new Error('capture failed');
    this.captured.push(row);
  }

  captureException(): void {
    if (this.throwOnCapture) throw new Error('capture failed');
  }
}

describe('emitAnalytics', () => {
  it('does not build or capture when the port is off', () => {
    const port = new FakePort();
    port.on = false;
    const build = vi.fn(event);
    emitAnalytics(port, build);
    expect(build).not.toHaveBeenCalled();
    expect(port.captured).toHaveLength(0);
  });

  it('captures the built event when the port is on', () => {
    const port = new FakePort();
    emitAnalytics(port, event);
    expect(port.captured).toHaveLength(1);
    expect(port.captured[0]?.event).toBe('ride_ordered');
  });

  it('swallows a throw from enabled(), the factory, or capture', () => {
    const off = new FakePort();
    off.throwOnEnabled = true;
    expect(() => emitAnalytics(off, event)).not.toThrow();
    const boom = new FakePort();
    expect(() => emitAnalytics(boom, () => { throw new Error('factory'); })).not.toThrow();
    expect(boom.captured).toHaveLength(0);
    const bad = new FakePort();
    bad.throwOnCapture = true;
    expect(() => emitAnalytics(bad, event)).not.toThrow();
  });
});
