import { TelemetryHttpController } from '../../../src/presentation/telemetry/telemetry.http.controller.js';
import { RecordTelemetryCommand } from '../../../src/application/use-cases/telemetry/record-telemetry/record-telemetry.command.js';
import { ReportClientErrorCommand } from '../../../src/application/use-cases/telemetry/report-client-error/report-client-error.command.js';
import { busMock } from '../../support/bus.js';

describe('TelemetryHttpController', () => {
  it('dispatches the batch and the verified session wallet', async () => {
    const bus = busMock({ enabled: true, accepted: 1, dropped: 0 });
    const events = [{ event: 'landing_viewed', properties: { surface: 'hero' } }];
    expect(await new TelemetryHttpController(bus.bus).record('WALLET', { anon_id: 'anon_x', events })).toEqual({ enabled: true, accepted: 1, dropped: 0 });
    expect(bus.last()).toBeInstanceOf(RecordTelemetryCommand);
    expect(bus.last()).toMatchObject({ wallet: 'WALLET', anonId: 'anon_x', events });
  });

  it('a missing cookie is a null wallet on the command', async () => {
    const bus = busMock({ enabled: false, accepted: 0, dropped: 0 });
    await new TelemetryHttpController(bus.bus).record(null, { events: [] });
    expect(bus.last()).toMatchObject({ wallet: null, anonId: null, events: [] });
  });

  it('dispatches a crash with the session wallet and the client ip', async () => {
    const bus = busMock({ enabled: true, accepted: 1 });
    const frames = [{ filename: 'https://freightchain.fun/js/main.js', function: 'frame', lineno: 12, colno: 4 }];
    const body = { anon_id: 'anon_x', surface: 'game' as const, release: 'abc1234', name: 'TypeError', value: 'x is undefined', frames };
    expect(await new TelemetryHttpController(bus.bus).report('WALLET', { ip: '203.0.113.8', userAgent: null }, body)).toEqual({ enabled: true, accepted: 1 });
    expect(bus.last()).toBeInstanceOf(ReportClientErrorCommand);
    expect(bus.last()).toMatchObject({ wallet: 'WALLET', ip: '203.0.113.8', anonId: 'anon_x', report: { surface: 'game', name: 'TypeError', frames } });
    await new TelemetryHttpController(bus.bus).report(null, { ip: null, userAgent: null }, { ...body, anon_id: undefined });
    expect(bus.last()).toMatchObject({ wallet: null, ip: 'unknown', anonId: null });
  });
});
