import { TelemetryHttpController } from '../../../src/presentation/telemetry/telemetry.http.controller.js';
import { RecordTelemetryCommand } from '../../../src/application/use-cases/telemetry/record-telemetry/record-telemetry.command.js';
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
});
