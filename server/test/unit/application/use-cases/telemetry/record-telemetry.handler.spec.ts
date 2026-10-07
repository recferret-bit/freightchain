import { RecordTelemetryHandler } from '../../../../../src/application/use-cases/telemetry/record-telemetry/record-telemetry.handler.js';
import { RecordTelemetryCommand } from '../../../../../src/application/use-cases/telemetry/record-telemetry/record-telemetry.command.js';
import { FakeClock } from '../../../../support/fake-clock.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';

const ANON = 'anon_00000000-0000-4000-8000-000000000000';

const setup = (on = true) => {
  const analytics = new RecordingAnalytics();
  analytics.on = on;
  const clock = new FakeClock();
  const handler = new RecordTelemetryHandler(analytics, clock);
  const run = (wallet: string | null, anonId: string | null, events: { event: string; properties?: unknown }[]) =>
    handler.execute(new RecordTelemetryCommand(wallet, anonId, events));
  return { analytics, clock, run };
};

describe('RecordTelemetryHandler', () => {
  it('disabled answers enabled false and does not queue, even when the batch names a server event', () => {
    const { analytics, run } = setup(false);
    expect(run(null, ANON, [{ event: 'ride_completed', properties: {} }, { event: 'landing_viewed', properties: { surface: 'hero' } }])).toEqual({ enabled: false, accepted: 0, dropped: 0 });
    expect(analytics.events).toEqual([]);
  });

  it('an empty batch is accepted 0 dropped 0', () => {
    const { run } = setup();
    expect(run(null, ANON, [])).toEqual({ enabled: true, accepted: 0, dropped: 0 });
  });

  it('drops server names and keeps an allowlisted client event', () => {
    const { analytics, run } = setup();
    expect(run(null, ANON, [
      { event: 'ride_completed', properties: { ride_id: 'x' } },
      { event: 'landing_viewed', properties: { surface: 'hero', signature: 'secret', extra: 1 } },
      { event: 'landing_viewed', properties: { surface: 1.5 } },
    ])).toEqual({ enabled: true, accepted: 1, dropped: 2 });
    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0]).toMatchObject({ event: 'landing_viewed', distinctId: ANON, properties: { surface: 'hero', source: 'client' } });
    expect(analytics.events[0]?.properties).not.toHaveProperty('signature');
  });

  it('without a wallet, a bad anon id drops the batch', () => {
    const { analytics, run } = setup();
    expect(run(null, 'anon_not-a-uuid', [{ event: 'landing_viewed', properties: { surface: 'hero' } }])).toEqual({ enabled: true, accepted: 0, dropped: 1 });
    expect(analytics.events).toEqual([]);
  });

  it('the session wallet is the distinct id; the body cannot name another', () => {
    const { analytics, run } = setup();
    run('WALLET', ANON, [{ event: 'lobby_viewed', properties: { is_demo: false, wallet: 'someone-else' } }]);
    expect(analytics.events[0]).toMatchObject({ distinctId: 'WALLET', properties: { is_demo: false, source: 'client' } });
    expect(analytics.events[0]?.properties).not.toHaveProperty('wallet');
  });

  it('session_restored with request_alias true emits one $create_alias, and the string "true" does not', () => {
    const { analytics, run } = setup();
    const restored = { event: 'session_restored', properties: { surface: 'lobby', request_alias: true, is_demo: false } };
    expect(run('WALLET', ANON, [restored]).accepted).toBe(1);
    expect(analytics.named('$create_alias')).toMatchObject([{ distinctId: ANON, properties: { alias: 'WALLET', source: 'server' } }]);
    analytics.events.length = 0;
    run('WALLET', ANON, [{ event: 'session_restored', properties: { surface: 'lobby', request_alias: 'true' } }]);
    expect(analytics.named('$create_alias')).toEqual([]);
    run(null, ANON, [restored]);
    expect(analytics.named('$create_alias')).toEqual([]);
  });
});
